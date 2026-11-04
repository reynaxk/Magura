import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // Read lazily: `prisma generate` runs at build time without a database.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
