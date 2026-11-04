import { Controller, Get, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Public } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BootstrapService } from './common/bootstrap.service';
import { InfraModule, PrismaService, RedisService } from './common/infra.module';
import { MarketController } from './market/market.controller';
import { TrenchesService } from './market/trenches.service';
import { ModerationModule } from './moderation/moderation.service';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RtcController } from './rtc/rtc.controller';
import { DmsController } from './social/dms.controller';
import { GroupsController } from './social/groups.controller';
import { CopyService } from './trading/copy.service';
import { TradingController } from './trading/trading.controller';
import { TradingService } from './trading/trading.service';
import { UsersController } from './users/users.controller';

@Controller()
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    const [db, cache] = await Promise.all([
      this.prisma.db.$queryRaw`SELECT 1`.then(() => 'ok').catch(() => 'down'),
      this.redis.client.ping().then(() => 'ok').catch(() => 'down'),
    ]);
    return { status: db === 'ok' && cache === 'ok' ? 'ok' : 'degraded', db, redis: cache, spotOnly: true };
  }
}

@Module({
  imports: [ScheduleModule.forRoot(), InfraModule, AuthModule, RealtimeModule, NotificationsModule, ModerationModule],
  controllers: [
    HealthController,
    UsersController,
    MarketController,
    TradingController,
    GroupsController,
    DmsController,
    RtcController,
  ],
  providers: [BootstrapService, TrenchesService, TradingService, CopyService],
})
export class AppModule {}
