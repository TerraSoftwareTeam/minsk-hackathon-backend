import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TournamentStatus,
  User,
  UserRoles,
} from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamResponseDto } from './dto/team.dto';
import { assertCanManageTeam } from './tournament-access';
import { lockTeam, lockTournament, Tx } from './tournament-locks';

const TEAM_INCLUDE = {
  school: { select: { id: true, name: true } },
  tournament: {
    select: {
      minTeamSize: true,
      maxTeamSize: true,
      status: true,
      schoolStageStartAt: true,
    },
  },
  members: {
    orderBy: { joinedAt: 'asc' },
    include: { user: { select: { name: true, surname: true, class: true } } },
  },
} satisfies Prisma.TournamentTeamInclude;

type TeamWithRelations = Prisma.TournamentTeamGetPayload<{
  include: typeof TEAM_INCLUDE;
}>;

const isRegistrationOpen = (
  t: { status: TournamentStatus; schoolStageStartAt: Date },
  now: Date,
) => t.status === TournamentStatus.REGISTRATION && t.schoolStageStartAt > now;

const toTeamResponse = (
  team: TeamWithRelations,
  now = new Date(),
): TeamResponseDto => ({
  id: team.id,
  name: team.name,
  tournamentId: team.tournamentId,
  schoolId: team.schoolId,
  schoolName: team.school.name,
  creatorId: team.creatorId,
  isFull: team.members.length >= team.tournament.minTeamSize,
  isLocked: !isRegistrationOpen(team.tournament, now),
  members: team.members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    surname: m.user.surname,
    class: m.user.class,
    joinedAt: m.joinedAt,
  })),
});

/**
 * Team and roster management. All mutations:
 * - are allowed only during REGISTRATION and before schoolStageStartAt (rosters lock at start);
 * - run in a transaction holding FOR SHARE on the tournament and FOR UPDATE on the team,
 *   so they cannot interleave with the stage start or with each other on the same team;
 * - rely on DB uniques for "one team per pupil per tournament" and team-name uniqueness.
 *
 * The creator cannot leave or be removed while other members remain; rights must be
 * transferred first. A creator who is the only member leaving deletes the team.
 */
@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tournamentId: string,
    schoolId?: string,
  ): Promise<TeamResponseDto[]> {
    const teams = await this.prisma.tournamentTeam.findMany({
      where: { tournamentId, ...(schoolId ? { schoolId } : {}) },
      include: TEAM_INCLUDE,
      orderBy: [{ school: { name: 'asc' } }, { name: 'asc' }],
    });
    return teams.map((t) => toTeamResponse(t));
  }

  async findOne(teamId: string): Promise<TeamResponseDto> {
    return toTeamResponse(await this.findOrThrow(this.prisma, teamId));
  }

  /** Pupils only. The creator becomes the first member. */
  async create(
    actor: User,
    tournamentId: string,
    name: string,
    now = new Date(),
  ): Promise<TeamResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can create a team');
    }
    if (!actor.schoolName) throw new BadRequestException('Pupil has no school');

    const teamId = await this.mutate(async (tx) => {
      if (!(await lockTournament(tx, tournamentId, 'share')))
        throw new NotFoundException('Tournament not found');
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
      });
      this.assertRegistrationOpen(tournament, now);
      await this.assertNotInTeam(
        tx,
        tournamentId,
        actor.id,
        'You are already in a team of this tournament',
      );

      const school = await tx.school.findUniqueOrThrow({
        where: { name: actor.schoolName! },
      });
      const team = await tx.tournamentTeam.create({
        data: {
          name,
          tournamentId,
          schoolId: school.id,
          creatorId: actor.id,
          members: { create: { userId: actor.id, tournamentId } },
        },
      });
      return team.id;
    });
    return this.findOne(teamId);
  }

  async rename(
    actor: User,
    teamId: string,
    name: string,
    now = new Date(),
  ): Promise<TeamResponseDto> {
    await this.mutateTeam(actor, teamId, now, async (tx, team) => {
      assertCanManageTeam(actor, team);
      await tx.tournamentTeam.update({
        where: { id: team.id },
        data: { name },
      });
    });
    return this.findOne(teamId);
  }

  async remove(actor: User, teamId: string, now = new Date()): Promise<void> {
    await this.mutateTeam(actor, teamId, now, async (tx, team) => {
      assertCanManageTeam(actor, team);
      await tx.tournamentTeam.delete({ where: { id: team.id } });
    });
  }

  /**
   * A pupil may add themselves to any team of their school (no approval needed).
   * The creator, a teacher of the school or an organizator may add any pupil of that school.
   */
  async addMember(
    actor: User,
    teamId: string,
    userId: string,
    now = new Date(),
  ): Promise<TeamResponseDto> {
    await this.mutateTeam(actor, teamId, now, async (tx, team) => {
      const selfJoin = actor.role === UserRoles.PUPIL && actor.id === userId;
      if (!selfJoin) assertCanManageTeam(actor, team);

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.role !== UserRoles.PUPIL)
        throw new BadRequestException('Only pupils can be team members');
      if (user.schoolName !== team.school.name) {
        throw new ForbiddenException(
          'A pupil can only join a team of their own school',
        );
      }
      if (team.members.some((m) => m.userId === userId)) {
        throw new ConflictException('The pupil is already in this team');
      }
      await this.assertNotInTeam(
        tx,
        team.tournamentId,
        userId,
        'The pupil is already in another team of this tournament',
      );
      if (team.members.length >= team.tournament.maxTeamSize) {
        throw new ConflictException(
          `The team is full (MAX_TEAM_SIZE = ${team.tournament.maxTeamSize})`,
        );
      }
      await tx.teamMember.create({
        data: { teamId: team.id, userId, tournamentId: team.tournamentId },
      });
    });
    return this.findOne(teamId);
  }

  /**
   * Leave (actor removes themselves) or kick (creator / teacher / organizator).
   * Returns null when the team was deleted because its creator, the only member, left.
   */
  async removeMember(
    actor: User,
    teamId: string,
    userId: string,
    now = new Date(),
  ): Promise<TeamResponseDto | null> {
    let deleted = false;
    await this.mutateTeam(actor, teamId, now, async (tx, team) => {
      const leaving = actor.id === userId;
      if (!leaving) assertCanManageTeam(actor, team);
      if (!team.members.some((m) => m.userId === userId)) {
        throw new NotFoundException('The user is not a member of this team');
      }

      if (team.creatorId === userId) {
        if (team.members.length > 1) {
          throw new ConflictException(
            'The creator must transfer creator rights before leaving the team',
          );
        }
        if (!leaving)
          throw new ConflictException(
            'The creator is the only member; delete the team instead',
          );
        await tx.tournamentTeam.delete({ where: { id: team.id } });
        deleted = true;
        return;
      }
      await tx.teamMember.delete({
        where: { teamId_userId: { teamId: team.id, userId } },
      });
    });
    return deleted ? null : this.findOne(teamId);
  }

  /** The creator, a teacher of the school or an organizator hands creator rights to another member. */
  async transferCreator(
    actor: User,
    teamId: string,
    userId: string,
    now = new Date(),
  ): Promise<TeamResponseDto> {
    await this.mutateTeam(actor, teamId, now, async (tx, team) => {
      assertCanManageTeam(actor, team);
      if (!team.members.some((m) => m.userId === userId)) {
        throw new BadRequestException(
          'Creator rights can only be transferred to a team member',
        );
      }
      await tx.tournamentTeam.update({
        where: { id: team.id },
        data: { creatorId: userId },
      });
    });
    return this.findOne(teamId);
  }

  // ---- helpers ----

  /** Locks tournament (share) and team (update), re-reads the team and checks the roster is open. */
  private async mutateTeam(
    actor: User,
    teamId: string,
    now: Date,
    work: (tx: Tx, team: TeamWithRelations) => Promise<void>,
  ): Promise<void> {
    const existing = await this.findOrThrow(this.prisma, teamId);
    await this.mutate(async (tx) => {
      await lockTournament(tx, existing.tournamentId, 'share');
      if (!(await lockTeam(tx, teamId)))
        throw new NotFoundException('Team not found');
      const team = await this.findOrThrow(tx, teamId);
      this.assertRegistrationOpen(team.tournament, now);
      await work(tx, team);
    });
  }

  private async mutate<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Raced with a parallel request: same team name, or the pupil joined another team meanwhile.
        throw new ConflictException(
          'Conflict: the team name is taken or the pupil is already in a team',
        );
      }
      throw error;
    }
  }

  private assertRegistrationOpen(
    t: { status: TournamentStatus; schoolStageStartAt: Date },
    now: Date,
  ): void {
    if (!isRegistrationOpen(t, now)) {
      throw new ConflictException(
        'Team rosters are locked: the school stage has started',
      );
    }
  }

  private async assertNotInTeam(
    tx: Tx,
    tournamentId: string,
    userId: string,
    message: string,
  ): Promise<void> {
    const membership = await tx.teamMember.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });
    if (membership) throw new ConflictException(message);
  }

  private async findOrThrow(
    client: Tx | PrismaService,
    teamId: string,
  ): Promise<TeamWithRelations> {
    const team = await client.tournamentTeam.findUnique({
      where: { id: teamId },
      include: TEAM_INCLUDE,
    });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }
}
