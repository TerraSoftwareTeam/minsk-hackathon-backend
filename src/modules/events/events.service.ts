import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventStatuses,
  Prisma,
  Scopes,
  User,
  UserRoles,
} from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { DeclineEventDto } from './dto/decline-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { EventVoteResponseDto } from './dto/event-vote-response.dto';
import { VotingEventResponseDto } from './dto/voting-event-response.dto';
import { EventWithUsers, toEventResponse, toVotingEventResponse } from './event.mapper';

const WITH_USERS = { initiator: true, teacher: true } as const;

/** WITH_USERS plus the caller's own vote (0 or 1 rows) and the total vote count. */
const withVoteState = (voterId: string) =>
  ({
    ...WITH_USERS,
    votes: { where: { voterId }, select: { voterId: true } },
    _count: { select: { votes: true } },
  }) as const;

/** A moderation step: which status it decides on and who may decide. */
type ModerationStage = {
  from: EventStatuses;
  mayModerate: (actor: User, event: EventWithUsers) => boolean;
  forbiddenMessage: string;
};

const TEACHER_MODERATION: ModerationStage = {
  from: EventStatuses.ON_MODERATION,
  mayModerate: (actor, event) => actor.id === event.teacherId,
  forbiddenMessage: 'Only the assigned teacher can moderate this event',
};

const ADMIN_MODERATION: ModerationStage = {
  from: EventStatuses.ON_ADMIN_MODERATION,
  mayModerate: (actor) => actor.role === UserRoles.ADMIN,
  forbiddenMessage: 'Only an admin can moderate this event',
};

/**
 * Event moderation flow:
 * 1. A PUPIL creates an event. It gets status ON_MODERATION and is assigned
 *    to a teacher of the pupil's class (teacher.class === pupil.class).
 * 2. That teacher sees it in their moderation list and either approves it
 *    (ON_VOTE) or declines it (DECLINED, optional reason).
 * 3. While the event is ON_VOTE, pupils vote for it (one vote per pupil).
 *    Who may vote depends on the scope, relative to the initiator's class:
 *    CLASS - same class, GRADE - same grade (number in the class name, "10A" -> 10),
 *    SCHOOL - any pupil.
 * 4. When the votes reach the event's voteThreshold (set by the initiator),
 *    the event moves to ON_ADMIN_MODERATION and voting closes.
 * 5. Any admin approves it (FINALIZED) or declines it (DECLINED_BY_ADMIN,
 *    optional reason).
 *
 * Who may read an event: its initiator, its assigned teacher, any admin.
 */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actor: User, dto: CreateEventDto): Promise<EventResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can create an event');
    }
    if (!actor.class) {
      throw new BadRequestException('Pupil has no class assigned');
    }
    const teacher = await this.findClassTeacher(actor.class);

    const event = await this.withPrismaErrors(() =>
      this.prisma.event.create({
        data: {
          name: dto.name,
          description: dto.description,
          scope: dto.scope,
          voteThreshold: dto.voteThreshold,
          status: EventStatuses.ON_MODERATION,
          initiatorId: actor.id,
          teacherId: teacher.id,
        },
        include: WITH_USERS,
      }),
    );
    return toEventResponse(event);
  }

  /** The teacher's queue: events assigned to them that still await a decision. */
  async findForModeration(actor: User): Promise<EventResponseDto[]> {
    if (actor.role !== UserRoles.TEACHER) {
      throw new ForbiddenException('Only a teacher has a moderation list');
    }
    const events = await this.prisma.event.findMany({
      where: { teacherId: actor.id, status: EventStatuses.ON_MODERATION },
      include: WITH_USERS,
      orderBy: { createdAt: 'asc' },
    });
    return events.map(toEventResponse);
  }

  /**
   * Pupil's voting feed: ON_VOTE events whose scope includes the pupil, newest first.
   * Uses the same isInScope rule as vote(), so every listed event can be voted for.
   */
  async findForVoting(actor: User): Promise<VotingEventResponseDto[]> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil has a voting list');
    }
    // CLASS and SCHOOL are filtered by the DB. The grade is parsed from the class
    // name, which SQL cannot match the same way, so GRADE events are narrowed below.
    const events = await this.prisma.event.findMany({
      where: {
        status: EventStatuses.ON_VOTE,
        OR: [
          { scope: Scopes.SCHOOL },
          { scope: Scopes.GRADE },
          { scope: Scopes.CLASS, initiator: { class: actor.class } },
        ],
      },
      include: withVoteState(actor.id),
      orderBy: { createdAt: 'desc' },
    });
    return events
      .filter((event) => this.isInScope(actor.class, event.initiator.class, event.scope))
      .map(toVotingEventResponse);
  }

  /** Admin queue: events that passed the vote and await an admin decision, oldest first. */
  async findForAdminModeration(actor: User): Promise<EventResponseDto[]> {
    if (actor.role !== UserRoles.ADMIN) {
      throw new ForbiddenException('Only an admin has the admin moderation list');
    }
    const events = await this.prisma.event.findMany({
      where: { status: EventStatuses.ON_ADMIN_MODERATION },
      include: WITH_USERS,
      orderBy: { createdAt: 'asc' },
    });
    return events.map(toEventResponse);
  }

  async findOne(actor: User, id: string): Promise<EventResponseDto> {
    const event = await this.findEventOrThrow(id);
    if (!this.canRead(actor, event)) {
      throw new ForbiddenException('You cannot access this event');
    }
    return toEventResponse(event);
  }

  approve(actor: User, id: string): Promise<EventResponseDto> {
    return this.moderate(TEACHER_MODERATION, actor, id, {
      status: EventStatuses.ON_VOTE,
    });
  }

  decline(actor: User, id: string, dto: DeclineEventDto): Promise<EventResponseDto> {
    return this.moderate(TEACHER_MODERATION, actor, id, {
      status: EventStatuses.DECLINED,
      declineReason: dto.reason ?? null,
    });
  }

  adminApprove(actor: User, id: string): Promise<EventResponseDto> {
    return this.moderate(ADMIN_MODERATION, actor, id, {
      status: EventStatuses.FINALIZED,
    });
  }

  adminDecline(actor: User, id: string, dto: DeclineEventDto): Promise<EventResponseDto> {
    return this.moderate(ADMIN_MODERATION, actor, id, {
      status: EventStatuses.DECLINED_BY_ADMIN,
      declineReason: dto.reason ?? null,
    });
  }

  /** A pupil votes for an event that is ON_VOTE. Each pupil can vote for an event once. */
  async vote(actor: User, id: string): Promise<EventVoteResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can vote for an event');
    }
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: { status: true, scope: true, initiator: { select: { class: true } } },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (!this.isInScope(actor.class, event.initiator.class, event.scope)) {
      throw new ForbiddenException(`This ${event.scope} event is not for your class`);
    }
    if (event.status !== EventStatuses.ON_VOTE) {
      throw new ConflictException(`Event is not on vote, its status is ${event.status}`);
    }

    try {
      return await this.prisma.$transaction((tx) => this.castVote(tx, id, actor.id));
    } catch (error) {
      // The (eventId, voterId) primary key rejects a second vote, also under a race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You have already voted for this event');
      }
      throw error;
    }
  }

  // ---- internals ----

  /**
   * Locks the event row, so votes for one event are applied one at a time:
   * the threshold transition happens exactly once, and no vote is accepted
   * after the event has left ON_VOTE.
   */
  private async castVote(
    tx: Prisma.TransactionClient,
    eventId: string,
    voterId: string,
  ): Promise<EventVoteResponseDto> {
    const [locked] = await tx.$queryRaw<{ status: EventStatuses; voteThreshold: number }[]>`
      SELECT "status", "voteThreshold" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
    if (!locked) {
      throw new NotFoundException('Event not found');
    }
    if (locked.status !== EventStatuses.ON_VOTE) {
      throw new ConflictException(`Event is not on vote, its status is ${locked.status}`);
    }

    await tx.eventVote.create({ data: { eventId, voterId } });
    const votesCount = await tx.eventVote.count({ where: { eventId } });

    let status: EventStatuses = EventStatuses.ON_VOTE;
    if (votesCount >= locked.voteThreshold) {
      status = EventStatuses.ON_ADMIN_MODERATION;
      await tx.event.update({ where: { id: eventId }, data: { status } });
    }
    return { eventId, votesCount, voteThreshold: locked.voteThreshold, status };
  }

  /** Whether a pupil of `voterClass` belongs to the audience of an event created in `eventClass`. */
  private isInScope(voterClass: string | null, eventClass: string | null, scope: Scopes): boolean {
    switch (scope) {
      case Scopes.SCHOOL:
        return true;
      case Scopes.CLASS:
        return voterClass !== null && voterClass === eventClass;
      case Scopes.GRADE: {
        const voterGrade = gradeOf(voterClass);
        return voterGrade !== null && voterGrade === gradeOf(eventClass);
      }
    }
  }

  private canRead(actor: User, event: EventWithUsers): boolean {
    return (
      actor.role === UserRoles.ADMIN ||
      actor.id === event.initiatorId ||
      actor.id === event.teacherId
    );
  }

  /** Applies a moderation decision: only an allowed actor, only while the event is in `stage.from`. */
  private async moderate(
    stage: ModerationStage,
    actor: User,
    id: string,
    data: Prisma.EventUpdateManyMutationInput,
  ): Promise<EventResponseDto> {
    const event = await this.findEventOrThrow(id);
    if (!stage.mayModerate(actor, event)) {
      throw new ForbiddenException(stage.forbiddenMessage);
    }
    if (event.status !== stage.from) {
      throw new ConflictException(`Event is already ${event.status}`);
    }

    // The status condition makes the transition atomic: if two requests race,
    // only the first one changes the row, the second gets 409.
    const { count } = await this.prisma.event.updateMany({
      where: { id, status: stage.from },
      data,
    });
    if (count === 0) {
      throw new ConflictException('Event has already been moderated');
    }
    return toEventResponse(await this.findEventOrThrow(id));
  }

  /**
   * Picks the teacher of the class. If a class has several teachers, the one
   * with the smallest id is chosen, so the choice is stable.
   */
  private async findClassTeacher(className: string): Promise<User> {
    const teacher = await this.prisma.user.findFirst({
      where: { role: UserRoles.TEACHER, class: className },
      orderBy: { id: 'asc' },
    });
    if (!teacher) {
      throw new BadRequestException(`Class "${className}" has no teacher to moderate the event`);
    }
    return teacher;
  }

  private async findEventOrThrow(id: string): Promise<EventWithUsers> {
    const event = await this.prisma.event.findUnique({ where: { id }, include: WITH_USERS });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private async withPrismaErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Event with this name already exists');
      }
      throw error;
    }
  }
}

/**
 * Grade (parallel) of a class: the first number in its name, e.g. "10A" -> 10, "5 Б" -> 5.
 * The whole number is taken, not one digit, so "1A" and "11A" are different grades.
 */
function gradeOf(className: string | null): number | null {
  const match = className?.match(/\d+/);
  return match ? Number(match[0]) : null;
}
