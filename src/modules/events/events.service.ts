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
  DeadlineFields,
  PENDING_STATUSES,
  PendingStatus,
  beforeDeadline,
  isPastDeadline,
  isPending,
  pastDeadline,
} from './event-deadlines';
import {
  OUTCOME_STATUS,
  ProbabilityHistoryEvent,
  computeSuccessProbability,
} from './event-probability';
import { DecisionStatus, EventModerationNotifier } from './event-moderation.notifier';
import { EventLikeResponseDto } from './dto/event-like-response.dto';
import { FinalizedExpAward, awardFinalizedExp } from './event-exp';
import {
  EventComputed,
  EventWithUsers,
  toEventResponse,
  toVotingEventResponse,
} from './event.mapper';

export const LIKABLE_STATUSES = [
  EventStatuses.ON_VOTE,
  EventStatuses.ON_ADMIN_MODERATION,
  EventStatuses.FINALIZED,
  EventStatuses.DECLINED_BY_ADMIN,
] as const;

/**
 * The pupil organizer's own vote is cast on creation, so the event needs at least
 * one more participant: with a threshold of 1 it would reach it before the vote opens.
 */
export const MIN_PUPIL_VOTE_THRESHOLD = 2;

const WITH_USERS = {
  initiator: true,
  image: { select: { url: true } },
  votes: { select: { voter: true }, orderBy: { createdAt: 'asc' } },
} as const;

const withVoteState = (userId: string) =>
  ({
    ...WITH_USERS,
    likes: { where: { userId }, select: { userId: true } },
  }) as const;

type VotingLock = {
  status: EventStatuses;
  voteThreshold: number;
  initiatorId: string;
  createdByRole: UserRoles;
} & DeadlineFields;

type ModerationStage = {
  from: PendingStatus;
  mayModerate: (actor: User, event: EventWithUsers) => boolean;
  forbiddenMessage: string;
  lateMessage: string;
};

const TEACHER_MODERATION: ModerationStage = {
  from: EventStatuses.ON_MODERATION,
  mayModerate: (actor, event) => isTeacherOfClass(actor, event.initiator.class),
  forbiddenMessage: "Only a teacher of the author's class can moderate this event",
  lateMessage: 'Too late to moderate: an event must be decided 3 days before it starts',
};

const ADMIN_MODERATION: ModerationStage = {
  from: EventStatuses.ON_ADMIN_MODERATION,
  mayModerate: (actor) => actor.role === UserRoles.ADMIN,
  forbiddenMessage: 'Only an admin can moderate this event',
  lateMessage: 'Too late to moderate: an event must be decided 3 days before it starts',
};

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImagesService,
    private readonly notifier: EventModerationNotifier,
  ) {}

  async create(actor: User, dto: CreateEventDto): Promise<EventResponseDto> {
    const flow = this.creationFlow(actor, dto);
    const event = await this.withPrismaErrors(() =>
      this.prisma.event.create({
        data: {
          name: dto.name,
          description: dto.description,
          category: dto.category,
          voteThreshold: dto.voteThreshold,
          initiatorId: actor.id,
          createdByRole: actor.role,
          ...flow,
          // The pupil organizer takes part in their event from the start: one of its
          // voters, like any other participant.
          ...(actor.role === UserRoles.PUPIL && { votes: { create: { voterId: actor.id } } }),
        },
        include: WITH_USERS,
      }),
    );
    if (event.status === EventStatuses.ON_MODERATION) {
      this.notifier.awaitsTeachers(event);
    }
    return this.toResponse(event);
  }

  private creationFlow(
    actor: User,
    dto: CreateEventDto,
  ): { status: EventStatuses; scope?: Scopes; startsAt: Date } {
    // The author's date is final: nobody changes it, moderators only approve or decline.
    if (!dto.startsAt) {
      throw new BadRequestException('startsAt is required: the author chooses the date on creation');
    }
    const startsAt = new Date(dto.startsAt);
    if (startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('startsAt must be in the future');
    }
    if (actor.role === UserRoles.ADMIN) {
      if (dto.scope !== undefined && dto.scope !== Scopes.SCHOOL) {
        throw new BadRequestException('An admin event is a school event: its scope can only be SCHOOL');
      }
      return { status: EventStatuses.ON_VOTE, scope: Scopes.SCHOOL, startsAt };
    }

    if (actor.role === UserRoles.PUPIL && dto.voteThreshold < MIN_PUPIL_VOTE_THRESHOLD) {
      throw new BadRequestException(
        `voteThreshold must be at least ${MIN_PUPIL_VOTE_THRESHOLD}: the organizer is already a participant`,
      );
    }
    if (!actor.class) {
      throw new BadRequestException(`${actor.role === UserRoles.TEACHER ? 'Teacher' : 'Pupil'} has no class assigned`);
    }
    const status =
      actor.role === UserRoles.TEACHER ? EventStatuses.ON_VOTE : EventStatuses.ON_MODERATION;
    return { status, scope: dto.scope, startsAt };
  }

  async previewProbability(category: EventCategories, startsAt: Date | null): Promise<number> {
    const history = await this.loadHistory([{ category }]);
    return computeSuccessProbability(category, startsAt, history);
  }

  async findForModeration(actor: User): Promise<EventResponseDto[]> {
    if (actor.role !== UserRoles.TEACHER) {
      throw new ForbiddenException('Only a teacher has a moderation list');
    }
    if (!actor.class) {
      throw new BadRequestException('Teacher has no class assigned');
    }
    const events = await this.prisma.event.findMany({
      where: {
        initiator: { class: actor.class },
        status: EventStatuses.ON_MODERATION,
        ...beforeDeadline(),
      },
      include: WITH_USERS,
      orderBy: { createdAt: 'asc' },
    });
    return this.toResponses(events, toEventResponse);
  }

  async findMine(actor: User): Promise<VotingEventResponseDto[]> {
    const events = await this.prisma.event.findMany({
      where: { initiatorId: actor.id },
      include: withVoteState(actor.id),
      orderBy: { createdAt: 'desc' },
    });
    return this.toResponses(events, (event, computed) =>
      toVotingEventResponse(event, computed, actor.id),
    );
  }

  async findForVoting(actor: User): Promise<VotingEventResponseDto[]> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil has a voting list');
    }
    const events = await this.prisma.event.findMany({
      where: {
        status: EventStatuses.ON_VOTE,
        AND: [
          beforeDeadline(),
          {
            OR: [
              { scope: Scopes.SCHOOL },
              { scope: Scopes.GRADE },
              { scope: Scopes.CLASS, initiator: { class: actor.class } },
            ],
          },
        ],
      },
      include: withVoteState(actor.id),
      orderBy: { createdAt: 'desc' },
    });
    return this.toResponses(
      events.filter((event) => this.isInScope(actor.class, event.initiator.class, event.scope)),
      (event, computed) => toVotingEventResponse(event, computed, actor.id),
    );
  }

  async findForAdminModeration(actor: User): Promise<EventResponseDto[]> {
    if (actor.role !== UserRoles.ADMIN) {
      throw new ForbiddenException('Only an admin has the admin moderation list');
    }
    const events = await this.prisma.event.findMany({
      where: {
        status: EventStatuses.ON_ADMIN_MODERATION,
        ...beforeDeadline(),
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
    return this.moderate(ADMIN_MODERATION, actor, id, { status: EventStatuses.FINALIZED });
  }

  adminDecline(actor: User, id: string, dto: DeclineEventDto): Promise<EventResponseDto> {
    return this.moderate(ADMIN_MODERATION, actor, id, {
      status: EventStatuses.DECLINED_BY_ADMIN,
      declineReason: dto.reason ?? null,
    });
  }

  async vote(actor: User, id: string): Promise<EventVoteResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can vote for an event');
    }
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: {
        status: true,
        scope: true,
        createdByRole: true,
        createdAt: true,
        startsAt: true,
        initiatorId: true,
        initiator: { select: { class: true } },
      },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (event.initiatorId === actor.id) {
      throw new ConflictException('You are the organizer: you take part in this event since you created it');
    }
    if (!this.isInScope(actor.class, event.initiator.class, event.scope)) {
      throw new ForbiddenException(`This ${event.scope} event is not for your class`);
    }
    this.assertVotingOpen(event);

    let result: EventVoteResponseDto;
    let award: FinalizedExpAward | null;
    try {
      ({ result, award } = await this.prisma.$transaction((tx) => this.castVote(tx, id, actor.id)));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You have already voted for this event');
      }
      throw error;
    }
    if (result.status === EventStatuses.ON_ADMIN_MODERATION) {
      this.notifier.awaitsAdmin(id);
    } else if (award) {
      this.notifier.finalizedByVotes(id, award.participantIds);
    }
    return result;
  }

  async unvote(actor: User, id: string): Promise<EventVoteResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can vote for an event');
    }
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockForVoting(tx, id);
      this.assertVotingOpen(locked);
      if (locked.initiatorId === actor.id) {
        throw new ConflictException('The organizer cannot leave their own event; delete it instead');
      }

      const { count } = await tx.eventVote.deleteMany({
        where: { eventId: id, voterId: actor.id },
      });
      if (count === 0) {
        throw new ConflictException('You have not voted for this event');
      }
      const votesCount = await tx.eventVote.count({ where: { eventId: id } });
      return {
        eventId: id,
        votesCount,
        voteThreshold: locked.voteThreshold,
        status: EventStatuses.ON_VOTE,
      };
    });
  }

  async like(actor: User, id: string): Promise<EventLikeResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can like an event');
    }
    const event = await this.prisma.event.findUnique({ where: { id }, select: { status: true } });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (!(LIKABLE_STATUSES as readonly EventStatuses[]).includes(event.status)) {
      throw new ConflictException(
        `The event can be liked once the teacher has approved it, its status is ${event.status}`,
      );
    }
    await this.prisma.eventLike.createMany({
      data: [{ eventId: id, userId: actor.id }],
      skipDuplicates: true,
    });
    return { eventId: id, liked: true, likesCount: await this.countLikes(id) };
  }

  async unlike(actor: User, id: string): Promise<EventLikeResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can like an event');
    }
    const event = await this.prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    await this.prisma.eventLike.deleteMany({ where: { eventId: id, userId: actor.id } });
    return { eventId: id, liked: false, likesCount: await this.countLikes(id) };
  }

  private countLikes(eventId: string): Promise<number> {
    return this.prisma.eventLike.count({ where: { eventId } });
  }

  async setImage(actor: User, id: string, file: Express.Multer.File): Promise<EventResponseDto> {
    const event = await this.findEventOrThrow(id);
    if (actor.id !== event.initiatorId) {
      throw new ForbiddenException('Only the author can set the event image');
    }
    this.assertImageEditable(event);

    const image = await this.images.uploadImage(actor.id, file);
    let previousImageId: string | null;
    try {
      previousImageId = await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockForChange(tx, id);
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
      const locked = await this.lockForChange(tx, id);
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
   * Deletes the event for good (its votes and likes cascade, its image is discarded).
   * The author, or a teacher of the pupil author's class: only while the event is
   * pending and not past its deadline. An admin: any event in any status (the exp
   * already awarded for a FINALIZED event stays). The author is pushed when someone
   * else deleted it.
   */
  async remove(actor: User, id: string): Promise<void> {
    const event = await this.findEventOrThrow(id);
    const isAdmin = actor.role === UserRoles.ADMIN;
    if (!isAdmin && !this.mayDelete(actor, event)) {
      throw new ForbiddenException(
        "Only the author, a teacher of the author's class or an admin can delete this event",
      );
    }
    if (!isAdmin) {
      this.assertDeletable(event);
    }

    const removedImageId = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockForChange(tx, id);
      if (!isAdmin) {
        this.assertDeletable(locked);
      }
      await tx.event.delete({ where: { id } });
      return locked.imageId;
    });
    if (removedImageId) {
      await this.discardImage(removedImageId);
    }
    if (actor.id !== event.initiatorId) {
      this.notifier.eventDeleted(event, actor.role);
    }
  }

  private mayDelete(actor: User, event: EventWithUsers): boolean {
    return (
      actor.id === event.initiatorId ||
      (event.createdByRole === UserRoles.PUPIL && isTeacherOfClass(actor, event.initiator.class))
    );
  }

  private assertDeletable(event: { status: EventStatuses } & DeadlineFields): void {
    if (!isPending(event.status) || isPastDeadline(event)) {
      throw new ConflictException(
        `The event can be deleted only until it is decided, its status is ${event.status}`,
      );
    }
  }

  async expireOverdue(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.event.updateMany({
      where: {
        status: { in: [...PENDING_STATUSES] },
        ...pastDeadline(now),
      },
      data: { status: EventStatuses.EXPIRED },
    });
    if (count > 0) {
      this.logger.log(`Expired ${count} event(s) that were not decided before their deadline`);
    }
    return count;
  }

  private async toResponse(event: EventWithUsers): Promise<EventResponseDto> {
    const [response] = await this.toResponses([event], toEventResponse);
    return response;
  }

  private async toResponses<E extends EventWithUsers, R>(
    events: E[],
    map: (event: E, computed: EventComputed) => R,
  ): Promise<R[]> {
    if (events.length === 0) {
      return [];
    }
    const [history, likes, moderatorsOf] = await Promise.all([
      this.loadHistory(events),
      this.loadLikeCounts(events.map((event) => event.id)),
      this.loadModerators(events),
    ]);
    return events.map((event) =>
      map(event, {
        successProbability: computeSuccessProbability(event.category, event.startsAt, history, event.id),
        likesCount: likes.get(event.id) ?? 0,
        moderators: moderatorsOf(event),
      }),
    );
  }

  private async loadModerators(events: EventWithUsers[]): Promise<(event: EventWithUsers) => User[]> {
    const classes = new Set<string>();
    let needAdmins = false;
    for (const event of events) {
      if (event.status === EventStatuses.ON_MODERATION && event.initiator.class) {
        classes.add(event.initiator.class);
      } else if (event.status === EventStatuses.ON_ADMIN_MODERATION) {
        needAdmins = true;
      }
    }
    const byName = {
      orderBy: [{ surname: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    } satisfies Prisma.UserFindManyArgs;
    const [teachers, admins] = await Promise.all([
      classes.size > 0
        ? this.prisma.user.findMany({
            where: { role: UserRoles.TEACHER, class: { in: [...classes] } },
            ...byName,
          })
        : Promise.resolve([]),
      needAdmins
        ? this.prisma.user.findMany({ where: { role: UserRoles.ADMIN }, ...byName })
        : Promise.resolve([]),
    ]);
    const teachersByClass = new Map<string, User[]>();
    for (const teacher of teachers) {
      const list = teachersByClass.get(teacher.class!) ?? [];
      list.push(teacher);
      teachersByClass.set(teacher.class!, list);
    }
    return (event) => {
      switch (event.status) {
        case EventStatuses.ON_MODERATION:
          return (event.initiator.class && teachersByClass.get(event.initiator.class)) || [];
        case EventStatuses.ON_ADMIN_MODERATION:
          return admins;
        default:
          return [];
      }
    };
  }

  private async loadLikeCounts(eventIds: string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.eventLike.groupBy({
      by: ['eventId'],
      where: { eventId: { in: eventIds } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.eventId, group._count._all]));
  }

  private async loadHistory(
    targets: { category: EventCategories }[],
  ): Promise<ProbabilityHistoryEvent[]> {
    return this.prisma.event.findMany({
      where: {
        category: { in: [...new Set(targets.map((target) => target.category))] },
        status: OUTCOME_STATUS,
        startsAt: { not: null },
      },
      select: { id: true, category: true, startsAt: true, status: true },
    });
  }

  private assertImageEditable(event: { status: EventStatuses } & DeadlineFields): void {
    if (!isPending(event.status) || isPastDeadline(event)) {
      throw new ConflictException(
        `The image can be changed only until the event is decided, its status is ${event.status}`,
      );
    }
  }

  private async lockForChange(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ status: EventStatuses; imageId: string | null } & DeadlineFields> {
    const [locked] = await tx.$queryRaw<({ status: EventStatuses; imageId: string | null } & DeadlineFields)[]>`
      SELECT "status", "createdByRole", "createdAt", "startsAt", "imageId"
      FROM "Event" WHERE "id" = ${id} FOR UPDATE`;
    if (!locked) {
      throw new NotFoundException('Event not found');
    }
    return locked;
  }

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

  private assertVotingOpen(event: { status: EventStatuses } & DeadlineFields): void {
    if (event.status !== EventStatuses.ON_VOTE) {
      throw new ConflictException(`Event is not on vote, its status is ${event.status}`);
    }
    if (isPastDeadline(event)) {
      throw new ConflictException('Voting is closed: it closes 3 days before the event starts');
    }
  }

  private async lockForVoting(
    tx: Prisma.TransactionClient,
    eventId: string,
  ): Promise<VotingLock> {
    const [locked] = await tx.$queryRaw<VotingLock[]>`
      SELECT "status", "voteThreshold", "initiatorId", "createdByRole", "createdAt", "startsAt"
      FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
    if (!locked) {
      throw new NotFoundException('Event not found');
    }
    return locked;
  }

  private async castVote(
    tx: Prisma.TransactionClient,
    eventId: string,
    voterId: string,
  ): Promise<{ result: EventVoteResponseDto; award: FinalizedExpAward | null }> {
    const locked = await this.lockForVoting(tx, eventId);
    this.assertVotingOpen(locked);

    await tx.eventVote.create({ data: { eventId, voterId } });
    const votesCount = await tx.eventVote.count({ where: { eventId } });

    let status: EventStatuses = EventStatuses.ON_VOTE;
    let award: FinalizedExpAward | null = null;
    if (votesCount >= locked.voteThreshold) {
      status =
        locked.createdByRole === UserRoles.ADMIN
          ? EventStatuses.FINALIZED
          : EventStatuses.ON_ADMIN_MODERATION;
      await tx.event.update({ where: { id: eventId }, data: { status } });
      if (status === EventStatuses.FINALIZED) {
        award = await awardFinalizedExp(tx, eventId);
      }
    }
    return { result: { eventId, votesCount, voteThreshold: locked.voteThreshold, status }, award };
  }

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
      isTeacherOfClass(actor, event.initiator.class)
    );
  }

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
    if (isPastDeadline(event)) {
      throw new ConflictException(stage.lateMessage);
    }

    const award = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.event.updateMany({
        where: { id, status: stage.from, ...beforeDeadline() },
        data,
      });
      if (count === 0) {
        throw new ConflictException('Event has already been moderated');
      }
      return data.status === EventStatuses.FINALIZED ? awardFinalizedExp(tx, id) : null;
    });
    this.notifier.decisionMade(event, data.status, data.declineReason ?? null, award?.organizerExp ?? 0);
    if (award && event.startsAt) {
      this.notifier.participantsFinalized({ id, name: event.name, startsAt: event.startsAt }, award.participantIds);
    }
    return this.toResponse(await this.findEventOrThrow(id));
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

function isTeacherOfClass(actor: User, className: string | null): boolean {
  return actor.role === UserRoles.TEACHER && actor.class !== null && actor.class === className;
}

function gradeOf(className: string | null): number | null {
  const match = className?.match(/\d+/);
  return match ? Number(match[0]) : null;
}
