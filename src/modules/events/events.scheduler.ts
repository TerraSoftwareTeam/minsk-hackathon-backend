import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventsService } from './events.service';

@Injectable()
export class EventsScheduler {
  private readonly logger = new Logger(EventsScheduler.name);

  constructor(private readonly eventsService: EventsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processDeadlines(): Promise<void> {
    try {
      // Voting first: an event it moves to admin moderation then has until its start there.
      await this.eventsService.closeVoting();
      await this.eventsService.expireOverdue();
    } catch (error) {
      this.logger.error('Failed to process event deadlines', error instanceof Error ? error.stack : error);
    }
  }
}
