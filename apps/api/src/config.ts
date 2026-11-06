import 'dotenv/config';
import { z } from 'zod';

/** Pasted keys often carry stray spaces, newlines or wrapping quotes. */
const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/^(['"`])(.*)\1$/s, '$2').trim() || undefined : v);
const key = () => z.preprocess(clean, z.string().optional());

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PRIVY_APP_ID: key(),
  PRIVY_APP_SECRET: key(),
  PRIVY_AUTHORIZATION_PRIVATE_KEY: key(),
  DEV_AUTH: z.string().optional(),
  TRENCHES_WORKER: z.string().default('1'),
  CF_REALTIME_APP_ID: z.string().optional(),
  CF_REALTIME_APP_TOKEN: z.string().optional(),
  CF_TURN_KEY_ID: z.string().optional(),
  CF_TURN_KEY_TOKEN: z.string().optional(),
  SIGHTENGINE_USER: z.string().optional(),
  SIGHTENGINE_SECRET: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:team@magura.app'),
  SENTRY_DSN: z.string().optional(),
  /** Treasury wallets that receive Magura's trading fee. Public addresses, not secrets. */
  FEE_WALLET_SOLANA: z.string().min(32).max(44).optional(),
  FEE_WALLET_EVM: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  /** Public URL of this API (for webhooks), e.g. https://api-production.up.railway.app */
  API_PUBLIC_URL: z.string().url().optional(),
  /** Telegram alerts bot (from @BotFather). */
  TELEGRAM_BOT_TOKEN: key(),
  TELEGRAM_BOT_USERNAME: key(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  /** Coinbase Developer Platform key for the card / Apple Pay onramp. */
  CDP_API_KEY_ID: key(),
  CDP_API_KEY_SECRET: key(),
});

export const env = Env.parse(process.env);

export const devAuthEnabled = env.NODE_ENV !== 'production' && env.DEV_AUTH === '1';
