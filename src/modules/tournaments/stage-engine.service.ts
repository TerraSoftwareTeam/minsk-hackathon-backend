import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BracketStatus,
  District,
  GameSlot,
  GameStatus,
  Prisma,
  StageStatus,
  StageType,
  TournamentStatus,
} from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateBracket } from './bracket/bracket.generator';
import { LONG_TX, lockTournament, Tx } from './tournament-locks';

export const STAGE_ORDER: readonly StageType[] = [
  StageType.SCHOOL,
  StageType.DISTRICT,
  StageType.CITY,
];
export const ALL_DISTRICTS = Object.values(District);

/** Participants of one bracket: a school (SCHOOL), a district (DISTRICT) or the city (CITY). */
interface BracketGroup {
  schoolId?: string;
  district?: District;
  teamIds: string[];
}

/**
 * Drives the tournament lifecycle:
 *
 * REGISTRATION --(cron, at schoolStageStartAt)--> SCHOOL --> DISTRICT --> CITY --> FINISHED
 *
 * Stage transitions are event-driven: when the last bracket of a stage gets its
 * winner, the stage finishes and the next one is built in the same transaction.
 * A stage whose brackets all have 0 or 1 participants finishes immediately, so
 * the chain also works when, e.g., no school has a full team (the tournament then
 * finishes with winnerTeamId = null).
 */
@Injectable()
export class StageEngineService {
  private readonly logger = new Logger(StageEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Starts the school stage if it is due. Idempotent: returns false if the
   * tournament was already started (by another instance or a previous tick).
   */
  async startSchoolStageIfDue(
    tournamentId: string,
    now = new Date(),
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockTournament(tx, tournamentId, 'update'))) return false;

      const started = await tx.tournament.updateMany({
        where: {
          id: tournamentId,
          status: TournamentStatus.REGISTRATION,
          schoolStageStartAt: { lte: now },
        },
        data: {
          status: TournamentStatus.IN_PROGRESS,
          currentStage: StageType.SCHOOL,
        },
      });
      if (started.count === 0) return false;

      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
      });

      // 1. Drop incomplete teams; their members are released (TeamMember cascades).
      const teams = await tx.tournamentTeam.findMany({
        where: { tournamentId },
        select: {
          id: true,
          schoolId: true,
          _count: { select: { members: true } },
        },
      });
      const incomplete = teams
        .filter((t) => t._count.members < tournament.minTeamSize)
        .map((t) => t.id);
      if (incomplete.length > 0) {
        await tx.tournamentTeam.deleteMany({
          where: { id: { in: incomplete } },
        });
      }
      // 2. Rosters are locked from now on: every roster mutation requires REGISTRATION.

      await tx.tournamentStage.createMany({
        data: STAGE_ORDER.map((type) => ({
          tournamentId,
          type,
          status: StageStatus.PENDING,
        })),
      });

      // 3. One bracket per school, including schools without full teams
      //    (an empty bracket finishes immediately without a winner).
      const schools = await tx.school.findMany({
        select: { id: true },
        orderBy: { name: 'asc' },
      });
      const fullTeams = teams.filter((t) => !incomplete.includes(t.id));
      const groups = schools.map((s) => ({
        schoolId: s.id,
        teamIds: fullTeams.filter((t) => t.schoolId === s.id).map((t) => t.id),
      }));

      this.logger.log(
        `Tournament ${tournamentId}: school stage started, ${fullTeams.length} teams, ${incomplete.length} incomplete removed`,
      );
      await this.startStage(tx, tournamentId, StageType.SCHOOL, groups, now);
      return true;
    }, LONG_TX);
  }

  /**
   * Puts `winnerTeamId` into the next game of `game`, or, for a bracket final,
   * finishes the bracket and possibly the stage. Must run inside the result
   * transaction with the tournament row locked.
   */
  async advanceWinner(
    tx: Tx,
    game: {
      id: string;
      tournamentId: string;
      stageId: string;
      bracketId: string;
      nextGameId: string | null;
      nextSlot: GameSlot | null;
    },
    winnerTeamId: string,
    now = new Date(),
  ): Promise<void> {
    if (game.nextGameId) {
      const slot: Prisma.TournamentGameUncheckedUpdateInput =
        game.nextSlot === GameSlot.A
          ? { teamAId: winnerTeamId }
          : { teamBId: winnerTeamId };
      const next = await tx.tournamentGame.update({
        where: { id: game.nextGameId },
        data: slot,
      });
      if (next.status === GameStatus.PENDING && next.teamAId && next.teamBId) {
        await tx.tournamentGame.update({
          where: { id: next.id },
          data: { status: GameStatus.READY },
        });
      }
      return;
    }

    await tx.tournamentBracket.update({
      where: { id: game.bracketId },
      data: { status: BracketStatus.FINISHED, winnerTeamId, finishedAt: now },
    });
    await this.finishStageIfDone(tx, game.tournamentId, game.stageId, now);
  }

  // ---- stage lifecycle ----

  private async startStage(
    tx: Tx,
    tournamentId: string,
    type: StageType,
    groups: BracketGroup[],
    now: Date,
  ) {
    const stage = await tx.tournamentStage.findUniqueOrThrow({
      where: { tournamentId_type: { tournamentId, type } },
    });
    const moved = await tx.tournamentStage.updateMany({
      where: { id: stage.id, status: StageStatus.PENDING },
      data: { status: StageStatus.IN_PROGRESS, startedAt: now },
    });
    if (moved.count === 0) {
      throw new Error(
        `Stage ${type} of tournament ${tournamentId} was already started`,
      );
    }
    await tx.tournament.update({
      where: { id: tournamentId },
      data: { currentStage: type },
    });

    for (const group of groups) {
      await this.createBracket(tx, tournamentId, stage.id, group, now);
    }
    await this.finishStageIfDone(tx, tournamentId, stage.id, now);
  }

  private async createBracket(
    tx: Tx,
    tournamentId: string,
    stageId: string,
    group: BracketGroup,
    now: Date,
  ) {
    const plan = generateBracket(group.teamIds);
    const finished = plan.games.length === 0; // N = 0 (no winner) or N = 1 (instant winner)

    const bracket = await tx.tournamentBracket.create({
      data: {
        stageId,
        schoolId: group.schoolId ?? null,
        district: group.district ?? null,
        participantsCount: plan.participantsCount,
        size: plan.size,
        rounds: plan.rounds,
        status: finished ? BracketStatus.FINISHED : BracketStatus.IN_PROGRESS,
        winnerTeamId: plan.winner,
        finishedAt: finished ? now : null,
      },
    });
    if (finished) return;

    const ids = new Map(
      plan.games.map((g) => [`${g.round}:${g.position}`, randomUUID()]),
    );
    // Insert later rounds first so nextGameId always points to an existing row.
    const rows = [...plan.games]
      .sort((a, b) => b.round - a.round || a.position - b.position)
      .map((g) => ({
        id: ids.get(`${g.round}:${g.position}`)!,
        tournamentId,
        stageId,
        bracketId: bracket.id,
        round: g.round,
        position: g.position,
        status: g.status as GameStatus,
        teamAId: g.teamA,
        teamBId: g.teamB,
        winnerTeamId: g.winner,
        finishedAt: g.status === 'BYE' ? now : null,
        nextGameId: g.next
          ? ids.get(`${g.next.round}:${g.next.position}`)!
          : null,
        nextSlot: g.next ? (g.next.slot as GameSlot) : null,
      }));
    await tx.tournamentGame.createMany({ data: rows });
  }

  private async finishStageIfDone(
    tx: Tx,
    tournamentId: string,
    stageId: string,
    now: Date,
  ) {
    const open = await tx.tournamentBracket.count({
      where: { stageId, status: { not: BracketStatus.FINISHED } },
    });
    if (open > 0) return;

    const done = await tx.tournamentStage.updateMany({
      where: { id: stageId, status: StageStatus.IN_PROGRESS },
      data: { status: StageStatus.FINISHED, finishedAt: now },
    });
    if (done.count === 0) return;

    const stage = await tx.tournamentStage.findUniqueOrThrow({
      where: { id: stageId },
    });
    const brackets = await tx.tournamentBracket.findMany({
      where: { stageId, winnerTeamId: { not: null } },
      select: {
        winnerTeamId: true,
        winnerTeam: { select: { school: { select: { district: true } } } },
      },
    });
    this.logger.log(
      `Tournament ${tournamentId}: stage ${stage.type} finished, ${brackets.length} winners`,
    );

    switch (stage.type) {
      case StageType.SCHOOL: {
        // One bracket per district, including districts without school winners.
        const groups = ALL_DISTRICTS.map((district) => ({
          district,
          teamIds: brackets
            .filter((b) => b.winnerTeam!.school.district === district)
            .map((b) => b.winnerTeamId!),
        }));
        await this.startStage(
          tx,
          tournamentId,
          StageType.DISTRICT,
          groups,
          now,
        );
        return;
      }
      case StageType.DISTRICT:
        await this.startStage(
          tx,
          tournamentId,
          StageType.CITY,
          [{ teamIds: brackets.map((b) => b.winnerTeamId!) }],
          now,
        );
        return;
      case StageType.CITY:
        await tx.tournament.update({
          where: { id: tournamentId },
          data: {
            status: TournamentStatus.FINISHED,
            winnerTeamId: brackets[0]?.winnerTeamId ?? null,
            finishedAt: now,
          },
        });
        this.logger.log(
          `Tournament ${tournamentId} finished, winner ${brackets[0]?.winnerTeamId ?? 'none'}`,
        );
    }
  }
}
