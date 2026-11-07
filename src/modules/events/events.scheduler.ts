import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventsService } from './events.service';

@Injectable()
export class EventsScheduler {
  private readonly logger = new Logger(EventsScheduler.name);

  constructor(private readonly eventsService: EventsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireOverdue(): Promise<void> {
    try {
      await this.eventsService.expireOverdue();
    } catch (error) {
      this.logger.error('Failed to expire overdue events', error instanceof Error ? error.stack : error);
    }
  }
}
