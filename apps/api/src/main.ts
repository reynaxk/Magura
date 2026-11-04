import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { HttpErrorFilter } from './common/http-error.filter';

async function bootstrap() {
  if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });

  const app = await NestFactory.create(AppModule, { cors: { origin: env.WEB_ORIGIN.split(','), credentials: true } });
  app.use(helmet());
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new HttpErrorFilter());

  const io = new RedisIoAdapter(app);
  await io.connectToRedis(env.REDIS_URL);
  app.useWebSocketAdapter(io);

  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
  console.log(`Magura API on :${env.PORT}`);
}

bootstrap();
