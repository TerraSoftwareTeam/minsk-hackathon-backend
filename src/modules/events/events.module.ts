import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EventsController } from './events.controller';
import { EventsScheduler } from './events.scheduler';
import { EventsService } from './events.service';

@Module({
  // AuthModule provides JwtService for JwtAuthGuard.
  imports: [PrismaModule, AuthModule],
  controllers: [EventsController],
  providers: [EventsService, EventsScheduler],
})
export class EventsModule {}
