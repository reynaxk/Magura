# Magura API — NestJS (Railway / Docker)
FROM node:22-slim AS base
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @magura/shared build && pnpm --filter @magura/chains build && pnpm --filter @magura/db build && pnpm --filter @magura/api build
RUN pnpm deploy --filter @magura/api --prod --legacy /out && cp -r apps/api/dist /out/dist && cp -r packages/db/prisma packages/db/prisma.config.ts /out/

FROM base AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
EXPOSE 4000
CMD ["node", "dist/main.js"]
