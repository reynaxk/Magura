import { Controller, Get, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Public } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { AuthService } from './auth/auth.service';
import { BootstrapService } from './common/bootstrap.service';
import { InfraModule, PrismaService, RedisService } from './common/infra.module';
import { MarketController } from './market/market.controller';
import { HuntService } from './market/hunt.service';
import { CoinActivityService } from './market/coin-activity.service';
import { SignerService } from './trading/signer.service';
import { OrdersService } from './trading/orders.service';
import { OrdersController } from './trading/orders.controller';
import { ReferralsService } from './social/referrals.service';
import { ReferralsController } from './social/referrals.controller';
import { FeedController } from './social/feed.controller';
import { CompetitionsController, CompetitionsService } from './social/competitions.controller';
import { OnrampController } from './trading/onramp.controller';
import { PriceAlertsController, PriceAlertsService } from './notifications/price-alerts';
import { AlertsService } from './notifications/alerts.service';
import { TelegramController } from './notifications/telegram.controller';
import { TrackedController } from './market/tracked.controller';
import { WatchlistController } from './market/watchlist.controller';
import { WalletCopyController } from './trading/wallet-copy.controller';
import { WalletCopyService } from './trading/wallet-copy.service';
import { TrenchesService } from './market/trenches.service';
import { IntelService } from './market/intel.service';
import { SmartService } from './market/smart.service';
import { SignalsService } from './market/signals.service';
import { BroadcastService } from './market/broadcast.service';
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
    private readonly auth: AuthService,
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

  /** Login setup check — never returns secret values. */
  @Public()
  @Get('health/auth')
  async healthAuth() {
    await this.auth.checkPrivy();
    return this.auth.privyStatus();
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
    TrackedController, WatchlistController, WalletCopyController,
    OrdersController,
    ReferralsController,
    FeedController,
    TelegramController,
    CompetitionsController,
    OnrampController,
    PriceAlertsController,
  ],
  providers: [BootstrapService, HuntService, CoinActivityService, IntelService, SmartService, SignalsService, BroadcastService, TrenchesService, TradingService, CopyService, SignerService, OrdersService, WalletCopyService, ReferralsService, AlertsService, CompetitionsService, PriceAlertsService],
})
export class AppModule {}
