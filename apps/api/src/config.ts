import 'dotenv/config';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  PRIVY_AUTHORIZATION_PRIVATE_KEY: z.string().optional(),
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
});

export const env = Env.parse(process.env);

export const devAuthEnabled = env.NODE_ENV !== 'production' && env.DEV_AUTH === '1';
