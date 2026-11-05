import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { buildSwapTx, dexscreener, evmClient, getQuote, nativeBalance, solanaRpc } from '@magura/chains';
import type { Chain, Trade, User } from '@magura/db';
import {
  CHAINS,
  EVM_NATIVE,
  GAS_RESERVE,
  MIN_TRADE_USD,
  TradeTooSmallError,
  feeBpsFor,
  roomIds,
  toBaseUnits,
  type ChainId,
  type SwapQuote,
  type TradeAttachment,
} from '@magura/shared';
import { env } from '../config';
import { ChatService } from '../chat/chat.service';
import { PrismaService, RedisService } from '../common/infra.module';

export interface QuoteInput {
  chain: ChainId;
  side: 'buy' | 'sell';
  token: string;
  /** buy: human amount of the chain's native coin (e.g. "0.5" SOL). sell: base units of the token. */
  amount: string;
  slippageBps: number;
  wallet: string;
}

export interface RecordTradeInput {
  quoteId?: string;
  chain: ChainId;
  side: 'buy' | 'sell';
  tokenAddress: string;
  tokenSymbol: string;
  txHash: string;
  amountUsd?: number;
  /** Seller only: % of position sold (for copy sells). */
  pct?: number;
  /** Optional client-reported wallet value — used for proportional copy sizing. */
  portfolioUsd?: number;
  shareToRoom?: boolean;
  source?: 'manual' | 'quickbuy' | 'copy' | 'call';
  copyExecutionId?: string;
}

type ConfirmedListener = (trade: Trade, meta: { pct?: number; portfolioUsd?: number }) => Promise<void>;

@Injectable()
export class TradingService {
  private readonly log = new Logger('trading');
  private listeners: ConfirmedListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly chat: ChatService,
  ) {}

  onConfirmed(fn: ConfirmedListener) {
    this.listeners.push(fn);
  }

  majors(): Promise<Record<string, number | null>> {
    return this.redis.client.get('majors').then((r) => (r ? JSON.parse(r) : {}));
  }

  async nativeUsd(chain: ChainId): Promise<number | null> {
    const px = await this.majors();
    const hit = px[CHAINS[chain].nativeSymbol];
    if (hit) return hit;
    // fallback: price of the wrapped native coin on DexScreener
    return this.redis.cached(`native:${chain}`, 60, async () => {
      const p = await dexscreener.bestPair(chain, CHAINS[chain].quoteToken.address).catch(() => null);
      return p?.priceUsd ?? null;
    });
  }

  /**
   * Quote a spot trade with Magura's size-tiered fee.
   * The trade is valued in USD first (buys: native spent, sells: native received),
   * that picks the tier, and the fee is charged in the chain's native coin.
   */
  async quote(q: QuoteInput): Promise<SwapQuote & { quoteId: string; amountUsd: number | null }> {
    const c = CHAINS[q.chain];
    const svm = c.kind === 'svm';
    const dec = svm ? 9 : 18;
    const native = svm ? c.quoteToken.address : EVM_NATIVE;
    const nUsd = await this.nativeUsd(q.chain);
    if (!nUsd) throw new BadRequestException('price_unavailable');
    const receiver = (svm ? env.FEE_WALLET_SOLANA : env.FEE_WALLET_EVM) ?? null;
    const toUsd = (base: string | bigint) => (Number(base) / 10 ** dec) * nUsd;
    const bpsFor = (usd: number) => {
      try {
        return feeBpsFor(q.chain, usd);
      } catch (e) {
        if (e instanceof TradeTooSmallError) throw new BadRequestException(`min_trade_${MIN_TRADE_USD}_usd`);
        throw e;
      }
    };

    let quote: SwapQuote;
    let amountUsd: number;
    const balance = await nativeBalance(q.chain, q.wallet).catch(() => null); // RPC down → don't block, the chain will
    const reserve = BigInt(GAS_RESERVE[q.chain].base);
    if (q.side === 'buy') {
      const gross = BigInt(toBaseUnits(q.amount, dec));
      if (gross === 0n) throw new BadRequestException('amount_zero');
      if (balance != null && gross + reserve > balance) {
        const max = balance > reserve ? balance - reserve : 0n;
        throw new BadRequestException({
          error: 'low_gas',
          message: `Keep ${GAS_RESERVE[q.chain].human} ${c.nativeSymbol} for gas. Max buy: ${(Number(max) / 10 ** dec).toFixed(svm ? 4 : 6)} ${c.nativeSymbol}`,
          maxBuy: (Number(max) / 10 ** dec).toString(),
        });
      }
      amountUsd = toUsd(gross);
      const bps = receiver ? bpsFor(amountUsd) : (bpsFor(amountUsd), 0);
      const req = { chain: q.chain, inputToken: native, outputToken: q.token, slippageBps: q.slippageBps, userAddress: q.wallet };
      if (svm) {
        const fee = (gross * BigInt(bps)) / 10_000n;
        quote = await getQuote({ ...req, amount: (gross - fee).toString() });
        quote.fee = { bps, amount: fee.toString(), usd: toUsd(fee), side: 'in', receiver };
        quote.inAmount = gross.toString(); // what leaves the wallet, fee included
      } else {
        quote = await getQuote({ ...req, amount: gross.toString() }, receiver && bps ? { bps, side: 'in', receiver } : undefined);
        quote.fee.usd = toUsd(quote.fee.amount);
      }
    } else {
      if (!/^\d+$/.test(q.amount) || q.amount === '0') throw new BadRequestException('amount_zero');
      if (balance != null && balance < reserve / 2n) {
        throw new BadRequestException({ error: 'low_gas', message: `Add some ${c.nativeSymbol} to pay gas for this sell` });
      }
      const req = { chain: q.chain, inputToken: q.token, outputToken: native, amount: q.amount, slippageBps: q.slippageBps, userAddress: q.wallet };
      const pre = await getQuote(req);
      amountUsd = toUsd(pre.outAmount);
      const bps = receiver ? bpsFor(amountUsd) : (bpsFor(amountUsd), 0);
      if (svm) {
        quote = pre;
        // charged on the guaranteed minimum so the transfer can never exceed what arrives
        const fee = (BigInt(pre.minOutAmount) * BigInt(bps)) / 10_000n;
        quote.fee = { bps, amount: fee.toString(), usd: toUsd(fee), side: 'out', receiver };
      } else {
        quote = receiver && bps ? await getQuote(req, { bps, side: 'out', receiver }) : pre;
        quote.fee.usd = toUsd(quote.fee.amount);
      }
    }

    if (!receiver) this.log.warn(`No fee wallet set for ${q.chain} — trade quoted without a Magura fee`);
    const quoteId = randomUUID();
    await this.redis.client.set(`quote:${quoteId}`, JSON.stringify({ quote, wallet: q.wallet, amountUsd }), 'EX', 120);
    return { ...quote, quoteId, amountUsd };
  }

  async build(quoteId: string) {
    const raw = await this.redis.client.get(`quote:${quoteId}`);
    if (!raw) throw new NotFoundException('quote_expired');
    const { quote, wallet } = JSON.parse(raw) as { quote: SwapQuote; wallet: string };
    return buildSwapTx(quote, wallet);
  }

  /** Called after the client submitted the signed tx. Confirmation happens in the background. */
  async record(user: User, input: RecordTradeInput): Promise<Trade> {
    let amountIn = '0';
    let amountOut = '0';
    let amountUsd = input.amountUsd ?? null;
    let provider = 'unknown';
    let feeBps: number | null = null;
    let feeUsd: number | null = null;
    if (input.quoteId) {
      const raw = await this.redis.client.get(`quote:${input.quoteId}`);
      if (raw) {
        const { quote, amountUsd: qUsd } = JSON.parse(raw) as { quote: SwapQuote; amountUsd: number | null };
        amountIn = quote.inAmount;
        amountOut = quote.outAmount;
        provider = quote.provider;
        amountUsd = amountUsd ?? qUsd;
        feeBps = quote.fee?.bps ?? null;
        feeUsd = quote.fee?.usd ?? null;
      }
    }
    const tokenAddress = input.chain === 'solana' ? input.tokenAddress : input.tokenAddress.toLowerCase();
    const trade = await this.prisma.db.trade.create({
      data: {
        userId: user.id,
        chain: input.chain as Chain,
        side: input.side,
        tokenAddress,
        tokenSymbol: input.tokenSymbol,
        amountIn,
        amountOut,
        amountUsd: amountUsd ?? undefined,
        feeBps,
        feeUsd: feeUsd ?? undefined,
        provider,
        txHash: input.txHash,
        source: input.source ?? 'manual',
        copyExecutionId: input.copyExecutionId,
        sharedToRoom: input.shareToRoom ? roomIds.coin(input.chain, tokenAddress) : null,
      },
    });
    void this.confirm(trade, { pct: input.pct, portfolioUsd: input.portfolioUsd });
    return trade;
  }

  private async confirm(trade: Trade, meta: { pct?: number; portfolioUsd?: number }) {
    const ok = await this.waitForTx(trade.chain as ChainId, trade.txHash!).catch(() => false);
    const updated = await this.prisma.db.trade.update({ where: { id: trade.id }, data: { status: ok ? 'confirmed' : 'failed' } });
    if (!ok) return;
    if (updated.sharedToRoom) {
      const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: trade.userId } });
      const attachment: TradeAttachment = {
        kind: 'trade',
        side: trade.side as 'buy' | 'sell',
        chain: trade.chain as ChainId,
        token: { address: trade.tokenAddress, symbol: trade.tokenSymbol },
        amountUsd: trade.amountUsd ? Number(trade.amountUsd) : null,
        price: null,
        pct: meta.pct ?? null,
        txHash: trade.txHash,
      };
      await this.chat.send(user, updated.sharedToRoom, '', attachment).catch(() => undefined);
    }
    for (const l of this.listeners) await l(updated, meta).catch((e) => this.log.warn(`listener: ${(e as Error).message}`));
  }

  /** Poll for confirmation up to ~90s. */
  async waitForTx(chain: ChainId, txHash: string): Promise<boolean> {
    for (let i = 0; i < 45; i++) {
      try {
        if (chain === 'solana') {
          const r = await solanaRpc<{ value: ({ confirmationStatus: string; err: unknown } | null)[] }>('getSignatureStatuses', [
            [txHash],
            { searchTransactionHistory: false },
          ]);
          const st = r.value[0];
          if (st?.err) return false;
          if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return true;
        } else {
          const rcpt = await evmClient(chain)
            .getTransactionReceipt({ hash: txHash as `0x${string}` })
            .catch(() => null);
          if (rcpt) return rcpt.status === 'success';
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }
}
