# Magura — FIND.TRADE.REPEAT

Social **spot** trading terminal: trade together, copy the best, and every coin has its own live chat.
No perps, no leverage — by design.

**Chains:** Solana · Base · BNB Chain · Ethereum

## What's inside

| | |
|---|---|
| **Terminal** | Chart (GeckoTerminal OHLCV), spot buy/sell (Jupiter on Solana, KyberSwap on EVM), GoPlus risk, Polymarket predictions, coin room + world chat |
| **Trenches** | Live **New Pairs → Almost Survived → Survived** from Pump.fun (PumpPortal), Clanker, Four.meme / Flap / Pons (on-chain factory events) and DEX new pools; quick buy; friends who aped; coin rooms |
| **Fees** | Size-tiered platform fee in SOL/ETH/BNB: from 2% ($2–24.99) down to 0.20% ($25,000+) across 10 size tiers — see `packages/shared/src/fees.ts`. Min trade $2. Users pay their own gas. Set `FEE_WALLET_SOLANA` and `FEE_WALLET_EVM` to receive fees |
| **Copy trading** | Leaderboard (realized spot PnL), proportional or fixed sizing, max per buy, auto-stop at loss, memecoin filter, copy sells. Runs automatically through Privy session signers or asks the copier to confirm |
| **Social** | World chat, a room per coin, groups with channels + spot call cards, DMs with message requests, notifications + Web Push |
| **Calls & Live** | 1:1 voice/video, group voice rooms, screen/chart sharing, live streams — all via Cloudflare Realtime (SFU) |

## Stack

`apps/web` Next.js 15 · Tailwind v4 · Privy · TanStack Query · Socket.IO · lightweight-charts
`apps/api` NestJS 11 · Socket.IO (Redis adapter) · Prisma 7 · PostgreSQL · Redis · Sentry
`packages/chains` market data, swaps, launchpads, security, RPC (QuickNode → Helius → public)
`packages/db` Prisma schema + client · `packages/shared` types, chain config, socket contract

## Run locally

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # DEV_AUTH=1 lets you log in without Privy
cp apps/web/.env.example apps/web/.env
cp packages/db/.env.example packages/db/.env
pnpm infra:up                               # Postgres + Redis in Docker
pnpm db:migrate --name init                 # first time: creates prisma/migrations
pnpm db:seed                                # world chat + Magura HQ group
pnpm dev                                    # web :3000, api :4000
```

Without `NEXT_PUBLIC_PRIVY_APP_ID`, the web app shows **Dev login** (any handle). Trading needs a real wallet, so set up Privy to test swaps.

## Deploy (Railway)

Two services from this repo plus Postgres and Redis plugins:

- **api** → Dockerfile `apps/api/Dockerfile`, pre-deploy `node_modules/.bin/prisma db push`, health check `/health`
- **web** → Dockerfile `apps/web/Dockerfile` (`NEXT_PUBLIC_*` vars are read at build time)

Set every variable from `apps/api/.env.example`. Keep `DEV_AUTH` unset in production (it's ignored when `NODE_ENV=production` anyway).

## Keys you need

| Service | Env | Used for |
|---|---|---|
| Privy | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_PRIVATE_KEY`, `NEXT_PUBLIC_PRIVY_APP_ID` | Login, embedded wallets, delegated copy execution |
| QuickNode / Helius | `QUICKNODE_*_URL`, `HELIUS_RPC_URL` | RPC (public fallbacks exist) |
| Jupiter | `JUPITER_API_KEY` (optional) | Higher rate limits |
| Cloudflare Realtime | `CF_REALTIME_APP_ID`, `CF_REALTIME_APP_TOKEN`, `CF_TURN_KEY_*` | Calls, voice rooms, streams |
| GoPlus | `GOPLUS_ACCESS_TOKEN` (optional) | Token risk |
| Sightengine | `SIGHTENGINE_USER/SECRET` | Image moderation |
| Web Push | `VAPID_PUBLIC_KEY/PRIVATE_KEY` | Push notifications (`npx web-push generate-vapid-keys`) |
| Sentry | `SENTRY_DSN` | Errors |

## To port from the old terminal

- **Four.meme / Flap / Pons**: set `*_FACTORY` and `*_CREATE_EVENT` (event signature with a `token` address arg). Unset launchpads are skipped.
- **Bitquery**: key slot exists (`BITQUERY_API_KEY`), not wired yet.
- **OpenOcean**: available as an EVM fallback in `packages/chains/src/swap/openocean.ts`; call it from the API only (Cloudflare blocked it before).

## Tests

```bash
pnpm --filter @magura/api build && pnpm --filter @magura/api test   # PnL, trenches stages, copy engine (needs Postgres + Redis)
pnpm --filter @magura/web test:e2e                                   # Playwright smoke tests against a running stack
```
