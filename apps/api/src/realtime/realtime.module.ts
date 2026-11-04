import { Global, Module } from '@nestjs/common';
import { ChatController } from '../chat/chat.controller';
import { ChatService } from '../chat/chat.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  controllers: [ChatController],
  providers: [RealtimeService, RealtimeGateway, ChatService],
  exports: [RealtimeService, ChatService],
})
export class RealtimeModule {}
