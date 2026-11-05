import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@magura/db';
import { CurrentUser } from '../auth/auth.guard';
import { parse, zChain } from '../common/zod';
import { OrdersService } from './orders.service';

const zOrder = z
  .object({
    chain: zChain,
    tokenAddress: z.string().min(20).max(80),
    tokenSymbol: z.string().min(1).max(20),
    kind: z.enum(['tp', 'sl', 'trail', 'limit_buy']),
    triggerPct: z.number().min(1).max(10_000).optional(),
    triggerMcUsd: z.number().positive().max(1e13).optional(),
    sellPct: z.number().int().min(1).max(100).optional(),
    buyAmount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
    slippageBps: z.number().int().min(10).max(5000).optional(),
  })
  .refine((o) => (o.kind === 'limit_buy' ? !!o.triggerMcUsd && !!o.buyAmount : !!o.triggerPct && !!o.sellPct), { message: 'missing_fields' })
  .refine((o) => o.kind !== 'sl' || (o.triggerPct ?? 0) <= 95, { message: 'stop_loss_max_95' })
  .refine((o) => o.kind !== 'trail' || (o.triggerPct ?? 0) <= 90, { message: 'trail_max_90' });

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() q: Record<string, string>, @CurrentUser() user: User) {
    const p = parse(z.object({ chain: zChain.optional(), token: z.string().optional() }), q);
    return this.orders.list(user, p.chain && p.token ? { chain: p.chain, address: p.chain === 'solana' ? p.token : p.token.toLowerCase() } : undefined);
  }

  @Post()
  create(@Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ orders: z.array(zOrder).min(1).max(6) }), body);
    return this.orders.create(
      user,
      b.orders.map((o) => ({ ...o, tokenAddress: o.chain === 'solana' ? o.tokenAddress : o.tokenAddress.toLowerCase() })),
    );
  }

  @Delete(':id')
  cancel(@Param('id') id: string, @CurrentUser() user: User) {
    return this.orders.cancel(user, id);
  }

  @Post(':id/done')
  done(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: User) {
    const b = parse(z.object({ txHash: z.string().max(200).nullable().optional(), skipped: z.boolean().optional() }), body);
    return this.orders.markDone(user, id, b.txHash ?? null, b.skipped);
  }
}
