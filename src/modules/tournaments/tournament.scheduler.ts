import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TournamentStatus } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StageEngineService } from './stage-engine.service';

/**
 * Starts due school stages once a minute. Safe with several app instances:
 * StageEngineService.startSchoolStageIfDue is idempotent (row lock + conditional update).
 * Later stages are not timed: they start when the previous stage's last final is recorded.
 */
@Injectable()
export class TournamentScheduler {
  private readonly logger = new Logger(TournamentScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: StageEngineService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'tournament-school-stage-start',
    timeZone: 'UTC',
  })
  async startDueSchoolStages(): Promise<void> {
    if (this.running) return;
    const now = new Date();
    this.running = true;
    try {
      const due = await this.prisma.tournament.findMany({
        where: {
          status: TournamentStatus.REGISTRATION,
          schoolStageStartAt: { lte: now },
        },
        select: { id: true },
      });
      for (const { id } of due) {
        try {
          await this.engine.startSchoolStageIfDue(id, now);
        } catch (error) {
          this.logger.error(
            `Failed to start school stage of tournament ${id}`,
            error as Error,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
