import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EventCategories,
  EventStatuses,
  Prisma,
  Scopes,
  User,
  UserRoles,
} from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ImagesService } from '../images/images.service';
import { CreateEventDto } from './dto/create-event.dto';
import { DeclineEventDto } from './dto/decline-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { EventVoteResponseDto } from './dto/event-vote-response.dto';
import { VotingEventResponseDto } from './dto/voting-event-response.dto';
import {
  EXPIRES_BEFORE_START_MS,
  PendingStatus,
  VOTING_CLOSES_BEFORE_START_MS,
  deadlineCutoff,
  isPastDeadline,
} from './event-deadlines';
import {
  OUTCOME_STATUSES,
  ProbabilityHistoryEvent,
  computeSuccessProbability,
} from './event-probability';
import { DecisionStatus, EventModerationNotifier } from './event-moderation.notifier';
import { EventRatingResponseDto } from './dto/event-rating-response.dto';
import { RatingEventResponseDto } from './dto/rating-event-response.dto';
import {
  EventComputed,
  EventRatingSummary,
  EventWithUsers,
  toEventResponse,
  toRatingEventResponse,
  toVotingEventResponse,
} from './event.mapper';

/**
 * Statuses in which pupils may rate an event: approved by the teacher (ON_VOTE)
 * and every status after it. EXPIRED is left out: it is also reached straight
 * from ON_MODERATION, without the teacher's approval.
 */
export const RATABLE_STATUSES = [
  EventStatuses.ON_VOTE,
  EventStatuses.ON_ADMIN_MODERATION,
  EventStatuses.FINALIZED,
  EventStatuses.DECLINED_BY_ADMIN,
] as const;

const WITH_USERS = { initiator: true, teacher: true, image: { select: { url: true } } } as const;

/** WITH_USERS plus the caller's own vote (0 or 1 rows) and the total vote count. */
const withVoteState = (voterId: string) =>
  ({
    ...WITH_USERS,
    votes: { where: { voterId }, select: { voterId: true } },
    _count: { select: { votes: true } },
  }) as const;

/**
 * A moderation step: which status it decides on and who may decide. Its
 * deadline is the expiration deadline of that status (EXPIRES_BEFORE_START_MS).
 */
type ModerationStage = {
  from: PendingStatus;
  mayModerate: (actor: User, event: EventWithUsers) => boolean;
  forbiddenMessage: string;
  lateMessage: string;
};

const TEACHER_MODERATION: ModerationStage = {
  from: EventStatuses.ON_MODERATION,
  mayModerate: (actor, event) => actor.id === event.teacherId,
  forbiddenMessage: 'Only the assigned teacher can moderate this event',
  lateMessage: 'Too late to moderate: voting for this event closed 2 days before its start',
};

const ADMIN_MODERATION: ModerationStage = {
  from: EventStatuses.ON_ADMIN_MODERATION,
  mayModerate: (actor) => actor.role === UserRoles.ADMIN,
  forbiddenMessage: 'Only an admin can moderate this event',
  lateMessage: 'Too late to moderate: the event has already started',
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
 * Deadlines (see event-deadlines.ts). The pupil sets only startsAt; voting
 * closes 2 days before it (votingClosesAt).
 * - ON_MODERATION and ON_VOTE expire at the voting deadline: the event did not
 *   get approved and collect its votes in time.
 * - ON_ADMIN_MODERATION expires at startsAt: the admin uses the time left.
 * Expired events become EXPIRED (expireOverdue, run every minute by
 * EventsScheduler). Past its deadline no vote or decision is accepted, even
 * before the scheduler runs, and the queues and the voting feed hide the event.
 *
 * Who may read an event: its initiator, its assigned teacher, any admin.
 *
 * Push notifications (EventModerationNotifier): the teacher gets one when an
 * event is assigned to them (1), every admin when an event reaches
 * ON_ADMIN_MODERATION (4), the author on every decision of the teacher (2) and
 * of an admin (5). Sent after the change is committed.
 *
 * Rating: from ON_VOTE on (RATABLE_STATUSES) any pupil, not only the event's
 * audience, may rate the event with 1 to 5 stars, one rating per pupil, which
 * they can change. Every event response carries the
 * average and the count.
 *
 * Image (optional, at most one per event): the author sets, replaces or
 * removes it until the event is decided, i.e. while it is pending and not past
 * its deadline. An admin may remove it in any status (e.g. an unsuitable picture).
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImagesService,
    private readonly notifier: EventModerationNotifier,
  ) {}

  async create(actor: User, dto: CreateEventDto): Promise<EventResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can create an event');
    }
    if (!actor.class) {
      throw new BadRequestException('Pupil has no class assigned');
    }
    const startsAt = new Date(dto.startsAt);
    // Otherwise the event would expire right away, before anyone could vote.
    if (isPastDeadline(startsAt, VOTING_CLOSES_BEFORE_START_MS)) {
      throw new BadRequestException(
        'startsAt must be more than 2 days ahead: voting closes 2 days before the event',
      );
    }
    const teacher = await this.findClassTeacher(actor.class);

    const event = await this.withPrismaErrors(() =>
      this.prisma.event.create({
        data: {
          name: dto.name,
          description: dto.description,
          scope: dto.scope,
          category: dto.category,
          voteThreshold: dto.voteThreshold,
          startsAt,
          status: EventStatuses.ON_MODERATION,
          initiatorId: actor.id,
          teacherId: teacher.id,
        },
        include: WITH_USERS,
      }),
    );
    this.notifier.awaitsTeacher(event);
    return this.toResponse(event);
  }

  /**
   * Preview for the creation form: the probability that an event of this
   * category starting at this time takes place (see event-probability.ts).
   */
  async previewProbability(category: EventCategories, startsAt: Date): Promise<number> {
    const history = await this.loadHistory([{ category }]);
    return computeSuccessProbability(category, startsAt, history);
  }

  /** The teacher's queue: events assigned to them that still await a decision. */
  async findForModeration(actor: User): Promise<EventResponseDto[]> {
    if (actor.role !== UserRoles.TEACHER) {
      throw new ForbiddenException('Only a teacher has a moderation list');
    }
    const events = await this.prisma.event.findMany({
      where: {
        teacherId: actor.id,
        status: EventStatuses.ON_MODERATION,
        startsAt: { gt: deadlineCutoff(EXPIRES_BEFORE_START_MS.ON_MODERATION) },
      },
      include: WITH_USERS,
      orderBy: { createdAt: 'asc' },
    });
    return this.toResponses(events, toEventResponse);
  }

  /** The author's own events in any status, newest first, with their vote count. */
  async findMine(actor: User): Promise<VotingEventResponseDto[]> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException(
        'Only a pupil can create events, so only a pupil has own events',
      );
    }
    const events = await this.prisma.event.findMany({
      where: { initiatorId: actor.id },
      include: withVoteState(actor.id),
      orderBy: { createdAt: 'desc' },
    });
    return this.toResponses(events, toVotingEventResponse);
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
        // Voting still open: an overdue event may wait up to a minute for expiration.
        startsAt: { gt: deadlineCutoff(EXPIRES_BEFORE_START_MS.ON_VOTE) },
        OR: [
          { scope: Scopes.SCHOOL },
          { scope: Scopes.GRADE },
          { scope: Scopes.CLASS, initiator: { class: actor.class } },
        ],
      },
      include: withVoteState(actor.id),
      orderBy: { createdAt: 'desc' },
    });
    return this.toResponses(
      events.filter((event) => this.isInScope(actor.class, event.initiator.class, event.scope)),
      toVotingEventResponse,
    );
  }

  /**
   * Pupil's rating feed: every event in a RATABLE_STATUSES status, of any
   * class and scope, newest first, with the pupil's own rating.
   */
  async findForRating(actor: User): Promise<RatingEventResponseDto[]> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil has a rating list');
    }
    const events = await this.prisma.event.findMany({
      where: { status: { in: [...RATABLE_STATUSES] } },
      include: { ...WITH_USERS, ratings: { where: { raterId: actor.id }, select: { stars: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.toResponses(events, toRatingEventResponse);
  }

  /** Admin queue: events that passed the vote and await an admin decision, oldest first. */
  async findForAdminModeration(actor: User): Promise<EventResponseDto[]> {
    if (actor.role !== UserRoles.ADMIN) {
      throw new ForbiddenException('Only an admin has the admin moderation list');
    }
    const events = await this.prisma.event.findMany({
      where: {
        status: EventStatuses.ON_ADMIN_MODERATION,
        startsAt: { gt: deadlineCutoff(EXPIRES_BEFORE_START_MS.ON_ADMIN_MODERATION) },
      },
      include: WITH_USERS,
      orderBy: { createdAt: 'asc' },
    });
    return this.toResponses(events, toEventResponse);
  }

  async findOne(actor: User, id: string): Promise<EventResponseDto> {
    const event = await this.findEventOrThrow(id);
    if (!this.canRead(actor, event)) {
      throw new ForbiddenException('You cannot access this event');
    }
    return this.toResponse(event);
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
      select: {
        status: true,
        scope: true,
        startsAt: true,
        initiator: { select: { class: true } },
      },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (!this.isInScope(actor.class, event.initiator.class, event.scope)) {
      throw new ForbiddenException(`This ${event.scope} event is not for your class`);
    }
    this.assertVotingOpen(event);

    let result: EventVoteResponseDto;
    try {
      result = await this.prisma.$transaction((tx) => this.castVote(tx, id, actor.id));
    } catch (error) {
      // The (eventId, voterId) primary key rejects a second vote, also under a race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You have already voted for this event');
      }
      throw error;
    }
    // castVote returns ON_ADMIN_MODERATION only for the vote that made the transition, so admins are notified once.
    if (result.status === EventStatuses.ON_ADMIN_MODERATION) {
      this.notifier.awaitsAdmin(id);
    }
    return result;
  }

  /**
   * Any pupil rates an event in a RATABLE_STATUSES status, whatever its scope.
   * A second call changes the pupil's rating, it never adds another one.
   */
  async rate(actor: User, id: string, stars: number): Promise<EventRatingResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can rate an event');
    }
    const event = await this.prisma.event.findUnique({ where: { id }, select: { status: true } });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (!(RATABLE_STATUSES as readonly EventStatuses[]).includes(event.status)) {
      throw new ConflictException(
        `The event can be rated once the teacher has approved it, its status is ${event.status}`,
      );
    }

    const key = { eventId_raterId: { eventId: id, raterId: actor.id } };
    try {
      await this.prisma.eventRating.upsert({
        where: key,
        create: { eventId: id, raterId: actor.id, stars },
        update: { stars },
      });
    } catch (error) {
      // Two first ratings of the same pupil at once: the other one created the row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.prisma.eventRating.update({ where: key, data: { stars } });
      } else {
        throw error;
      }
    }
    const summary = (await this.loadRatings([id])).get(id)!;
    return { eventId: id, stars, ratingAverage: summary.average!, ratingsCount: summary.count };
  }

  /** Sets or replaces the event image. The previous image is deleted. */
  async setImage(actor: User, id: string, file: Express.Multer.File): Promise<EventResponseDto> {
    const event = await this.findEventOrThrow(id);
    if (actor.id !== event.initiatorId) {
      throw new ForbiddenException('Only the author can set the event image');
    }
    this.assertImageEditable(event);

    // Uploaded outside the transaction: the row lock is not held during the network call.
    const image = await this.images.uploadImage(actor.id, file);
    let previousImageId: string | null;
    try {
      previousImageId = await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockForImage(tx, id);
        // The status may have changed during the upload.
        this.assertImageEditable(locked);
        await tx.event.update({ where: { id }, data: { imageId: image.id } });
        return locked.imageId;
      });
    } catch (error) {
      await this.discardImage(image.id);
      throw error;
    }
    if (previousImageId) {
      await this.discardImage(previousImageId);
    }
    return this.toResponse(await this.findEventOrThrow(id));
  }

  /** Removes the event image, if there is one. The author until the decision, an admin always. */
  async removeImage(actor: User, id: string): Promise<EventResponseDto> {
    const event = await this.findEventOrThrow(id);
    const isAdmin = actor.role === UserRoles.ADMIN;
    if (!isAdmin && actor.id !== event.initiatorId) {
      throw new ForbiddenException('Only the author or an admin can remove the event image');
    }
    if (!isAdmin) {
      this.assertImageEditable(event);
    }

    const removedImageId = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockForImage(tx, id);
      if (!isAdmin) {
        this.assertImageEditable(locked);
      }
      if (locked.imageId) {
        await tx.event.update({ where: { id }, data: { imageId: null } });
      }
      return locked.imageId;
    });
    if (removedImageId) {
      await this.discardImage(removedImageId);
    }
    return this.toResponse(await this.findEventOrThrow(id));
  }

  /**
   * Pending events past the deadline of their status become EXPIRED.
   * Returns how many were expired. Safe to run concurrently with votes and
   * decisions: they hold the row lock or update conditionally on the status,
   * and this update re-checks the status after the lock.
   */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.event.updateMany({
      where: {
        OR: Object.entries(EXPIRES_BEFORE_START_MS).map(([status, leadMs]) => ({
          status: status as PendingStatus,
          startsAt: { lte: deadlineCutoff(leadMs, now) },
        })),
      },
      data: { status: EventStatuses.EXPIRED },
    });
    if (count > 0) {
      this.logger.log(`Expired ${count} event(s) that were not decided before their deadline`);
    }
    return count;
  }

  // ---- internals ----

  private async toResponse(event: EventWithUsers): Promise<EventResponseDto> {
    const [response] = await this.toResponses([event], toEventResponse);
    return response;
  }

  /** Maps events with their success probability and rating, loading them once for all of the events. */
  private async toResponses<E extends EventWithUsers, R>(
    events: E[],
    map: (event: E, computed: EventComputed) => R,
  ): Promise<R[]> {
    if (events.length === 0) {
      return [];
    }
    const [history, ratings] = await Promise.all([
      this.loadHistory(events),
      this.loadRatings(events.map((event) => event.id)),
    ]);
    return events.map((event) =>
      map(event, {
        successProbability: computeSuccessProbability(event.category, event.startsAt, history, event.id),
        rating: ratings.get(event.id)!,
      }),
    );
  }

  /** Average stars (2 decimals, null without ratings) and the number of ratings of each event. */
  private async loadRatings(eventIds: string[]): Promise<Map<string, EventRatingSummary>> {
    const groups = await this.prisma.eventRating.groupBy({
      by: ['eventId'],
      where: { eventId: { in: eventIds } },
      _avg: { stars: true },
      _count: { _all: true },
    });
    const summaries = new Map<string, EventRatingSummary>(
      eventIds.map((id) => [id, { average: null, count: 0 }]),
    );
    for (const group of groups) {
      const average = group._avg.stars;
      summaries.set(group.eventId, {
        average: average === null ? null : Math.round(average * 100) / 100,
        count: group._count._all,
      });
    }
    return summaries;
  }

  /**
   * Events with a known outcome in the categories of `targets`. Declined and pending events have no outcome to learn from.
   * Loaded on every request, so the probability always reflects the current state.
   * A pending event past its deadline counts as EXPIRED right away, without
   * waiting up to a minute for expireOverdue to change its status.
   */
  private async loadHistory(
    targets: { category: EventCategories }[],
  ): Promise<ProbabilityHistoryEvent[]> {
    const now = new Date();
    const events = await this.prisma.event.findMany({
      where: {
        category: { in: [...new Set(targets.map((target) => target.category))] },
        OR: [
          { status: { in: [...OUTCOME_STATUSES] } },
          ...Object.entries(EXPIRES_BEFORE_START_MS).map(([status, leadMs]) => ({
            status: status as PendingStatus,
            startsAt: { lte: deadlineCutoff(leadMs, now) },
          })),
        ],
      },
      select: { id: true, category: true, startsAt: true, status: true },
    });
    return events.map((event) =>
      event.status in EXPIRES_BEFORE_START_MS
        ? { ...event, status: EventStatuses.EXPIRED }
        : event,
    );
  }

  /** The image can change while the event is pending and not past the deadline of its status. */
  private assertImageEditable(event: { status: EventStatuses; startsAt: Date }): void {
    const isPending = event.status in EXPIRES_BEFORE_START_MS;
    if (!isPending || isPastDeadline(event.startsAt, EXPIRES_BEFORE_START_MS[event.status as PendingStatus])) {
      throw new ConflictException(
        `The image can be changed only until the event is decided, its status is ${event.status}`,
      );
    }
  }

  /** Locks the event row, so concurrent image changes are applied one at a time. */
  private async lockForImage(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ status: EventStatuses; startsAt: Date; imageId: string | null }> {
    const [locked] = await tx.$queryRaw<
      { status: EventStatuses; startsAt: Date; imageId: string | null }[]
    >`SELECT "status", "startsAt", "imageId" FROM "Event" WHERE "id" = ${id} FOR UPDATE`;
    if (!locked) {
      throw new NotFoundException('Event not found');
    }
    return locked;
  }

  /** Deletes an image no event uses anymore. A failure is logged, not returned: the event is already consistent. */
  private async discardImage(imageId: string): Promise<void> {
    try {
      await this.images.deleteImage(imageId);
    } catch (error) {
      this.logger.error(
        `Failed to delete image ${imageId}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /** Votes are accepted only while the event is ON_VOTE and before the voting deadline. */
  private assertVotingOpen(event: { status: EventStatuses; startsAt: Date }): void {
    if (event.status !== EventStatuses.ON_VOTE) {
      throw new ConflictException(`Event is not on vote, its status is ${event.status}`);
    }
    if (isPastDeadline(event.startsAt, EXPIRES_BEFORE_START_MS.ON_VOTE)) {
      throw new ConflictException('Voting is closed: it closes 2 days before the event starts');
    }
  }

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
    const [locked] = await tx.$queryRaw<
      { status: EventStatuses; voteThreshold: number; startsAt: Date }[]
    >`
      SELECT "status", "voteThreshold", "startsAt" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
    if (!locked) {
      throw new NotFoundException('Event not found');
    }
    this.assertVotingOpen(locked);

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
    data: { status: DecisionStatus; declineReason?: string | null },
  ): Promise<EventResponseDto> {
    const event = await this.findEventOrThrow(id);
    if (!stage.mayModerate(actor, event)) {
      throw new ForbiddenException(stage.forbiddenMessage);
    }
    if (event.status !== stage.from) {
      throw new ConflictException(`Event is already ${event.status}`);
    }
    const leadMs = EXPIRES_BEFORE_START_MS[stage.from];
    if (isPastDeadline(event.startsAt, leadMs)) {
      throw new ConflictException(stage.lateMessage);
    }

    // The status condition makes the transition atomic: if two requests race,
    // only the first one changes the row, the second gets 409. The startsAt
    // condition does the same against the expiration job.
    const { count } = await this.prisma.event.updateMany({
      where: { id, status: stage.from, startsAt: { gt: deadlineCutoff(leadMs) } },
      data,
    });
    if (count === 0) {
      throw new ConflictException('Event has already been moderated');
    }
    // Only the request that changed the row gets here, so the author is notified once.
    this.notifier.decisionMade(event, data.status, data.declineReason ?? null);
    return this.toResponse(await this.findEventOrThrow(id));
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
