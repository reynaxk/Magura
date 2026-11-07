import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { fmtUsd, type SignalDTO, type SignalKind } from '@magura/shared';
import { env } from '../config';
import { RedisService } from '../common/infra.module';
import { SignalsService } from './signals.service';
import { SmartService } from './smart.service';

/** What goes public, and the floor each kind must clear. */
const RULES: Partial<Record<SignalKind, { label: string; emoji: string; color: number; minMc: number; maxMc: number }>> = {
  migrated: { label: 'Migrated', emoji: '🚀', color: 0x00e0b8, minMc: 40_000, maxMc: 5e6 },
  smart_buy: { label: 'Smart money buy', emoji: '🧠', color: 0x2fe39a, minMc: 15_000, maxMc: 8e6 },
  whale_buy: { label: 'Whale buy', emoji: '🐋', color: 0x3ba7ff, minMc: 25_000, maxMc: 2e7 },
  dex_paid: { label: 'DEX paid', emoji: '💳', color: 0xf5c451, minMc: 20_000, maxMc: 5e6 },
};
/** Gap between any two public posts, posts per day, and quiet time per coin. */
const GAP_SEC = 75;
const PER_DAY = 80;
const COIN_QUIET_SEC = 45 * 60;

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const day = () => new Date().toISOString().slice(0, 10);

/**
 * Public broadcast: the best Monitor signals go to the Magura Telegram channel and the
 * Discord #live-signals webhook, plus a daily smart-money leaderboard. Off unless
 * TELEGRAM_CHANNEL_ID (with TELEGRAM_BOT_TOKEN, bot is a channel admin) and/or
 * DISCORD_SIGNALS_WEBHOOK are set.
 */
@Injectable()
export class BroadcastService implements OnModuleInit {
  private readonly log = new Logger('broadcast');
  constructor(
    private readonly redis: RedisService,
    private readonly signals: SignalsService,
    private readonly smart: SmartService,
  ) {}

  private get web() {
    return env.WEB_ORIGIN.split(',')[0].replace(/\/$/, '');
  }
  private get on() {
    return !!((env.TELEGRAM_CHANNEL_ID && env.TELEGRAM_BOT_TOKEN) || env.DISCORD_SIGNALS_WEBHOOK);
  }

  onModuleInit() {
    if (!this.on) return;
    this.log.log(`public signals → ${[env.TELEGRAM_CHANNEL_ID && 'telegram', env.DISCORD_SIGNALS_WEBHOOK && 'discord'].filter(Boolean).join(' + ')}`);
    this.signals.onSignal((s) => void this.consider(s).catch((e) => this.log.warn((e as Error).message)));
  }

  private async consider(s: SignalDTO) {
    const r = RULES[s.kind];
    if (!r || s.marketCapUsd == null || s.marketCapUsd < r.minMc || s.marketCapUsd > r.maxMc) return;
    // cheap checks first; the per-coin and gap locks are only taken when we will post
    const dayKey = `bc:day:${day()}`;
    if (Number((await this.redis.client.get(dayKey)) ?? 0) >= PER_DAY) return;
    if (await this.redis.client.exists(`bc:coin:${s.address}`)) return;
    if (!(await this.redis.client.set('bc:gap', '1', 'EX', GAP_SEC, 'NX'))) return;
    await this.redis.client.set(`bc:coin:${s.address}`, '1', 'EX', COIN_QUIET_SEC);
    await this.redis.client.multi().incr(dayKey).expire(dayKey, 172_800).exec();

    const url = `${this.web}/t/${s.chain}/${s.address}`;
    const mc = fmtUsd(s.marketCapUsd, { compact: true });
    const lines = [`${s.detail}`, `MC ${mc}${s.wallet ? ` · wallet ${short(s.wallet)}` : ''}`];
    await Promise.all([
      this.telegram(`${r.emoji} <b>${esc(r.label)} · $${esc(s.symbol)}</b>\n${lines.map(esc).join('\n')}\n\n<code>${s.address}</code>`, [
        [{ text: `Trade $${s.symbol} on Magura`, url }],
        ...(s.wallet ? [[{ text: 'View wallet', url: `${this.web}/w/${s.chain}/${s.wallet}` }]] : []),
      ]),
      this.discord({
        title: `${r.emoji} ${r.label} · $${s.symbol}`,
        url,
        color: r.color,
        description: `${lines.join('\n')}\n\`${s.address}\``,
        thumbnail: s.imageUrl ? { url: s.imageUrl } : undefined,
        footer: { text: 'Magura · FIND. TRADE. REPEAT.' },
        timestamp: s.at,
      }),
    ]);
  }

  /** 20:00 UTC: today's top smart wallets. */
  @Cron('0 20 * * *')
  async leaderboard() {
    if (!this.on) return;
    const rows = (await this.smart.rank('1d', 'pnl', 30)).filter((r) => r.pnl > 0 && (r.winRate ?? 0) >= 50).slice(0, 5);
    if (rows.length < 3) return;
    const medal = ['🥇', '🥈', '🥉', '4.', '5.'];
    const fmt = (r: (typeof rows)[number], i: number) =>
      `${medal[i]} ${short(r.wallet)}  +${r.pnl.toFixed(1)} SOL · ${r.winRate?.toFixed(0) ?? '–'}% win · ${r.buys + r.sells} trades`;
    await Promise.all([
      this.telegram(
        `🏆 <b>Today's smart money</b>\nThe 5 most profitable wallets on Solana today.\n\n${rows.map((r, i) => esc(fmt(r, i))).join('\n')}\n\nCopy or track any of them in Magura.`,
        [[{ text: 'Open the Smart leaderboard', url: `${this.web}/smart` }]],
      ),
      this.discord({
        title: "🏆 Today's smart money",
        url: `${this.web}/smart`,
        color: 0x2fe39a,
        description: `The 5 most profitable wallets on Solana today.\n\n${rows.map((r, i) => `${fmt(r, i)} · [view](${this.web}/w/solana/${r.wallet})`).join('\n')}`,
        footer: { text: 'Copy or track any of them in Magura' },
        timestamp: new Date().toISOString(),
      }),
    ]);
  }

  private async telegram(html: string, keyboard: { text: string; url: string }[][]) {
    if (!env.TELEGRAM_CHANNEL_ID || !env.TELEGRAM_BOT_TOKEN) return;
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHANNEL_ID, text: html, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard } }),
    });
    if (!res.ok) this.log.warn(`telegram ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }

  private async discord(embed: Record<string, unknown>) {
    if (!env.DISCORD_SIGNALS_WEBHOOK) return;
    const res = await fetch(env.DISCORD_SIGNALS_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Magura Signals', embeds: [embed], allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) this.log.warn(`discord ${res.status}`);
  }
}
