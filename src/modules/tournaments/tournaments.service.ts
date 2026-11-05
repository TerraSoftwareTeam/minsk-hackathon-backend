import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BracketStatus,
  Prisma,
  StageType,
  Tournament,
  TournamentStatus,
  User,
} from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTournamentDto,
  TournamentResponseDto,
  UpdateTournamentDto,
} from './dto/tournament.dto';
import { ALL_DISTRICTS } from './stage-engine.service';
import { assertOrganizator } from './tournament-access';
import { lockTournament, lockTournamentCreation } from './tournament-locks';
import { parseMinskDateTime, TOURNAMENT_TIME_ZONE } from './tournament-time';

const TEAM_VIEW = {
  select: {
    id: true,
    name: true,
    schoolId: true,
    school: { select: { name: true, district: true } },
  },
};

const STAGE_VIEW = {
  brackets: {
    orderBy: [{ district: 'asc' }, { school: { name: 'asc' } }],
    include: {
      school: { select: { id: true, name: true, district: true } },
      winnerTeam: TEAM_VIEW,
      games: {
        orderBy: [{ round: 'asc' }, { position: 'asc' }],
        include: { teamA: TEAM_VIEW, teamB: TEAM_VIEW },
      },
    },
  },
} satisfies Prisma.TournamentStageInclude;

export type StageView = Prisma.TournamentStageGetPayload<{
  include: typeof STAGE_VIEW;
}> & {
  /**
   * CITY stage only: all 9 districts and whether each sent a team.
   * Fewer than 9 participants is expected when a district had no school winners.
   */
  districts?: {
    district: string;
    status: 'QUALIFIED' | 'NO_WINNER' | 'PENDING';
    team: { id: string; name: string } | null;
  }[];
};

export const toTournamentResponse = (t: Tournament): TournamentResponseDto => ({
  id: t.id,
  name: t.name,
  status: t.status,
  minTeamSize: t.minTeamSize,
  maxTeamSize: t.maxTeamSize,
  schoolStageStartAt: t.schoolStageStartAt,
  currentStage: t.currentStage,
  winnerTeamId: t.winnerTeamId,
  finishedAt: t.finishedAt,
  timeZone: TOURNAMENT_TIME_ZONE,
});

@Injectable()
export class TournamentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    actor: User,
    dto: CreateTournamentDto,
    now = new Date(),
  ): Promise<TournamentResponseDto> {
    assertOrganizator(actor);
    const startAt = parseMinskDateTime(dto.schoolStageStartAt);
    this.assertSizes(dto.minTeamSize, dto.maxTeamSize);
    this.assertFuture(startAt, now);

    const tournament = await this.prisma.$transaction(async (tx) => {
      await lockTournamentCreation(tx);
      const active = await tx.tournament.findFirst({
        where: { status: { not: TournamentStatus.FINISHED } },
      });
      if (active) {
        throw new ConflictException(
          `Tournament "${active.name}" is not finished yet; only one can run at a time`,
        );
      }
      return tx.tournament.create({
        data: {
          name: dto.name,
          minTeamSize: dto.minTeamSize,
          maxTeamSize: dto.maxTeamSize,
          schoolStageStartAt: startAt,
        },
      });
    });
    return toTournamentResponse(tournament);
  }

  /**
   * Organizator only, before the school stage starts. Once brackets exist the
   * tournament can be neither rescheduled nor restarted (409).
   */
  async update(
    actor: User,
    id: string,
    dto: UpdateTournamentDto,
    now = new Date(),
  ): Promise<TournamentResponseDto> {
    assertOrganizator(actor);
    const startAt =
      dto.schoolStageStartAt !== undefined
        ? parseMinskDateTime(dto.schoolStageStartAt)
        : undefined;
    if (startAt) this.assertFuture(startAt, now);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (!(await lockTournament(tx, id, 'update')))
        throw new NotFoundException('Tournament not found');
      const current = await tx.tournament.findUniqueOrThrow({ where: { id } });
      if (
        current.status !== TournamentStatus.REGISTRATION ||
        current.schoolStageStartAt <= now
      ) {
        throw new ConflictException(
          'The school stage has already started; the tournament can no longer be changed',
        );
      }

      const minTeamSize = dto.minTeamSize ?? current.minTeamSize;
      const maxTeamSize = dto.maxTeamSize ?? current.maxTeamSize;
      this.assertSizes(minTeamSize, maxTeamSize);
      if (maxTeamSize < current.maxTeamSize) {
        const oversized = await tx.tournamentTeam.findFirst({
          where: { tournamentId: id },
          select: { name: true, _count: { select: { members: true } } },
          orderBy: { members: { _count: 'desc' } },
        });
        if (oversized && oversized._count.members > maxTeamSize) {
          throw new ConflictException(
            `Team "${oversized.name}" has ${oversized._count.members} members, more than the new maxTeamSize`,
          );
        }
      }
      return tx.tournament.update({
        where: { id },
        data: {
          name: dto.name,
          minTeamSize,
          maxTeamSize,
          schoolStageStartAt: startAt,
        },
      });
    });
    return toTournamentResponse(updated);
  }

  async findAll(): Promise<TournamentResponseDto[]> {
    const list = await this.prisma.tournament.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return list.map(toTournamentResponse);
  }

  async findCurrent(): Promise<TournamentResponseDto> {
    const current = await this.prisma.tournament.findFirst({
      where: { status: { not: TournamentStatus.FINISHED } },
    });
    if (!current) throw new NotFoundException('No active tournament');
    return toTournamentResponse(current);
  }

  async findOne(id: string): Promise<TournamentResponseDto> {
    return toTournamentResponse(await this.findOrThrow(id));
  }

  /** Brackets with games of one stage. PENDING stages are returned without brackets. */
  async getStage(id: string, type: StageType): Promise<StageView> {
    await this.findOrThrow(id);
    const stage = await this.prisma.tournamentStage.findUnique({
      where: { tournamentId_type: { tournamentId: id, type } },
      include: STAGE_VIEW,
    });
    if (!stage)
      throw new NotFoundException(
        'Stage has not been created yet: the school stage has not started',
      );
    if (type !== StageType.CITY) return stage;
    return { ...stage, districts: await this.districtSummary(id) };
  }

  private async districtSummary(
    tournamentId: string,
  ): Promise<NonNullable<StageView['districts']>> {
    const brackets = await this.prisma.tournamentBracket.findMany({
      where: { stage: { tournamentId, type: StageType.DISTRICT } },
      select: {
        district: true,
        status: true,
        winnerTeam: { select: { id: true, name: true } },
      },
    });
    return ALL_DISTRICTS.map((district) => {
      const bracket = brackets.find((b) => b.district === district);
      if (!bracket || bracket.status !== BracketStatus.FINISHED)
        return { district, status: 'PENDING', team: null };
      return bracket.winnerTeam
        ? { district, status: 'QUALIFIED', team: bracket.winnerTeam }
        : { district, status: 'NO_WINNER', team: null };
    });
  }

  private async findOrThrow(id: string): Promise<Tournament> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    return tournament;
  }

  private assertSizes(min: number, max: number): void {
    if (min < 1 || max < min) {
      throw new BadRequestException('Expected 1 <= minTeamSize <= maxTeamSize');
    }
  }

  private assertFuture(startAt: Date, now: Date): void {
    if (startAt <= now) {
      throw new BadRequestException('schoolStageStartAt must be in the future');
    }
  }
}
