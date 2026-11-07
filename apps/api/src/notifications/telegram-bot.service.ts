import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { dexscreener, goplus } from '@magura/chains';
import { EMPTY_FILTER, fmtUsd, type ChainId, type PairSummary, type SignalKind, type TokenRisk } from '@magura/shared';
import { env } from '../config';
import { PrismaService, RedisService } from '../common/infra.module';
import { HuntService, type HuntSort } from '../market/hunt.service';
import { TrenchesService } from '../market/trenches.service';
import { IntelService } from '../market/intel.service';
import { SmartService, type Window } from '../market/smart.service';
import { SignalsService } from '../market/signals.service';

type Btn = { text: string; url?: string; callback_data?: string };
type Kb = Btn[][];
interface TgMessage {
  message_id: number;
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
  from?: { id: number; first_name?: string; username?: string };
  text?: string;
  caption?: string;
}
export interface TgUpdate {
  message?: TgMessage;
  callback_query?: { id: string; from: { id: number }; message?: TgMessage; data?: string };
}

const CH: Record<string, ChainId> = { s: 'solana', b: 'base', n: 'bsc', e: 'ethereum' };
const CH_SHORT: Record<ChainId, string> = { solana: 's', base: 'b', bsc: 'n', ethereum: 'e' };
const CH_NAME: Record<ChainId, string> = { solana: 'Solana', base: 'Base', bsc: 'BNB Chain', ethereum: 'Ethereum' };
const DS_SLUG: Record<ChainId, string> = { solana: 'solana', base: 'base', bsc: 'bsc', ethereum: 'ethereum' };
const SOL_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const EVM_RE = /\b0x[a-fA-F0-9]{40}\b/;

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n: number | null | undefined) => (n == null ? '–' : fmtUsd(n, { compact: true }));
const pct = (n: number | null | undefined, d = 0) => (n == null ? '–' : `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`);
const pp = (n: number | null | undefined) => (n == null ? '–' : `${n.toFixed(1)}%`);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const yn = (bad: boolean | null | undefined) => (bad == null ? '❔' : bad ? '❌' : '✅');
function age(iso: string | null | undefined) {
  if (!iso) return '–';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The Magura Telegram bot. DMs and groups:
 * coin scans (paste any contract address), trending, new launches, smart-money leaderboard,
 * wallet and dev lookups, live signals, prices, account-linked alerts, per-group autoscan.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly log = new Logger('tgbot');
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly hunt: HuntService,
    private readonly trenches: TrenchesService,
    private readonly intel: IntelService,
    private readonly smart: SmartService,
    private readonly signals: SignalsService,
  ) {}

  private get web() {
    return env.WEB_ORIGIN.split(',')[0].replace(/\/$/, '');
  }
  private coinUrl(chain: ChainId, a: string) {
    return `${this.web}/t/${chain}/${a}`;
  }

  async onModuleInit() {
    if (!env.TELEGRAM_BOT_TOKEN) return;
    const cmds = [
      ['scan', 'Scan a coin: /scan <contract or $ticker>'],
      ['trending', 'Hottest coins right now'],
      ['new', 'Newest launches, final stretch, migrated'],
      ['smart', "Today's most profitable wallets"],
      ['signals', 'Live smart-money, whale and migration signals'],
      ['wallet', 'Wallet PnL: /wallet <address>'],
      ['dev', 'Dev history: /dev <address>'],
      ['price', 'SOL, ETH, BNB, BTC prices'],
      ['alerts', 'Get your Magura alerts here'],
      ['autoscan', 'Groups: auto-scan pasted contracts (on/off)'],
      ['help', 'Everything the bot can do'],
    ].map(([command, description]) => ({ command, description }));
    await this.api('setMyCommands', { commands: cmds });
    await this.api('setMyDescription', {
      description:
        'Magura — the social trading terminal. Paste any contract address to scan it: market cap, liquidity, holders, bundlers, snipers, insiders, dev history and smart wallets in. Trending coins, new launches, smart-money leaderboard and live signals. FIND. TRADE. REPEAT.',
    });
    await this.api('setMyShortDescription', { short_description: 'Scan any coin, track smart money, get live signals. magura.app' });
  }

  // ───────────────────────── transport

  private async api<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
    if (!env.TELEGRAM_BOT_TOKEN) return null;
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((e) => (this.log.warn(`${method}: ${(e as Error).message}`), null));
    if (!res) return null;
    const j = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
    if (!j?.ok && !/message is not modified/.test(j?.description ?? '')) this.log.warn(`${method}: ${j?.description ?? res.status}`);
    return j?.result ?? null;
  }
  private send(chatId: number, html: string, kb?: Kb, replyTo?: number) {
    return this.api('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}),
    });
  }
  private edit(chatId: number, messageId: number, html: string, kb?: Kb) {
    return this.api('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: kb ?? [] },
    });
  }

  // ───────────────────────── entry

  async handle(u: TgUpdate) {
    try {
      if (u.callback_query) return await this.onCallback(u.callback_query);
      if (u.message) return await this.onMessage(u.message);
    } catch (e) {
      this.log.warn(`update failed: ${(e as Error).message}`);
    }
  }

  private async onMessage(m: TgMessage) {
    const text = (m.text ?? m.caption ?? '').trim();
    if (!text) return;
    const chatId = m.chat.id;
    const isGroup = m.chat.type !== 'private';
    if (!(await this.redis.allow(`tgr:${chatId}`, 25, 60))) return;

    if (text.startsWith('/')) {
      const [head, ...rest] = text.split(/\s+/);
      const [cmd, at] = head.slice(1).split('@');
      if (at && env.TELEGRAM_BOT_USERNAME && at.toLowerCase() !== env.TELEGRAM_BOT_USERNAME.toLowerCase()) return;
      const arg = rest.join(' ').trim();
      switch (cmd.toLowerCase()) {
        case 'start':
          return arg ? this.link(chatId, arg) : this.welcome(chatId);
        case 'help':
          return this.help(chatId);
        case 'scan':
        case 'ca':
        case 'x':
          return arg
            ? this.scanQuery(chatId, arg, m.message_id)
            : this.send(chatId, 'Send <code>/scan</code> followed by a contract address or a ticker, e.g. <code>/scan $BONK</code>. Or just paste a contract address.');
        case 'trending':
        case 'hot':
          return this.trending(chatId, 'hot');
        case 'new':
          return this.fresh(chatId, 'new');
        case 'smart':
        case 'top':
          return this.smartTop(chatId, '1d');
        case 'signals':
          return this.signalList(chatId, 'all');
        case 'wallet':
        case 'w':
          return this.walletCard(chatId, arg);
        case 'dev':
          return this.devCard(chatId, arg);
        case 'price':
        case 'sol':
          return this.prices(chatId);
        case 'alerts':
          return this.alerts(chatId, isGroup);
        case 'stop':
          return this.unlink(chatId);
        case 'autoscan':
          return this.autoscan(chatId, m.from?.id, arg, isGroup);
        default:
          return isGroup ? undefined : this.help(chatId);
      }
    }

    // a pasted contract address: always in DMs, in groups unless autoscan is off
    const ca = text.match(EVM_RE)?.[0] ?? text.match(SOL_RE)?.[0];
    if (ca && (!isGroup || (await this.redis.client.get(`tgas:${chatId}`)) !== '0')) return this.scanQuery(chatId, ca, m.message_id);
    if (!isGroup) return this.help(chatId);
  }

  private async onCallback(q: NonNullable<TgUpdate['callback_query']>) {
    const m = q.message;
    const [k, a, b] = (q.data ?? '').split('|');
    if (!m) return this.api('answerCallbackQuery', { callback_query_id: q.id });
    if (!(await this.redis.allow(`tgcb:${q.from.id}`, 30, 60))) return this.api('answerCallbackQuery', { callback_query_id: q.id, text: 'Slow down a little' });
    const chatId = m.chat.id;
    const id = m.message_id;
    void this.api('answerCallbackQuery', { callback_query_id: q.id, ...(k === 'r' ? { text: 'Refreshed' } : {}) });
    switch (k) {
      case 'r':
        return this.coin(chatId, CH[a], b, { edit: id });
      case 'h':
        return this.holdersView(chatId, CH[a], b, id);
      case 'd':
        return this.devFromCoin(chatId, CH[a], b, id);
      case 't':
        return this.trending(chatId, a as HuntSort, id);
      case 'n':
        return this.fresh(chatId, a as 'new' | 'almost' | 'survived', id);
      case 's':
        return this.smartTop(chatId, a as Window, id);
      case 'g':
        return this.signalList(chatId, a, id);
      case 'p':
        return this.prices(chatId, id);
      case 'm':
        if (a === 'help') return this.help(chatId);
        if (a === 'alerts') return this.alerts(chatId, m.chat.type !== 'private');
        if (a === 'scan') return this.send(chatId, 'Paste any contract address (Solana, Base, BNB Chain or Ethereum) or send <code>/scan $TICKER</code>.');
        return;
    }
  }

  // ───────────────────────── menus

  private welcome(chatId: number) {
    return this.send(
      chatId,
      [
        '<b>Welcome to Magura</b> — FIND. TRADE. REPEAT.',
        '',
        'Paste any contract address and get a full scan in a second: market cap, liquidity, holders, bundlers, snipers, insiders, dev history and smart wallets in.',
        '',
        'Or pick something below.',
      ].join('\n'),
      [
        [
          { text: '🔥 Trending', callback_data: 't|hot' },
          { text: '🆕 New launches', callback_data: 'n|new' },
        ],
        [
          { text: '🧠 Smart money', callback_data: 's|1d' },
          { text: '📡 Live signals', callback_data: 'g|all' },
        ],
        [
          { text: '🔎 Scan a coin', callback_data: 'm|scan' },
          { text: '🔔 My alerts', callback_data: 'm|alerts' },
        ],
        [{ text: '⚡ Open Magura', url: `${this.web}/trenches` }],
      ],
    );
  }

  private help(chatId: number) {
    return this.send(
      chatId,
      [
        '<b>Magura bot</b>',
        '',
        '🔎 <b>Scan</b> — paste a contract, or <code>/scan $TICKER</code>',
        '🔥 /trending — hottest coins, gainers, volume, 5m movers',
        '🆕 /new — new pairs, final stretch, migrated',
        '🧠 /smart — most profitable wallets (1D / 7D / 30D)',
        '📡 /signals — smart buys, whales, migrations, dev dumps',
        '👛 /wallet <code>address</code> — PnL, win rate, holdings, last trades',
        '👨‍💻 /dev <code>address</code> — launches, migrations, rugs, best coin',
        '💲 /price — SOL, ETH, BNB, BTC',
        '🔔 /alerts — your Magura alerts in this chat',
        '👥 /autoscan on|off — groups: scan every pasted contract',
        '',
        'Works in groups too: add the bot and paste a contract.',
      ].join('\n'),
      [[{ text: '⚡ Open Magura', url: `${this.web}/trenches` }]],
    );
  }

  // ───────────────────────── coin scan

  private async scanQuery(chatId: number, q: string, replyTo?: number) {
    const evm = q.match(EVM_RE)?.[0];
    const sol = q.match(SOL_RE)?.[0];
    if (sol && !evm) return this.coin(chatId, 'solana', sol, { replyTo });
    const term = evm ?? q.replace(/^\$/, '');
    const hits = await this.redis.cached(`tgsearch:${term.toLowerCase()}`, 30, () => dexscreener.search(term).catch(() => [] as PairSummary[]));
    const best = hits
      .filter((p) => !evm || p.baseToken.address.toLowerCase() === evm.toLowerCase())
      .filter((p) => evm || p.baseToken.symbol.toLowerCase() === term.toLowerCase())
      .sort((x, y) => (y.liquidityUsd ?? 0) - (x.liquidityUsd ?? 0))[0];
    if (!best) return this.send(chatId, `Couldn't find <b>${esc(q.slice(0, 60))}</b> on Solana, Base, BNB Chain or Ethereum.`, undefined, replyTo);
    return this.coin(chatId, best.chain, best.chain === 'solana' ? best.baseToken.address : best.baseToken.address.toLowerCase(), { replyTo });
  }

  private async coin(chatId: number, chain: ChainId, address: string, o: { replyTo?: number; edit?: number }) {
    if (!chain || !address) return;
    const [pair, row, risk] = await Promise.all([
      this.redis.cached(`pair:${chain}:${address}`, 15, () => dexscreener.bestPair(chain, address)).catch(() => null),
      this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } } }),
      this.redis.cached(`risk:${chain}:${address}`, 600, () => goplus.tokenRisk(chain, address).catch(() => null)) as Promise<TokenRisk | null>,
    ]);
    if (!pair && !row) return this.send(chatId, `No market found for <code>${esc(address)}</code> yet.`, undefined, o.replyTo);
    const intel = chain === 'solana' ? await this.intel.recompute(chain, address).catch(() => null) : null;
    const smartIn = chain === 'solana' ? ((await this.intel.holders(chain, address, 'holding', 'smart', null, 200).catch(() => null))?.length ?? 0) : null;

    const sym = pair?.baseToken.symbol ?? row?.symbol ?? '?';
    const name = pair?.baseToken.name ?? row?.name ?? '';
    const mc = pair?.marketCap ?? pair?.fdv ?? row?.marketCapUsd ?? null;
    const top10 = intel?.top10Pct ?? risk?.top10Pct ?? null;
    const devPct = intel?.devPct ?? risk?.devPct ?? null;
    const holders = intel?.holders ?? risk?.holders ?? row?.holders ?? null;
    const socials = pair?.socials;
    const created = pair?.pairCreatedAt ?? row?.createdAt?.toISOString() ?? null;

    // a simple 0–10 safety score from what we know
    let score = 10;
    if (risk?.honeypot) score -= 6;
    if (risk?.mintable) score -= 2;
    if (risk?.freezable) score -= 1;
    if ((top10 ?? 0) > 30) score -= 2;
    if ((intel?.bundlerPct ?? 0) > 10) score -= 2;
    if ((intel?.sniperPct ?? 0) > 10) score -= 1;
    if ((intel?.insiderPct ?? 0) > 5) score -= 1;
    if (socials && !socials.x && !socials.telegram && !socials.website) score -= 1;
    if ((pair?.liquidityUsd ?? 0) < 5000 && !(row?.bondingPct != null && row.bondingPct < 100)) score -= 1;
    score = Math.max(0, score);
    const dot = score >= 8 ? '🟢' : score >= 5 ? '🟡' : '🔴';

    const L: string[] = [];
    L.push(`${dot} <b>$${esc(sym)}</b>${name ? ` · ${esc(name)}` : ''}`);
    L.push(`<i>${CH_NAME[chain]}${pair?.dex ? ` · ${esc(pair.dex)}` : ''} · ${age(created)} old</i>`);
    L.push('');
    L.push(`💰 MC <b>${usd(mc)}</b> · Liq ${usd(pair?.liquidityUsd)} · Vol ${usd(pair?.volume24h)}`);
    if (pair?.priceUsd != null) L.push(`💲 Price $${pair.priceUsd < 0.0001 ? pair.priceUsd.toExponential(3) : pair.priceUsd.toPrecision(4)}`);
    L.push(`📈 5m ${pct(pair?.priceChange5m)} · 1h ${pct(pair?.priceChange1h)} · 6h ${pct(pair?.priceChange6h)} · 24h ${pct(pair?.priceChange24h)}`);
    if (pair?.buys24h != null) L.push(`🔁 24h buys ${pair.buys24h.toLocaleString('en-US')} · sells ${(pair.sells24h ?? 0).toLocaleString('en-US')}`);
    if (row?.bondingPct != null && row.bondingPct < 100) L.push(`⏳ Bonding curve ${row.bondingPct.toFixed(0)}%`);
    L.push('');
    L.push(`🛡 <b>Safety ${score}/10</b>`);
    L.push(
      `👥 Holders ${holders?.toLocaleString('en-US') ?? '–'} · Top 10 ${pp(top10)} · Dev ${pp(devPct)}${intel?.devSoldAll ? ' (sold all)' : intel?.devHolds ? ' (holding)' : ''}`,
    );
    if (intel) L.push(`📦 Bundlers ${pp(intel.bundlerPct)} · 🎯 Snipers ${pp(intel.sniperPct)} · 🕵️ Insiders ${pp(intel.insiderPct)} · 🌱 Fresh ${pp(intel.freshPct)}`);
    if (risk)
      L.push(
        `Mint ${yn(risk.mintable)} · Freeze ${yn(risk.freezable)} · Honeypot ${yn(risk.honeypot)}${risk.buyTax || risk.sellTax ? ` · Tax ${risk.buyTax ?? 0}/${risk.sellTax ?? 0}%` : ''}`,
      );
    L.push(
      `DEX paid ${row?.dexPaid ? '✅' : '—'} · ${socials ? [socials.x && 'X', socials.telegram && 'TG', socials.website && 'Web'].filter(Boolean).join(' · ') || 'No socials' : 'Socials –'}`,
    );
    if (smartIn != null) L.push(`🧠 Smart wallets holding: <b>${smartIn}</b>`);
    L.push('');
    L.push(`<code>${address}</code>`);
    L.push(`<i>Updated ${new Date().toISOString().slice(11, 19)} UTC</i>`);

    const c = CH_SHORT[chain];
    const kb: Kb = [
      [
        { text: `⚡ Trade $${sym} on Magura`, url: this.coinUrl(chain, address) },
        { text: '📊 Chart', url: `https://dexscreener.com/${DS_SLUG[chain]}/${address}` },
      ],
      [
        { text: '🔄 Refresh', callback_data: `r|${c}|${address}` },
        ...(chain === 'solana'
          ? [
              { text: '👥 Holders', callback_data: `h|${c}|${address}` },
              { text: '👨‍💻 Dev', callback_data: `d|${c}|${address}` },
            ]
          : []),
      ],
    ];
    return o.edit ? this.edit(chatId, o.edit, L.join('\n'), kb) : this.send(chatId, L.join('\n'), kb, o.replyTo);
  }

  private async holdersView(chatId: number, chain: ChainId, address: string, msgId: number) {
    const rows = (await this.intel.holders(chain, address, 'holding', null, null, 12).catch(() => null)) ?? [];
    const row = await this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } }, select: { symbol: true } });
    const L = [`👥 <b>Top holders · $${esc(row?.symbol ?? '?')}</b>`, ''];
    if (!rows.length) L.push('No holder data yet. Try again in a moment.');
    rows.forEach((r, i) => {
      const tags = r.tags.length ? ` [${r.tags.map((t) => t.toUpperCase()).join(', ')}]` : '';
      const pnl = r.pnlNative != null ? ` · PnL ${r.pnlNative >= 0 ? '+' : ''}${r.pnlNative.toFixed(2)} SOL` : '';
      L.push(`${i + 1}. <a href="${this.web}/w/${chain}/${r.wallet}">${short(r.wallet)}</a> ${pp(r.pctSupply)}${esc(tags)}${pnl}`);
    });
    const c = CH_SHORT[chain];
    return this.edit(chatId, msgId, L.join('\n'), [
      [
        { text: '← Back to coin', callback_data: `r|${c}|${address}` },
        { text: '👨‍💻 Dev', callback_data: `d|${c}|${address}` },
      ],
    ]);
  }

  private async devFromCoin(chatId: number, chain: ChainId, address: string, msgId: number) {
    const row = await this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } }, select: { creator: true, symbol: true } });
    const c = CH_SHORT[chain];
    const back: Kb = [[{ text: '← Back to coin', callback_data: `r|${c}|${address}` }]];
    if (!row?.creator) return this.edit(chatId, msgId, `👨‍💻 No dev wallet known for $${esc(row?.symbol ?? '?')}.`, back);
    return this.edit(chatId, msgId, await this.devText(chain, row.creator), [...back, [{ text: 'Open dev wallet', url: `${this.web}/w/${chain}/${row.creator}` }]]);
  }

  private async devText(chain: ChainId, creator: string) {
    const d = await this.redis.cached(`devr:${chain}:${creator}`, 30, () => this.intel.devReport(chain, creator));
    const verdict =
      d.launched >= 5 && d.migratedPct < 5
        ? '🔴 Serial launcher, almost nothing migrates'
        : d.quickRugs > 2
          ? '🔴 Sold early on several coins'
          : d.migratedPct >= 20
            ? '🟢 Strong track record'
            : '🟡 Mixed track record';
    const L = [
      `👨‍💻 <b>Dev ${short(creator)}</b>`,
      verdict,
      '',
      `Launched <b>${d.launched}</b> · Migrated <b>${d.migrated}</b> (${d.migratedPct}%)`,
      `Sold within 1h: <b>${d.quickRugs}</b>`,
      d.best ? `Best coin: $${esc(d.best.symbol)} · ATH ${usd(d.best.athMarketCapUsd)}` : 'Best coin: –',
      d.lastLaunchAt ? `Last launch ${age(d.lastLaunchAt)} ago` : '',
      '',
      ...d.tokens.slice(0, 6).map((t) => `• $${esc(t.symbol)} · ${usd(t.marketCapUsd)}${t.migrated ? ' · migrated' : ''}${t.devSold ? ' · dev sold' : ''}`),
    ];
    return L.filter((x) => x !== undefined).join('\n');
  }

  private async devCard(chatId: number, arg: string) {
    const a = arg.match(SOL_RE)?.[0];
    if (!a) return this.send(chatId, 'Send <code>/dev</code> followed by a Solana dev wallet address.');
    return this.send(chatId, await this.devText('solana', a), [[{ text: 'Open in Magura', url: `${this.web}/w/solana/${a}` }]]);
  }

  // ───────────────────────── lists

  private async trending(chatId: number, sort: HuntSort, editId?: number) {
    const s = (['hot', 'gainers', 'volume', 'm5'] as HuntSort[]).includes(sort) ? sort : 'hot';
    const { items } = await this.redis.cached(`tgtrend:${s}`, 30, () => this.hunt.list({ sort: s, filter: EMPTY_FILTER, limit: 10 }, null));
    const title = { hot: '🔥 Trending now', gainers: '🚀 Top gainers 1h', volume: '📊 Top volume', m5: '⚡ Moving in the last 5m' }[s as 'hot'];
    const L = [`<b>${title}</b>`, ''];
    items.forEach((t, i) =>
      L.push(`${i + 1}. <a href="${this.coinUrl(t.chain, t.address)}">$${esc(t.symbol)}</a> · ${usd(t.marketCapUsd)} · 1h ${pct(t.change1h)} · Vol ${usd(t.volumeUsd)}`),
    );
    if (!items.length) L.push('Nothing yet. Try again in a minute.');
    L.push('', '<i>Tap a coin to trade it, or paste its contract here to scan it.</i>');
    const tab = (k: HuntSort, label: string): Btn => ({ text: s === k ? `• ${label}` : label, callback_data: `t|${k}` });
    const kb: Kb = [[tab('hot', 'Hot'), tab('gainers', 'Gainers'), tab('volume', 'Volume'), tab('m5', '5m')], [{ text: 'Open Trending', url: `${this.web}/trending` }]];
    return editId ? this.edit(chatId, editId, L.join('\n'), kb) : this.send(chatId, L.join('\n'), kb);
  }

  private async fresh(chatId: number, stage: 'new' | 'almost' | 'survived', editId?: number) {
    const st = (['new', 'almost', 'survived'] as const).includes(stage) ? stage : 'new';
    const { items } = await this.redis.cached(`tgnew:${st}`, 15, () => this.trenches.list(st, EMPTY_FILTER, 10, null));
    const title = { new: '🆕 New pairs', almost: '⏳ Final stretch', survived: '🚀 Migrated' }[st];
    const L = [`<b>${title}</b>`, ''];
    items.forEach((t, i) =>
      L.push(
        `${i + 1}. <a href="${this.coinUrl(t.chain, t.address)}">$${esc(t.symbol)}</a> · ${usd(t.marketCapUsd)} · ${age(t.createdAt)}${t.bondingPct != null && t.bondingPct < 100 ? ` · curve ${t.bondingPct.toFixed(0)}%` : ''}${t.holders ? ` · ${t.holders}h` : ''}`,
      ),
    );
    if (!items.length) L.push('Nothing yet. Try again in a minute.');
    const tab = (k: typeof st, label: string): Btn => ({ text: st === k ? `• ${label}` : label, callback_data: `n|${k}` });
    const kb: Kb = [[tab('new', 'New'), tab('almost', 'Final stretch'), tab('survived', 'Migrated')], [{ text: 'Open Trenches', url: `${this.web}/trenches` }]];
    return editId ? this.edit(chatId, editId, L.join('\n'), kb) : this.send(chatId, L.join('\n'), kb);
  }

  private async smartTop(chatId: number, w: Window, editId?: number) {
    const win = (['1d', '7d', '30d'] as Window[]).includes(w) ? w : '1d';
    const rows = (await this.smart.rank(win, 'pnl', 30)).filter((r) => r.pnl > 0).slice(0, 10);
    const medal = ['🥇', '🥈', '🥉'];
    const L = [`🧠 <b>Smart money · ${win.toUpperCase()}</b>`, 'Most profitable wallets on Solana', ''];
    rows.forEach((r, i) =>
      L.push(
        `${medal[i] ?? `${i + 1}.`} <a href="${this.web}/w/solana/${r.wallet}">${short(r.wallet)}</a> +${r.pnl.toFixed(1)} SOL · ${r.winRate?.toFixed(0) ?? '–'}% win · ${r.buys + r.sells} trades`,
      ),
    );
    if (!rows.length) L.push('Still collecting today’s trades. Check back soon.');
    L.push('', '<i>Copy or track any wallet in Magura.</i>');
    const tab = (k: Window, label: string): Btn => ({ text: win === k ? `• ${label}` : label, callback_data: `s|${k}` });
    const kb: Kb = [[tab('1d', '1D'), tab('7d', '7D'), tab('30d', '30D')], [{ text: 'Copy a wallet', url: `${this.web}/copy` }]];
    return editId ? this.edit(chatId, editId, L.join('\n'), kb) : this.send(chatId, L.join('\n'), kb);
  }

  private async signalList(chatId: number, f: string, editId?: number) {
    const map: Record<string, SignalKind[] | null> = { all: null, smart: ['smart_buy'], whale: ['whale_buy'], mig: ['migrated'], dev: ['dev_sell'] };
    const key = f in map ? f : 'all';
    const list = (await this.signals.recent(map[key], 10)).filter((s) => s.kind !== 'tracked');
    const icon: Partial<Record<SignalKind, string>> = {
      smart_buy: '🧠',
      whale_buy: '🐋',
      migrated: '🚀',
      dev_sell: '🩸',
      dex_paid: '💳',
      bundled_launch: '📦',
      volume_spike: '📈',
    };
    const L = ['📡 <b>Live signals</b>', ''];
    list.forEach((s) =>
      L.push(`${icon[s.kind] ?? '•'} <a href="${this.coinUrl(s.chain, s.address)}">$${esc(s.symbol)}</a> · ${esc(s.detail)} · ${usd(s.marketCapUsd)} · ${age(s.at)} ago`),
    );
    if (!list.length) L.push('Quiet right now.');
    const tab = (k: string, label: string): Btn => ({ text: key === k ? `• ${label}` : label, callback_data: `g|${k}` });
    const kb: Kb = [
      [tab('all', 'All'), tab('smart', 'Smart'), tab('whale', 'Whales'), tab('mig', 'Migrated'), tab('dev', 'Dev sells')],
      [{ text: 'Open Monitor', url: `${this.web}/monitor` }],
    ];
    return editId ? this.edit(chatId, editId, L.join('\n'), kb) : this.send(chatId, L.join('\n'), kb);
  }

  private async walletCard(chatId: number, arg: string) {
    const a = arg.match(SOL_RE)?.[0];
    if (!a) return this.send(chatId, 'Send <code>/wallet</code> followed by a Solana wallet address.');
    const w = await this.smart.wallet('solana', a);
    const row = (k: '1d' | '7d' | '30d') => {
      const s = w.windows[k];
      return s
        ? `${k.toUpperCase()}  ${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)} SOL · ${s.winRate?.toFixed(0) ?? '–'}% win · ${s.buys + s.sells} trades`
        : `${k.toUpperCase()}  –`;
    };
    const L = [`👛 <b>Wallet ${short(a)}</b>${w.smart ? ' · 🧠 SMART' : ''}${w.handle ? ` · @${esc(w.handle)}` : ''}`, '', row('1d'), row('7d'), row('30d')];
    if (w.holdings.length) {
      L.push('', '<b>Holding</b>');
      w.holdings
        .slice(0, 5)
        .forEach((h) => L.push(`• <a href="${this.coinUrl('solana', h.address)}">$${esc(h.symbol)}</a> · MC ${usd(h.marketCapUsd)} · in ${h.spent.toFixed(2)} SOL`));
    }
    if (w.trades.length) {
      L.push('', '<b>Last trades</b>');
      w.trades.slice(0, 5).forEach((t) => L.push(`${t.side === 'buy' ? '🟢' : '🔴'} ${t.side} $${esc(t.symbol)} · ${t.native.toFixed(2)} SOL · ${age(t.at)} ago`));
    }
    return this.send(chatId, L.join('\n'), [
      [
        { text: 'Open wallet', url: `${this.web}/w/solana/${a}` },
        { text: 'Copy this wallet', url: `${this.web}/copy?wallet=${a}` },
      ],
    ]);
  }

  private async prices(chatId: number, editId?: number) {
    const raw = await this.redis.client.get('majors');
    const px = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const f = (k: string) => (px[k] ? `$${px[k].toLocaleString('en-US', { maximumFractionDigits: px[k] < 10 ? 4 : 2 })}` : '–');
    const html = `💲 <b>Prices</b>\n\nSOL ${f('SOL')}\nETH ${f('ETH')}\nBNB ${f('BNB')}\nBTC ${f('BTC')}\n\n<i>${new Date().toISOString().slice(11, 19)} UTC</i>`;
    const kb: Kb = [[{ text: '🔄 Refresh', callback_data: 'p|x' }]];
    return editId ? this.edit(chatId, editId, html, kb) : this.send(chatId, html, kb);
  }

  // ───────────────────────── account + groups

  private async alerts(chatId: number, isGroup: boolean) {
    if (isGroup) return this.send(chatId, 'Personal alerts work in a private chat with me. Open my profile and press Start.');
    const s = await this.prisma.db.userSettings.findFirst({ where: { telegramChatId: String(chatId) }, select: { userId: true } });
    if (s)
      return this.send(chatId, '🔔 <b>Alerts are on</b> for this chat: tracked wallets, orders filling, price alerts, calls and more.\n\nSend /stop to turn them off.', [
        [{ text: 'Alert settings', url: `${this.web}/settings` }],
      ]);
    return this.send(chatId, '🔔 <b>Get your Magura alerts here</b>\n\nIn Magura open Settings › Notifications and tap <b>Connect Telegram</b>. It takes five seconds.', [
      [{ text: 'Open settings', url: `${this.web}/settings` }],
    ]);
  }

  private async link(chatId: number, token: string) {
    const userId = await this.redis.client.getdel(`tglink:${token}`);
    if (!userId)
      return this.send(chatId, '<b>Link expired</b>\nOpen Settings › Notifications in Magura and tap Connect Telegram again.', [
        [{ text: 'Open settings', url: `${this.web}/settings` }],
      ]);
    await this.prisma.db.userSettings.upsert({ where: { userId }, update: { telegramChatId: String(chatId) }, create: { userId, telegramChatId: String(chatId) } });
    const u = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { handle: true } });
    await this.send(chatId, `✅ <b>Connected to @${esc(u?.handle ?? 'your account')}</b>\nYour Magura alerts will arrive here. Send /stop to disconnect.`);
    return this.welcome(chatId);
  }

  private async unlink(chatId: number) {
    await this.prisma.db.userSettings.updateMany({ where: { telegramChatId: String(chatId) }, data: { telegramChatId: null } });
    return this.send(chatId, 'Alerts are off for this chat. Send /alerts to turn them back on.');
  }

  private async autoscan(chatId: number, fromId: number | undefined, arg: string, isGroup: boolean) {
    if (!isGroup) return this.send(chatId, 'Autoscan is for groups. In this chat every contract you paste is scanned.');
    const want = arg.toLowerCase();
    if (want !== 'on' && want !== 'off') {
      const cur = (await this.redis.client.get(`tgas:${chatId}`)) !== '0';
      return this.send(chatId, `Autoscan is <b>${cur ? 'on' : 'off'}</b>. Admins can send <code>/autoscan on</code> or <code>/autoscan off</code>.`);
    }
    const member = fromId ? await this.api<{ status: string }>('getChatMember', { chat_id: chatId, user_id: fromId }) : null;
    if (!member || !['creator', 'administrator'].includes(member.status)) return this.send(chatId, 'Only group admins can change autoscan.');
    await this.redis.client.set(`tgas:${chatId}`, want === 'on' ? '1' : '0');
    return this.send(chatId, `Autoscan <b>${want}</b>. ${want === 'on' ? 'Every contract posted here gets a scan.' : 'Use /scan to scan a coin.'}`);
  }
}
