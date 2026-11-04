import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { buildSwapTx, evmClient, getQuote, solanaRpc } from '@magura/chains';
import type { Chain, Trade, User } from '@magura/db';
import { CHAINS, EVM_NATIVE, roomIds, toBaseUnits, type ChainId, type SwapQuote, type TradeAttachment } from '@magura/shared';
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
    return px[CHAINS[chain].nativeSymbol] ?? null;
  }

  async quote(q: QuoteInput): Promise<SwapQuote & { quoteId: string; amountUsd: number | null }> {
    const c = CHAINS[q.chain];
    const native = c.kind === 'svm' ? c.quoteToken.address : EVM_NATIVE;
    const [input, output] = q.side === 'buy' ? [native, q.token] : [q.token, native];
    const amount = q.side === 'buy' ? toBaseUnits(q.amount, c.kind === 'svm' ? 9 : 18) : q.amount;
    if (amount === '0') throw new BadRequestException('amount_zero');
    const quote = await getQuote({ chain: q.chain, inputToken: input, outputToken: output, amount, slippageBps: q.slippageBps, userAddress: q.wallet });
    const nUsd = await this.nativeUsd(q.chain);
    const nativeAmount = q.side === 'buy' ? quote.inAmount : quote.outAmount;
    const amountUsd = nUsd ? (Number(nativeAmount) / 10 ** (c.kind === 'svm' ? 9 : 18)) * nUsd : null;
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
    if (input.quoteId) {
      const raw = await this.redis.client.get(`quote:${input.quoteId}`);
      if (raw) {
        const { quote, amountUsd: qUsd } = JSON.parse(raw) as { quote: SwapQuote; amountUsd: number | null };
        amountIn = quote.inAmount;
        amountOut = quote.outAmount;
        provider = quote.provider;
        amountUsd = amountUsd ?? qUsd;
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
