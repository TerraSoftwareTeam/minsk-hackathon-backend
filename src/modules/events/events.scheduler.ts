import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventsService } from './events.service';

@Injectable()
export class EventsScheduler {
  private readonly logger = new Logger(EventsScheduler.name);

  constructor(private readonly eventsService: EventsService) {}

  /** An event can stay ON_VOTE past its start for at most about a minute. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireOverdueVotes(): Promise<void> {
    try {
      await this.eventsService.expireOverdueVotes();
    } catch (error) {
      // A failed run is retried on the next tick; never crash the scheduler.
      this.logger.error('Failed to expire overdue events', error instanceof Error ? error.stack : error);
    }
  }
}
