import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { dexscreener, goplus } from '@magura/chains';
import { EMPTY_FILTER, fmtUsd, type ChainId, type PairSummary, type SignalKind, type TokenRisk } from '@magura/shared';
import { env } from '../config';
import { PrismaService, RedisService } from '../common/infra.module';
import { HuntService, type HuntSort } from '../market/hunt.service';
import { TrenchesService } from '../market/trenches.service';
import { IntelService } from '../market/intel.service';
import { SmartService, type Window } from '../market/smart.service';
import { SignalsService } from '../market/signals.service';

const ACCENT = 0x2fe39a;
const RED = 0xff5f6d;
const YELLOW = 0xf5c451;
const CH_NAME: Record<ChainId, string> = { solana: 'Solana', base: 'Base', bsc: 'BNB Chain', ethereum: 'Ethereum' };
const DS_SLUG: Record<ChainId, string> = { solana: 'solana', base: 'base', bsc: 'bsc', ethereum: 'ethereum' };
const SOL_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const EVM_RE = /\b0x[a-fA-F0-9]{40}\b/;

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
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Discord interaction + response shapes (only what we use)
interface Interaction {
  type: number;
  id: string;
  token: string;
  data?: { name?: string; options?: { name: string; value: string }[]; custom_id?: string };
  member?: { user?: { id: string } };
  user?: { id: string };
}
type Embed = Record<string, unknown>;
type Component = { type: number; style?: number; label?: string; url?: string; custom_id?: string };
type Row = { type: 1; components: Component[] };
const btn = (label: string, custom_id: string, style = 2): Component => ({ type: 2, style, label, custom_id });
const link = (label: string, url: string): Component => ({ type: 2, style: 5, label, url });
const row = (...c: Component[]): Row => ({ type: 1, components: c });
// message flags: 1<<6 ephemeral (only the caller sees it)
const EPHEMERAL = 64;

/**
 * Magura Discord bot over HTTP interactions (no gateway):
 * /scan /trending /new /smart /signals /wallet /dev /price, with buttons.
 * Off unless DISCORD_PUBLIC_KEY (+ DISCORD_BOT_TOKEN and DISCORD_APP_ID to register commands) are set.
 */
@Injectable()
export class DiscordBotService implements OnModuleInit {
  private readonly log = new Logger('discordbot');
  private pubKey: ReturnType<typeof createPublicKey> | null = null;

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
  get enabled() {
    return !!env.DISCORD_PUBLIC_KEY;
  }

  async onModuleInit() {
    if (!env.DISCORD_PUBLIC_KEY) return;
    try {
      // wrap the raw 32-byte ed25519 key in an SPKI header so node can import it
      const raw = Buffer.from(env.DISCORD_PUBLIC_KEY, 'hex');
      const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
      this.pubKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch (e) {
      this.log.warn(`bad DISCORD_PUBLIC_KEY: ${(e as Error).message}`);
    }
    await this.registerCommands();
  }

  /** Verify the ed25519 request signature Discord sends with every interaction. */
  verify(signature: string, timestamp: string, rawBody: Buffer): boolean {
    if (!this.pubKey || !signature || !timestamp) return false;
    try {
      return edVerify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), this.pubKey, Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }

  private async registerCommands() {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APP_ID) return;
    const str = (name: string, description: string, required = true) => ({ type: 3, name, description, required });
    const commands = [
      { name: 'scan', description: 'Scan a coin: market cap, holders, bundlers, dev, smart wallets', options: [str('token', 'Contract address or $ticker')] },
      { name: 'trending', description: 'Hottest coins right now' },
      { name: 'new', description: 'Newest launches, final stretch, migrated' },
      { name: 'smart', description: "Today's most profitable wallets" },
      { name: 'signals', description: 'Live smart-money, whale and migration signals' },
      { name: 'wallet', description: 'Wallet PnL, win rate and holdings', options: [str('address', 'Solana wallet address')] },
      { name: 'dev', description: 'Dev history: launches, migrations, rugs', options: [str('address', 'Solana dev wallet address')] },
      { name: 'price', description: 'SOL, ETH, BNB, BTC prices' },
    ];
    const res = await fetch(`https://discord.com/api/v10/applications/${env.DISCORD_APP_ID}/commands`, {
      method: 'PUT',
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands),
    }).catch((e) => (this.log.warn(`register: ${(e as Error).message}`), null));
    if (res && !res.ok) this.log.warn(`register ${res.status}: ${(await res.text()).slice(0, 200)}`);
    else if (res) this.log.log(`registered ${commands.length} slash commands`);
  }

  // ───────────────────────── interaction router

  async render(i: Interaction): Promise<Resp> {
    const userId = i.member?.user?.id ?? i.user?.id ?? 'anon';
    if (!(await this.redis.allow(`dc:${userId}`, 30, 60))) return this.msg('Slow down a moment and try again.', [], true);
    try {
      if (i.type === 2) return await this.command(i);
      if (i.type === 3) return await this.component(i);
    } catch (e) {
      this.log.warn(`interaction failed: ${(e as Error).message}`);
      return this.msg('Something went wrong — try again in a moment.', [], true);
    }
    return this.msg('Unsupported interaction.', [], true);
  }

  /** Send the computed payload as the deferred followup to an interaction. */
  async followup(token: string, data: Resp) {
    if (!env.DISCORD_APP_ID) return;
    const res = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APP_ID}/${token}/messages/@original`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }).catch((e) => (this.log.warn(`followup: ${(e as Error).message}`), null));
    if (res && !res.ok) this.log.warn(`followup ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }

  private opt(i: Interaction, name: string) {
    return i.data?.options?.find((o) => o.name === name)?.value?.trim() ?? '';
  }

  private async command(i: Interaction) {
    switch (i.data?.name) {
      case 'scan':
        return this.scan(this.opt(i, 'token'));
      case 'trending':
        return this.trending('hot');
      case 'new':
        return this.fresh('new');
      case 'smart':
        return this.smartTop('1d');
      case 'signals':
        return this.signalList('all');
      case 'wallet':
        return this.walletCard(this.opt(i, 'address'));
      case 'dev':
        return this.devCard(this.opt(i, 'address'));
      case 'price':
        return this.prices();
      default:
        return this.msg('Unknown command.', [], true);
    }
  }

  private async component(i: Interaction): Promise<Resp> {
    const [k, a, b] = (i.data?.custom_id ?? '').split(':');
    switch (k) {
      case 't':
        return this.trending(a as HuntSort);
      case 'n':
        return this.fresh(a as 'new' | 'almost' | 'survived');
      case 's':
        return this.smartTop(a as Window);
      case 'g':
        return this.signalList(a);
      case 'p':
        return this.prices();
      case 'r':
        return this.coinByAddr(a as ChainId, b);
      case 'h':
        return this.holdersView(a as ChainId, b);
      case 'd':
        return this.devByAddr(a as ChainId, b);
      default:
        return this.msg('That button expired — run the command again.', [], true);
    }
  }

  // ───────────────────────── responses

  private msg(content: string, components: Row[] = [], ephemeral = false): Resp {
    return { content, components, allowed_mentions: { parse: [] }, ...(ephemeral ? { flags: EPHEMERAL } : {}) };
  }
  private embed(e: Embed, components: Row[] = []): Resp {
    return { embeds: [e], components, allowed_mentions: { parse: [] } };
  }

  // ───────────────────────── coin scan

  private async scan(q: string): Promise<Resp> {
    if (!q) return this.msg('Give me a contract address or a `$TICKER`, e.g. `/scan token:$BONK`.', [], true);
    const evm = q.match(EVM_RE)?.[0];
    const sol = q.match(SOL_RE)?.[0];
    if (sol && !evm) return this.coinByAddr('solana', sol);
    const term = evm ?? q.replace(/^\$/, '');
    const hits = await this.redis.cached(`dcsearch:${term.toLowerCase()}`, 30, () => dexscreener.search(term).catch(() => [] as PairSummary[]));
    const best = hits
      .filter((p) => !evm || p.baseToken.address.toLowerCase() === evm.toLowerCase())
      .filter((p) => evm || p.baseToken.symbol.toLowerCase() === term.toLowerCase())
      .sort((x, y) => (y.liquidityUsd ?? 0) - (x.liquidityUsd ?? 0))[0];
    if (!best) return this.msg(`Couldn't find **${q.slice(0, 60)}** on any supported chain.`, [], true);
    return this.coinByAddr(best.chain, best.chain === 'solana' ? best.baseToken.address : best.baseToken.address.toLowerCase());
  }

  private async coinByAddr(chain: ChainId, address: string): Promise<Resp> {
    const [pair, rowT, risk] = await Promise.all([
      this.redis.cached(`pair:${chain}:${address}`, 15, () => dexscreener.bestPair(chain, address)).catch(() => null),
      this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } } }),
      this.redis.cached(`risk:${chain}:${address}`, 600, () => goplus.tokenRisk(chain, address).catch(() => null)) as Promise<TokenRisk | null>,
    ]);
    if (!pair && !rowT) return this.msg(`No market found for \`${address}\` yet.`, [], true);
    const intel = chain === 'solana' ? await this.intel.recompute(chain, address).catch(() => null) : null;
    const smartIn = chain === 'solana' ? ((await this.intel.holders(chain, address, 'holding', 'smart', null, 200).catch(() => null))?.length ?? 0) : null;

    const sym = pair?.baseToken.symbol ?? rowT?.symbol ?? '?';
    const name = pair?.baseToken.name ?? rowT?.name ?? '';
    const mc = pair?.marketCap ?? pair?.fdv ?? rowT?.marketCapUsd ?? null;
    const top10 = intel?.top10Pct ?? risk?.top10Pct ?? null;
    const devPct = intel?.devPct ?? risk?.devPct ?? null;
    const holders = intel?.holders ?? risk?.holders ?? rowT?.holders ?? null;
    const socials = pair?.socials;
    const created = pair?.pairCreatedAt ?? rowT?.createdAt?.toISOString() ?? null;

    let score = 10;
    if (risk?.honeypot) score -= 6;
    if (risk?.mintable) score -= 2;
    if (risk?.freezable) score -= 1;
    if ((top10 ?? 0) > 30) score -= 2;
    if ((intel?.bundlerPct ?? 0) > 10) score -= 2;
    if ((intel?.sniperPct ?? 0) > 10) score -= 1;
    if ((intel?.insiderPct ?? 0) > 5) score -= 1;
    if (socials && !socials.x && !socials.telegram && !socials.website) score -= 1;
    score = Math.max(0, score);
    const color = score >= 8 ? ACCENT : score >= 5 ? YELLOW : RED;
    const dot = score >= 8 ? '🟢' : score >= 5 ? '🟡' : '🔴';

    const fields = [
      { name: 'Market cap', value: usd(mc), inline: true },
      { name: 'Liquidity', value: usd(pair?.liquidityUsd), inline: true },
      { name: '24h volume', value: usd(pair?.volume24h), inline: true },
      { name: 'Changes', value: `5m ${pct(pair?.priceChange5m)} · 1h ${pct(pair?.priceChange1h)} · 24h ${pct(pair?.priceChange24h)}`, inline: false },
      { name: 'Holders', value: holders?.toLocaleString('en-US') ?? '–', inline: true },
      { name: 'Top 10', value: pp(top10), inline: true },
      { name: 'Dev', value: `${pp(devPct)}${intel?.devSoldAll ? ' (sold)' : intel?.devHolds ? ' (holding)' : ''}`, inline: true },
    ];
    if (intel)
      fields.push({
        name: 'Intel',
        value: `📦 Bundlers ${pp(intel.bundlerPct)} · 🎯 Snipers ${pp(intel.sniperPct)} · 🕵️ Insiders ${pp(intel.insiderPct)} · 🌱 Fresh ${pp(intel.freshPct)}`,
        inline: false,
      });
    if (risk) fields.push({ name: 'Safety checks', value: `Mint ${yn(risk.mintable)} · Freeze ${yn(risk.freezable)} · Honeypot ${yn(risk.honeypot)}`, inline: false });
    if (smartIn != null) fields.push({ name: 'Smart wallets holding', value: String(smartIn), inline: true });

    const e: Embed = {
      title: `${dot} $${sym}${name ? ` · ${name}` : ''}`,
      url: this.coinUrl(chain, address),
      description: `${CH_NAME[chain]}${pair?.dex ? ` · ${pair.dex}` : ''} · ${age(created)} old · **Safety ${score}/10**\n\`${address}\``,
      color,
      fields,
      footer: { text: 'Magura · FIND. TRADE. REPEAT.' },
      timestamp: new Date().toISOString(),
    };
    const extra = chain === 'solana' ? [btn('👥 Holders', `h:${chain}:${address}`), btn('👨‍💻 Dev', `d:${chain}:${address}`)] : [];
    return this.embed(e, [
      row(link(`⚡ Trade $${sym}`, this.coinUrl(chain, address)), link('📊 Chart', `https://dexscreener.com/${DS_SLUG[chain]}/${address}`)),
      row(btn('🔄 Refresh', `r:${chain}:${address}`), ...extra),
    ]);
  }

  private async holdersView(chain: ChainId, address: string): Promise<Resp> {
    const rows = (await this.intel.holders(chain, address, 'holding', null, null, 12).catch(() => null)) ?? [];
    const rowT = await this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } }, select: { symbol: true } });
    const desc = rows.length
      ? rows
          .map(
            (r, idx) =>
              `**${idx + 1}.** [${short(r.wallet)}](${this.web}/w/${chain}/${r.wallet}) ${pp(r.pctSupply)}${r.tags.length ? ` \`${r.tags.map((t) => t.toUpperCase()).join(' ')}\`` : ''}`,
          )
          .join('\n')
      : 'No holder data yet.';
    return this.embed({ title: `👥 Top holders · $${rowT?.symbol ?? '?'}`, description: desc, color: ACCENT }, [
      row(btn('← Back to coin', `r:${chain}:${address}`), btn('👨‍💻 Dev', `d:${chain}:${address}`)),
    ]);
  }

  private async devByAddr(chain: ChainId, address: string): Promise<Resp> {
    const rowT = await this.prisma.db.token.findUnique({ where: { chain_address: { chain, address } }, select: { creator: true, symbol: true } });
    if (!rowT?.creator)
      return this.embed({ title: `👨‍💻 Dev`, description: `No dev wallet known for $${rowT?.symbol ?? '?'}.`, color: ACCENT }, [row(btn('← Back to coin', `r:${chain}:${address}`))]);
    const e = await this.devEmbed(chain, rowT.creator);
    return this.embed(e, [row(btn('← Back to coin', `r:${chain}:${address}`), link('Open dev wallet', `${this.web}/w/${chain}/${rowT.creator}`))]);
  }

  private async devEmbed(chain: ChainId, creator: string): Promise<Embed> {
    const d = await this.redis.cached(`devr:${chain}:${creator}`, 30, () => this.intel.devReport(chain, creator));
    const verdict =
      d.launched >= 5 && d.migratedPct < 5
        ? '🔴 Serial launcher, almost nothing migrates'
        : d.quickRugs > 2
          ? '🔴 Sold early on several coins'
          : d.migratedPct >= 20
            ? '🟢 Strong track record'
            : '🟡 Mixed track record';
    return {
      title: `👨‍💻 Dev ${short(creator)}`,
      description: `${verdict}\n\n**Launched** ${d.launched} · **Migrated** ${d.migrated} (${d.migratedPct}%) · **Sold <1h** ${d.quickRugs}\n${d.best ? `Best: $${d.best.symbol} · ATH ${usd(d.best.athMarketCapUsd)}` : ''}\n\n${d.tokens
        .slice(0, 6)
        .map((t) => `• $${t.symbol} · ${usd(t.marketCapUsd)}${t.migrated ? ' · migrated' : ''}${t.devSold ? ' · dev sold' : ''}`)
        .join('\n')}`,
      color: ACCENT,
    };
  }

  private async devCard(arg: string): Promise<Resp> {
    const a = arg.match(SOL_RE)?.[0];
    if (!a) return this.msg('Give me a Solana dev wallet address.', [], true);
    return this.embed(await this.devEmbed('solana', a), [row(link('Open in Magura', `${this.web}/w/solana/${a}`))]);
  }

  // ───────────────────────── lists

  private async trending(sort: HuntSort): Promise<Resp> {
    const s = (['hot', 'gainers', 'volume', 'm5'] as HuntSort[]).includes(sort) ? sort : 'hot';
    const { items } = await this.redis.cached(`dctrend:${s}`, 30, () => this.hunt.list({ sort: s, filter: EMPTY_FILTER, limit: 10 }, null));
    const title = { hot: '🔥 Trending now', gainers: '🚀 Top gainers (1h)', volume: '📊 Top volume', m5: '⚡ Moving (5m)' }[s as 'hot'];
    const desc = items.length
      ? items
          .map((t, idx) => `**${idx + 1}.** [$${t.symbol}](${this.coinUrl(t.chain, t.address)}) · ${usd(t.marketCapUsd)} · 1h ${pct(t.change1h)} · Vol ${usd(t.volumeUsd)}`)
          .join('\n')
      : 'Nothing yet — try again in a minute.';
    const tab = (k: HuntSort, label: string) => btn(label, `t:${k}`, s === k ? 1 : 2);
    return this.embed({ title, description: desc, color: ACCENT, footer: { text: 'Tap a coin to trade it · /scan to scan any contract' } }, [
      row(tab('hot', 'Hot'), tab('gainers', 'Gainers'), tab('volume', 'Volume'), tab('m5', '5m')),
      row(link('Open Trending', `${this.web}/trending`)),
    ]);
  }

  private async fresh(stage: 'new' | 'almost' | 'survived'): Promise<Resp> {
    const st = (['new', 'almost', 'survived'] as const).includes(stage) ? stage : 'new';
    const { items } = await this.redis.cached(`dcnew:${st}`, 15, () => this.trenches.list(st, EMPTY_FILTER, 10, null));
    const title = { new: '🆕 New pairs', almost: '⏳ Final stretch', survived: '🚀 Migrated' }[st];
    const desc = items.length
      ? items
          .map(
            (t, idx) =>
              `**${idx + 1}.** [$${t.symbol}](${this.coinUrl(t.chain, t.address)}) · ${usd(t.marketCapUsd)} · ${age(t.createdAt)}${t.bondingPct != null && t.bondingPct < 100 ? ` · curve ${t.bondingPct.toFixed(0)}%` : ''}`,
          )
          .join('\n')
      : 'Nothing yet — try again in a minute.';
    const tab = (k: typeof st, label: string) => btn(label, `n:${k}`, st === k ? 1 : 2);
    return this.embed({ title, description: desc, color: ACCENT }, [
      row(tab('new', 'New'), tab('almost', 'Final stretch'), tab('survived', 'Migrated')),
      row(link('Open Trenches', `${this.web}/trenches`)),
    ]);
  }

  private async smartTop(w: Window): Promise<Resp> {
    const win = (['1d', '7d', '30d'] as Window[]).includes(w) ? w : '1d';
    const rows = (await this.smart.rank(win, 'pnl', 30)).filter((r) => r.pnl > 0).slice(0, 10);
    const medal = ['🥇', '🥈', '🥉'];
    const desc = rows.length
      ? rows
          .map(
            (r, idx) =>
              `${medal[idx] ?? `**${idx + 1}.**`} [${short(r.wallet)}](${this.web}/w/solana/${r.wallet}) +${r.pnl.toFixed(1)} SOL · ${r.winRate?.toFixed(0) ?? '–'}% win · ${r.buys + r.sells} trades`,
          )
          .join('\n')
      : 'Still collecting today’s trades.';
    const tab = (k: Window, label: string) => btn(label, `s:${k}`, win === k ? 1 : 2);
    return this.embed(
      {
        title: `🧠 Smart money · ${win.toUpperCase()}`,
        description: `Most profitable wallets on Solana\n\n${desc}`,
        color: ACCENT,
        footer: { text: 'Copy or track any wallet in Magura' },
      },
      [row(tab('1d', '1D'), tab('7d', '7D'), tab('30d', '30D')), row(link('Copy a wallet', `${this.web}/copy`))],
    );
  }

  private async signalList(f: string): Promise<Resp> {
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
    const desc = list.length
      ? list.map((s) => `${icon[s.kind] ?? '•'} [$${s.symbol}](${this.coinUrl(s.chain, s.address)}) · ${s.detail} · ${usd(s.marketCapUsd)} · ${age(s.at)} ago`).join('\n')
      : 'Quiet right now.';
    const tab = (k: string, label: string) => btn(label, `g:${k}`, key === k ? 1 : 2);
    return this.embed({ title: '📡 Live signals', description: desc, color: ACCENT }, [
      row(tab('all', 'All'), tab('smart', 'Smart'), tab('whale', 'Whales'), tab('mig', 'Migrated'), tab('dev', 'Dev sells')),
      row(link('Open Monitor', `${this.web}/monitor`)),
    ]);
  }

  private async walletCard(arg: string): Promise<Resp> {
    const a = arg.match(SOL_RE)?.[0];
    if (!a) return this.msg('Give me a Solana wallet address.', [], true);
    const w = await this.smart.wallet('solana', a);
    const line = (k: '1d' | '7d' | '30d') => {
      const s = w.windows[k];
      return s
        ? `**${k.toUpperCase()}** ${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)} SOL · ${s.winRate?.toFixed(0) ?? '–'}% win · ${s.buys + s.sells} trades`
        : `**${k.toUpperCase()}** –`;
    };
    const fields = [{ name: 'PnL', value: [line('1d'), line('7d'), line('30d')].join('\n'), inline: false }];
    if (w.holdings.length)
      fields.push({
        name: 'Holding',
        value: w.holdings
          .slice(0, 5)
          .map((h) => `[$${h.symbol}](${this.coinUrl('solana', h.address)}) · MC ${usd(h.marketCapUsd)} · in ${h.spent.toFixed(2)} SOL`)
          .join('\n'),
        inline: false,
      });
    if (w.trades.length)
      fields.push({
        name: 'Last trades',
        value: w.trades
          .slice(0, 5)
          .map((t) => `${t.side === 'buy' ? '🟢' : '🔴'} ${t.side} $${t.symbol} · ${t.native.toFixed(2)} SOL · ${age(t.at)} ago`)
          .join('\n'),
        inline: false,
      });
    return this.embed({ title: `👛 ${short(a)}${w.smart ? ' · 🧠 SMART' : ''}${w.handle ? ` · @${w.handle}` : ''}`, color: ACCENT, fields }, [
      row(link('Open wallet', `${this.web}/w/solana/${a}`), link('Copy this wallet', `${this.web}/copy?wallet=${a}`)),
    ]);
  }

  private async prices(): Promise<Resp> {
    const raw = await this.redis.client.get('majors');
    const px = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const f = (k: string) => (px[k] ? `$${px[k].toLocaleString('en-US', { maximumFractionDigits: px[k] < 10 ? 4 : 2 })}` : '–');
    return this.embed(
      {
        title: '💲 Prices',
        color: ACCENT,
        fields: [
          { name: 'SOL', value: f('SOL'), inline: true },
          { name: 'ETH', value: f('ETH'), inline: true },
          { name: 'BNB', value: f('BNB'), inline: true },
          { name: 'BTC', value: f('BTC'), inline: true },
        ],
        footer: { text: `${new Date().toISOString().slice(11, 19)} UTC` },
      },
      [row(btn('🔄 Refresh', 'p:x'))],
    );
  }
}

type Resp = Record<string, unknown>;
