import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ImagesModule } from '../images/images.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventModerationNotifier } from './event-moderation.notifier';
import { EventsController } from './events.controller';
import { EventsScheduler } from './events.scheduler';
import { EventsService } from './events.service';

@Module({
  imports: [PrismaModule, AuthModule, ImagesModule, NotificationsModule],
  controllers: [EventsController],
  providers: [EventsService, EventsScheduler, EventModerationNotifier],
})
export class EventsModule {}
