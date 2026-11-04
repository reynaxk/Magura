import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { CHAIN_IDS, type ChainId } from '@magura/shared';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new BadRequestException({ error: 'invalid_request', issues: r.error.issues });
  return r.data;
}

export const zChain = z.enum(CHAIN_IDS as [ChainId, ...ChainId[]]);
export const zHandle = z.string().regex(/^[a-z0-9_.]{2,20}$/i);
export const zMoney = z.coerce.number().nonnegative().max(10_000_000);
