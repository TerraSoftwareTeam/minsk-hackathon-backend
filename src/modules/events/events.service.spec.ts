import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { EventModerationNotifier } from './event-moderation.notifier';
import { EventWithUsers } from './event.mapper';
import { EventsService } from './events.service';

const user = (over: Partial<User>): User => ({
  id: 'x',
  schoolsById: null,
  name: 'N',
  surname: 'S',
  class: null,
  role: UserRoles.PUPIL,
  ...over,
});

const pupil = user({ id: 'pupil-1', schoolsById: 'p1', class: '10A' });
const otherPupil = user({ id: 'pupil-2', schoolsById: 'p2', class: '10A' });
const teacher = user({ id: 'teacher-1', schoolsById: 't1', class: '10A', role: UserRoles.TEACHER });
const otherTeacher = user({ id: 'teacher-2', schoolsById: 't2', class: '11B', role: UserRoles.TEACHER });
const admin = user({ id: 'admin-1', role: UserRoles.ADMIN });

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const PAST = new Date(Date.now() - 60 * 1000);
/** Not started yet, but inside the 2-day window before the start: voting is closed. */
const IN_TWO_DAYS_WINDOW = new Date(Date.now() + 24 * 3600 * 1000);
const DAY_MS = 24 * 3600 * 1000;

const storedEvent = (over: Partial<EventWithUsers> = {}): EventWithUsers => ({
  id: 'event-1',
  name: 'Trip',
  description: null,
  scope: Scopes.CLASS,
  category: EventCategories.SPORTS,
  status: EventStatuses.ON_MODERATION,
  declineReason: null,
  voteThreshold: 10,
  startsAt: FUTURE,
  initiatorId: pupil.id,
  teacherId: teacher.id,
  initiator: pupil,
  teacher,
  createdAt: new Date('2026-11-06T10:00:00Z'),
  updatedAt: new Date('2026-11-06T10:00:00Z'),
  imageId: null,
  image: null,
  ...over,
});

describe('EventsService', () => {
  let service: EventsService;
  let prisma: {
    user: { findFirst: jest.Mock };
    event: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    eventVote: { create: jest.Mock; count: jest.Mock };
    eventRating: { groupBy: jest.Mock; upsert: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let images: { uploadImage: jest.Mock; deleteImage: jest.Mock };
  let notifier: { awaitsTeacher: jest.Mock; awaitsAdmin: jest.Mock; decisionMade: jest.Mock };
  // Client used inside prisma.$transaction(fn).
  let tx: {
    $queryRaw: jest.Mock;
    eventVote: { create: jest.Mock; count: jest.Mock };
    event: { update: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(teacher) },
      event: {
        create: jest.fn().mockResolvedValue(storedEvent()),
        findMany: jest.fn().mockResolvedValue([storedEvent()]),
        findUnique: jest.fn().mockResolvedValue(storedEvent()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      eventVote: {
        create: jest.fn(),
        count: jest.fn(),
      },
      eventRating: {
        groupBy: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ status: EventStatuses.ON_VOTE, voteThreshold: 10, startsAt: FUTURE }]),
      eventVote: {
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
      },
      event: { update: jest.fn().mockResolvedValue({}) },
    };
    images = {
      uploadImage: jest.fn().mockResolvedValue({ id: 'img-new', url: 'https://cdn/new.jpg' }),
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };
    notifier = { awaitsTeacher: jest.fn(), awaitsAdmin: jest.fn(), decisionMade: jest.fn() };
    service = new EventsService(
      prisma as unknown as PrismaService,
      images as unknown as ImagesService,
      notifier as unknown as EventModerationNotifier,
    );
  });

  describe('create', () => {
    it('pupil creates an ON_MODERATION event assigned to the teacher of their class', async () => {
      const result = await service.create(pupil, { name: 'Trip', scope: Scopes.GRADE, voteThreshold: 10, startsAt: FUTURE.toISOString(), category: EventCategories.SPORTS });

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { role: UserRoles.TEACHER, class: '10A' },
        orderBy: { id: 'asc' },
      });
      expect(prisma.event.create.mock.calls[0][0].data).toEqual({
        name: 'Trip',
        description: undefined,
        scope: Scopes.GRADE,
        category: EventCategories.SPORTS,
        voteThreshold: 10,
        startsAt: FUTURE,
        status: EventStatuses.ON_MODERATION,
        initiatorId: pupil.id,
        teacherId: teacher.id,
      });
      expect(result.initiator.id).toBe(pupil.id);
      expect(result.teacher.id).toBe(teacher.id);
      expect(notifier.awaitsTeacher).toHaveBeenCalledWith(storedEvent());
    });

    it.each([
      ['teacher', teacher],
      ['admin', admin],
    ])('%s cannot create an event', async (_name, actor) => {
      await expect(service.create(actor, { name: 'Trip', voteThreshold: 10, startsAt: FUTURE.toISOString(), category: EventCategories.SPORTS })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.event.create).not.toHaveBeenCalled();
    });

    it('BadRequest when the class has no teacher', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.create(pupil, { name: 'Trip', voteThreshold: 10, startsAt: FUTURE.toISOString(), category: EventCategories.SPORTS })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.event.create).not.toHaveBeenCalled();
    });

    it('BadRequest when the pupil has no class', async () => {
      await expect(
        service.create({ ...pupil, class: null }, { name: 'Trip', voteThreshold: 10, startsAt: FUTURE.toISOString(), category: EventCategories.SPORTS }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      ['in the past', PAST],
      ['less than 2 days ahead', IN_TWO_DAYS_WINDOW],
    ])('BadRequest, nothing stored, when startsAt is %s', async (_name, startsAt) => {
      await expect(
        service.create(pupil, { name: 'Trip', voteThreshold: 10, startsAt: startsAt.toISOString(), category: EventCategories.SPORTS }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.event.create).not.toHaveBeenCalled();
    });

    it('response carries votingClosesAt = startsAt - 2 days', async () => {
      const result = await service.create(pupil, {
        name: 'Trip',
        voteThreshold: 10,
        startsAt: FUTURE.toISOString(), category: EventCategories.SPORTS,
      });
      expect(result.votingClosesAt.getTime()).toBe(FUTURE.getTime() - 2 * DAY_MS);
    });

    it('Conflict on a duplicate name', async () => {
      prisma.event.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.create(pupil, { name: 'Trip', voteThreshold: 10, startsAt: FUTURE.toISOString(), category: EventCategories.SPORTS })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('findForModeration', () => {
    it("returns the teacher's ON_MODERATION events, oldest first", async () => {
      const result = await service.findForModeration(teacher);

      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: {
          teacherId: teacher.id,
          status: EventStatuses.ON_MODERATION,
          startsAt: { gt: expect.any(Date) },
        },
        include: { initiator: true, teacher: true, image: { select: { url: true } } },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('is teacher-only', async () => {
      await expect(service.findForModeration(pupil)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findOne', () => {
    it.each([
      ['initiator', pupil],
      ['assigned teacher', teacher],
      ['admin', admin],
    ])('%s can read the event', async (_name, actor) => {
      await expect(service.findOne(actor, 'event-1')).resolves.toMatchObject({ id: 'event-1' });
    });

    it.each([
      ['classmate', otherPupil],
      ['teacher of another class', otherTeacher],
    ])('%s cannot read the event', async (_name, actor) => {
      await expect(service.findOne(actor, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 for a missing event', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.findOne(admin, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('approve / decline', () => {
    it('assigned teacher approves: ON_MODERATION -> ON_VOTE', async () => {
      prisma.event.findUnique
        .mockResolvedValueOnce(storedEvent())
        .mockResolvedValueOnce(storedEvent({ status: EventStatuses.ON_VOTE }));

      const result = await service.approve(teacher, 'event-1');

      expect(prisma.event.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'event-1',
          status: EventStatuses.ON_MODERATION,
          startsAt: { gt: expect.any(Date) },
        },
        data: { status: EventStatuses.ON_VOTE },
      });
      expect(result.status).toBe(EventStatuses.ON_VOTE);
      expect(notifier.decisionMade).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'event-1', initiatorId: pupil.id }),
        EventStatuses.ON_VOTE,
        null,
      );
    });

    it('assigned teacher declines with a reason', async () => {
      await service.decline(teacher, 'event-1', { reason: 'Pick another date' });
      expect(prisma.event.updateMany.mock.calls[0][0].data).toEqual({
        status: EventStatuses.DECLINED,
        declineReason: 'Pick another date',
      });
      expect(notifier.decisionMade).toHaveBeenCalledWith(
        expect.objectContaining({ initiatorId: pupil.id }),
        EventStatuses.DECLINED,
        'Pick another date',
      );
    });

    it('no push when the decision lost a race and changed nothing', async () => {
      prisma.event.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.approve(teacher, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(notifier.decisionMade).not.toHaveBeenCalled();
    });

    it('no push when the moderator is not allowed', async () => {
      await expect(service.approve(otherTeacher, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(notifier.decisionMade).not.toHaveBeenCalled();
    });

    it('decline without a reason stores null', async () => {
      await service.decline(teacher, 'event-1', {});
      expect(prisma.event.updateMany.mock.calls[0][0].data.declineReason).toBeNull();
    });

    it.each([
      ['initiator', pupil],
      ['teacher of another class', otherTeacher],
      ['admin', admin],
    ])('%s cannot moderate', async (_name, actor) => {
      await expect(service.approve(actor, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.decline(actor, 'event-1', {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.event.updateMany).not.toHaveBeenCalled();
    });

    it('Conflict when the event is no longer on moderation', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status: EventStatuses.DECLINED }));
      await expect(service.approve(teacher, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.event.updateMany).not.toHaveBeenCalled();
    });

    it('Conflict, nothing changed, when voting has closed (2 days before the start)', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ startsAt: IN_TWO_DAYS_WINDOW }));
      await expect(service.approve(teacher, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.decline(teacher, 'event-1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.event.updateMany).not.toHaveBeenCalled();
    });

    it('Conflict when a concurrent request moderated it first', async () => {
      prisma.event.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.approve(teacher, 'event-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findMine', () => {
    it("returns the author's events in any status, newest first, with vote counts", async () => {
      prisma.event.findMany.mockResolvedValue([
        {
          ...storedEvent({ id: 'e2', status: EventStatuses.DECLINED }),
          votes: [],
          _count: { votes: 0 },
        },
        {
          ...storedEvent({ id: 'e1', status: EventStatuses.ON_VOTE }),
          votes: [{ voterId: pupil.id }],
          _count: { votes: 4 },
        },
      ]);

      const result = await service.findMine(pupil);

      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: { initiatorId: pupil.id },
        include: {
          initiator: true,
          teacher: true,
          image: { select: { url: true } },
          votes: { where: { voterId: pupil.id }, select: { voterId: true } },
          _count: { select: { votes: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result.map((e) => [e.id, e.status, e.votesCount])).toEqual([
        ['e2', EventStatuses.DECLINED, 0],
        ['e1', EventStatuses.ON_VOTE, 4],
      ]);
      expect(result[1].hasVoted).toBe(true);
    });

    it.each([
      ['teacher', teacher],
      ['admin', admin],
    ])('%s has no own events list', async (_name, actor) => {
      await expect(service.findMine(actor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.event.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findForVoting', () => {
    const votingEvent = (
      id: string,
      scope: Scopes,
      initiatorClass: string,
      over: { votes?: { voterId: string }[]; votesCount?: number } = {},
    ) => ({
      ...storedEvent({
        id,
        scope,
        status: EventStatuses.ON_VOTE,
        initiator: { ...otherPupil, class: initiatorClass },
      }),
      votes: over.votes ?? [],
      _count: { votes: over.votesCount ?? 0 },
    });

    it('queries ON_VOTE events of the pupil scope with their vote state, newest first', async () => {
      prisma.event.findMany.mockResolvedValue([]);

      await service.findForVoting(pupil);

      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: {
          status: EventStatuses.ON_VOTE,
          startsAt: { gt: expect.any(Date) },
          OR: [
            { scope: Scopes.SCHOOL },
            { scope: Scopes.GRADE },
            { scope: Scopes.CLASS, initiator: { class: '10A' } },
          ],
        },
        include: {
          initiator: true,
          teacher: true,
          image: { select: { url: true } },
          votes: { where: { voterId: pupil.id }, select: { voterId: true } },
          _count: { select: { votes: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('keeps only GRADE events of the same grade and maps the vote state', async () => {
      prisma.event.findMany.mockResolvedValue([
        votingEvent('school', Scopes.SCHOOL, '5A'),
        votingEvent('grade-same', Scopes.GRADE, '10Б', {
          votes: [{ voterId: pupil.id }],
          votesCount: 7,
        }),
        votingEvent('grade-other', Scopes.GRADE, '11A'),
        votingEvent('grade-prefix', Scopes.GRADE, '1A'),
        votingEvent('class-same', Scopes.CLASS, '10A'),
      ]);

      const result = await service.findForVoting(pupil);

      expect(result.map((e) => e.id)).toEqual(['school', 'grade-same', 'class-same']);
      expect(result[1]).toMatchObject({ votesCount: 7, hasVoted: true });
      expect(result[0]).toMatchObject({ votesCount: 0, hasVoted: false });
      expect(result[0]).not.toHaveProperty('votes');
      expect(result[0]).not.toHaveProperty('_count');
    });

    it.each([
      ['teacher', teacher],
      ['admin', admin],
    ])('%s has no voting list', async (_name, actor) => {
      await expect(service.findForVoting(actor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.event.findMany).not.toHaveBeenCalled();
    });
  });

  describe('admin moderation', () => {
    const onAdminModeration = () => storedEvent({ status: EventStatuses.ON_ADMIN_MODERATION });

    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(onAdminModeration());
    });

    it('lists ON_ADMIN_MODERATION events of all classes, oldest first', async () => {
      await service.findForAdminModeration(admin);

      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: { status: EventStatuses.ON_ADMIN_MODERATION, startsAt: { gt: expect.any(Date) } },
        include: { initiator: true, teacher: true, image: { select: { url: true } } },
        orderBy: { createdAt: 'asc' },
      });
    });

    it.each([
      ['teacher', teacher],
      ['pupil', pupil],
    ])('%s has no admin moderation list', async (_name, actor) => {
      await expect(service.findForAdminModeration(actor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('admin approves: ON_ADMIN_MODERATION -> FINALIZED', async () => {
      prisma.event.findUnique
        .mockResolvedValueOnce(onAdminModeration())
        .mockResolvedValueOnce(storedEvent({ status: EventStatuses.FINALIZED }));

      const result = await service.adminApprove(admin, 'event-1');

      expect(prisma.event.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'event-1',
          status: EventStatuses.ON_ADMIN_MODERATION,
          startsAt: { gt: expect.any(Date) },
        },
        data: { status: EventStatuses.FINALIZED },
      });
      expect(result.status).toBe(EventStatuses.FINALIZED);
      expect(notifier.decisionMade).toHaveBeenCalledWith(
        expect.objectContaining({ initiatorId: pupil.id }),
        EventStatuses.FINALIZED,
        null,
      );
    });

    it('admin declines with a reason: -> DECLINED_BY_ADMIN', async () => {
      await service.adminDecline(admin, 'event-1', { reason: 'Not this term' });
      expect(prisma.event.updateMany.mock.calls[0][0].data).toEqual({
        status: EventStatuses.DECLINED_BY_ADMIN,
        declineReason: 'Not this term',
      });
      expect(notifier.decisionMade).toHaveBeenCalledWith(
        expect.objectContaining({ initiatorId: pupil.id }),
        EventStatuses.DECLINED_BY_ADMIN,
        'Not this term',
      );
    });

    it('admin decline without a reason stores null', async () => {
      await service.adminDecline(admin, 'event-1', {});
      expect(prisma.event.updateMany.mock.calls[0][0].data.declineReason).toBeNull();
    });

    it.each([
      ['assigned teacher', teacher],
      ['initiator', pupil],
    ])('%s cannot moderate as admin', async (_name, actor) => {
      await expect(service.adminApprove(actor, 'event-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.adminDecline(actor, 'event-1', {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.event.updateMany).not.toHaveBeenCalled();
    });

    it.each([EventStatuses.ON_VOTE, EventStatuses.ON_MODERATION, EventStatuses.FINALIZED])(
      'Conflict when the event is %s',
      async (status) => {
        prisma.event.findUnique.mockResolvedValue(storedEvent({ status }));
        await expect(service.adminApprove(admin, 'event-1')).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(prisma.event.updateMany).not.toHaveBeenCalled();
      },
    );

    it('admin cannot do the teacher step', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent());
      await expect(service.approve(admin, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('Conflict, nothing changed, when the event has already started', async () => {
      prisma.event.findUnique.mockResolvedValue(
        storedEvent({ status: EventStatuses.ON_ADMIN_MODERATION, startsAt: PAST }),
      );
      await expect(service.adminApprove(admin, 'event-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.event.updateMany).not.toHaveBeenCalled();
    });

    it('admin may still decide inside the 2-day window before the start', async () => {
      prisma.event.findUnique.mockResolvedValue(
        storedEvent({ status: EventStatuses.ON_ADMIN_MODERATION, startsAt: IN_TWO_DAYS_WINDOW }),
      );
      await expect(service.adminApprove(admin, 'event-1')).resolves.toBeDefined();
      expect(prisma.event.updateMany).toHaveBeenCalled();
    });

    it('Conflict when a concurrent admin decided first', async () => {
      prisma.event.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.adminDecline(admin, 'event-1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('vote', () => {
    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(voteTarget(Scopes.SCHOOL));
    });

    const voteTarget = (scope: Scopes, initiatorClass: string | null = '10A') => ({
      status: EventStatuses.ON_VOTE,
      scope,
      startsAt: FUTURE,
      initiator: { class: initiatorClass },
    });

    it.each([
      [Scopes.CLASS, '10A', '10A'],
      [Scopes.GRADE, '10A', '10Б'],
      [Scopes.GRADE, '10 A', '10-В'],
      [Scopes.SCHOOL, '10A', '5A'],
      [Scopes.SCHOOL, '10A', null],
    ])('%s event from %s: pupil of %s can vote', async (scope, initiatorClass, voterClass) => {
      prisma.event.findUnique.mockResolvedValue(voteTarget(scope, initiatorClass));
      await expect(
        service.vote({ ...otherPupil, class: voterClass }, 'event-1'),
      ).resolves.toBeDefined();
    });

    it.each([
      [Scopes.CLASS, '10A', '10B'],
      [Scopes.CLASS, '10A', null],
      [Scopes.GRADE, '10A', '11A'],
      [Scopes.GRADE, '1A', '11A'],
      [Scopes.GRADE, '10A', null],
      [Scopes.GRADE, 'A', 'B'],
    ])('%s event from %s: pupil of %s cannot vote', async (scope, initiatorClass, voterClass) => {
      prisma.event.findUnique.mockResolvedValue(voteTarget(scope, initiatorClass));
      await expect(
        service.vote({ ...otherPupil, class: voterClass }, 'event-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.eventVote.create).not.toHaveBeenCalled();
    });

    it('pupil votes for an ON_VOTE event and gets the vote count', async () => {
      tx.eventVote.count.mockResolvedValue(3);

      const result = await service.vote(otherPupil, 'event-1');

      expect(tx.eventVote.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', voterId: otherPupil.id },
      });
      expect(tx.event.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        eventId: 'event-1',
        votesCount: 3,
        voteThreshold: 10,
        status: EventStatuses.ON_VOTE,
      });
      expect(notifier.awaitsAdmin).not.toHaveBeenCalled();
    });

    it('the vote that reaches the threshold moves the event to ON_ADMIN_MODERATION', async () => {
      tx.eventVote.count.mockResolvedValue(10);

      const result = await service.vote(pupil, 'event-1');

      expect(tx.event.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { status: EventStatuses.ON_ADMIN_MODERATION },
      });
      expect(result.status).toBe(EventStatuses.ON_ADMIN_MODERATION);
      expect(notifier.awaitsAdmin).toHaveBeenCalledWith('event-1');
    });

    it('threshold 1: the first vote already moves the event', async () => {
      tx.$queryRaw.mockResolvedValue([
        { status: EventStatuses.ON_VOTE, voteThreshold: 1, startsAt: FUTURE },
      ]);
      tx.eventVote.count.mockResolvedValue(1);

      const result = await service.vote(pupil, 'event-1');

      expect(result.status).toBe(EventStatuses.ON_ADMIN_MODERATION);
    });

    it('Conflict, no vote stored, when voting has closed (2 days before the start)', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...voteTarget(Scopes.SCHOOL),
        startsAt: IN_TWO_DAYS_WINDOW,
      });

      await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('Conflict, no vote stored, when voting closed after the pre-check', async () => {
      tx.$queryRaw.mockResolvedValue([
        { status: EventStatuses.ON_VOTE, voteThreshold: 10, startsAt: IN_TWO_DAYS_WINDOW },
      ]);

      await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.eventVote.create).not.toHaveBeenCalled();
    });

    it('Conflict, no vote stored, when the event left ON_VOTE after the pre-check', async () => {
      tx.$queryRaw.mockResolvedValue([
        { status: EventStatuses.ON_ADMIN_MODERATION, voteThreshold: 10, startsAt: FUTURE },
      ]);

      await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.eventVote.create).not.toHaveBeenCalled();
    });

    it.each([
      ['teacher', teacher],
      ['admin', admin],
    ])('%s cannot vote', async (_name, actor) => {
      await expect(service.vote(actor, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.eventVote.create).not.toHaveBeenCalled();
    });

    it.each([
      EventStatuses.ON_MODERATION,
      EventStatuses.DECLINED,
      EventStatuses.FINALIZED,
    ])('Conflict when the event is %s', async (status) => {
      prisma.event.findUnique.mockResolvedValue({ ...voteTarget(Scopes.SCHOOL), status });
      await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.eventVote.create).not.toHaveBeenCalled();
    });

    it('404 for a missing event', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.vote(pupil, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('Conflict on a second vote by the same pupil', async () => {
      tx.eventVote.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('expireOverdue', () => {
    it('expires moderation/vote at the voting deadline and admin moderation at the start', async () => {
      prisma.event.updateMany.mockResolvedValue({ count: 2 });
      const now = new Date('2026-12-01T10:00:00Z');
      const votingCutoff = new Date('2026-12-03T10:00:00Z'); // starts within 2 days

      await expect(service.expireOverdue(now)).resolves.toBe(2);
      expect(prisma.event.updateMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { status: EventStatuses.ON_MODERATION, startsAt: { lte: votingCutoff } },
            { status: EventStatuses.ON_VOTE, startsAt: { lte: votingCutoff } },
            { status: EventStatuses.ON_ADMIN_MODERATION, startsAt: { lte: now } },
          ],
        },
        data: { status: EventStatuses.EXPIRED },
      });
    });
  });

  describe('success probability', () => {
    const SAT_NOON = new Date('2026-12-05T12:00:00+03:00');
    const history = (n: number, status: EventStatuses) =>
      Array.from({ length: n }, (_, i) => ({
        category: EventCategories.SPORTS,
        status,
        id: `h${i}`,
        startsAt: new Date(SAT_NOON.getTime() - (i + 1) * 7 * DAY_MS),
      }));

    it('preview loads earlier FINALIZED/EXPIRED and overdue pending events of the category', async () => {
      prisma.event.findMany.mockResolvedValue(history(5, EventStatuses.FINALIZED));

      await expect(service.previewProbability(EventCategories.SPORTS, SAT_NOON)).resolves.toBe(0.9);
      const { where, select } = prisma.event.findMany.mock.calls[0][0];
      expect(where.category).toEqual({ in: [EventCategories.SPORTS] });
      expect(where.startsAt).toBeUndefined();
      expect(where.OR[0]).toEqual({
        status: { in: [EventStatuses.FINALIZED, EventStatuses.EXPIRED] },
      });
      expect(where.OR.slice(1).map((c: { status: EventStatuses }) => c.status)).toEqual([
        EventStatuses.ON_MODERATION,
        EventStatuses.ON_VOTE,
        EventStatuses.ON_ADMIN_MODERATION,
      ]);
      expect(select).toEqual({ id: true, category: true, startsAt: true, status: true });
    });

    it('an overdue pending event counts as a failure before the scheduler expires it', async () => {
      prisma.event.findMany.mockResolvedValue(history(5, EventStatuses.ON_VOTE));

      await expect(service.previewProbability(EventCategories.SPORTS, SAT_NOON)).resolves.toBe(0.05);
    });

    it('recomputes on every request: a changed history changes the probability', async () => {
      prisma.event.findMany.mockResolvedValueOnce(history(5, EventStatuses.FINALIZED));
      await expect(service.previewProbability(EventCategories.SPORTS, SAT_NOON)).resolves.toBe(0.9);

      prisma.event.findMany.mockResolvedValueOnce(history(5, EventStatuses.EXPIRED));
      await expect(service.previewProbability(EventCategories.SPORTS, SAT_NOON)).resolves.toBe(0.05);
    });

    it('event responses carry the probability', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ startsAt: SAT_NOON }));
      prisma.event.findMany.mockResolvedValue(history(1, EventStatuses.FINALIZED));

      const result = await service.findOne(admin, 'event-1');
      expect(result.successProbability).toBe(0.58);
    });

    it.each([
      ['findForModeration', teacher, EventStatuses.ON_MODERATION],
      ['findMine', pupil, EventStatuses.ON_VOTE],
      ['findForVoting', pupil, EventStatuses.ON_VOTE],
      ['findForAdminModeration', admin, EventStatuses.ON_ADMIN_MODERATION],
    ] as const)('%s returns the probability of every listed event', async (method, actor, status) => {
      const listed = {
        ...storedEvent({ status, scope: Scopes.SCHOOL, startsAt: SAT_NOON }),
        votes: [],
        _count: { votes: 0 },
      };
      prisma.event.findMany
        .mockResolvedValueOnce([listed, { ...listed, id: 'event-2' }])
        .mockResolvedValueOnce(history(5, EventStatuses.FINALIZED));

      const result = await service[method](actor);
      expect(result.map((e) => e.successProbability)).toEqual([0.9, 0.9]);
    });

    it('lists load the history once for all events', async () => {
      prisma.event.findMany
        .mockResolvedValueOnce([storedEvent({ id: 'a' }), storedEvent({ id: 'b' })])
        .mockResolvedValueOnce([]);

      const result = await service.findForAdminModeration(admin);
      expect(result.map((e) => e.successProbability)).toEqual([0.5, 0.5]);
      expect(prisma.event.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('event image', () => {
    const upload = { originalname: 'a.jpg', mimetype: 'image/jpeg', size: 10, buffer: Buffer.from([0xff, 0xd8, 0xff]) } as Express.Multer.File;
    /** Row as seen under the lock inside the transaction. */
    const lockedRow = (over: Partial<{ status: EventStatuses; startsAt: Date; imageId: string | null }> = {}) => [
      { status: EventStatuses.ON_MODERATION, startsAt: FUTURE, imageId: null, ...over },
    ];
    beforeEach(() => {
      (tx.event as { update: jest.Mock }).update.mockResolvedValue({});
    });

    it.each([EventStatuses.ON_MODERATION, EventStatuses.ON_VOTE, EventStatuses.ON_ADMIN_MODERATION])(
      'author sets an image while the event is %s',
      async (status) => {
        prisma.event.findUnique.mockResolvedValue(storedEvent({ status }));
        tx.$queryRaw.mockResolvedValue(lockedRow({ status }));

        await service.setImage(pupil, 'event-1', upload);
        expect(images.uploadImage).toHaveBeenCalledWith(pupil.id, upload);
        expect(tx.event.update).toHaveBeenCalledWith({ where: { id: 'event-1' }, data: { imageId: 'img-new' } });
        expect(images.deleteImage).not.toHaveBeenCalled();
      },
    );

    it('replacing keeps one image: the previous one is deleted', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ imageId: 'img-old' }));
      tx.$queryRaw.mockResolvedValue(lockedRow({ imageId: 'img-old' }));

      await service.setImage(pupil, 'event-1', upload);
      expect(images.deleteImage).toHaveBeenCalledWith('img-old');
      expect(images.deleteImage).toHaveBeenCalledTimes(1);
    });

    it('response carries the image url', async () => {
      prisma.event.findUnique
        .mockResolvedValueOnce(storedEvent())
        .mockResolvedValueOnce(storedEvent({ imageId: 'img-new', image: { url: 'https://cdn/new.jpg' } }));
      tx.$queryRaw.mockResolvedValue(lockedRow());

      const result = await service.setImage(pupil, 'event-1', upload);
      expect(result.imageUrl).toBe('https://cdn/new.jpg');
    });

    it.each([
      ['another pupil', otherPupil],
      ['the teacher', teacher],
      ['an admin', admin],
    ])('%s cannot set the image', async (_name, actor) => {
      await expect(service.setImage(actor, 'event-1', upload)).rejects.toBeInstanceOf(ForbiddenException);
      expect(images.uploadImage).not.toHaveBeenCalled();
    });

    it.each([EventStatuses.FINALIZED, EventStatuses.DECLINED, EventStatuses.DECLINED_BY_ADMIN, EventStatuses.EXPIRED])(
      'author cannot set an image once the event is %s',
      async (status) => {
        prisma.event.findUnique.mockResolvedValue(storedEvent({ status }));
        await expect(service.setImage(pupil, 'event-1', upload)).rejects.toBeInstanceOf(ConflictException);
        expect(images.uploadImage).not.toHaveBeenCalled();
      },
    );

    it('author cannot set an image past the deadline, before the scheduler expires it', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status: EventStatuses.ON_VOTE, startsAt: IN_TWO_DAYS_WINDOW }));
      await expect(service.setImage(pupil, 'event-1', upload)).rejects.toBeInstanceOf(ConflictException);
    });

    it('decided during the upload: nothing changes and the new upload is deleted', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent());
      tx.$queryRaw.mockResolvedValue(lockedRow({ status: EventStatuses.DECLINED }));

      await expect(service.setImage(pupil, 'event-1', upload)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.event.update).not.toHaveBeenCalled();
      expect(images.deleteImage).toHaveBeenCalledWith('img-new');
    });

    it('author removes the image while pending', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ imageId: 'img-old' }));
      tx.$queryRaw.mockResolvedValue(lockedRow({ imageId: 'img-old' }));

      await service.removeImage(pupil, 'event-1');
      expect(tx.event.update).toHaveBeenCalledWith({ where: { id: 'event-1' }, data: { imageId: null } });
      expect(images.deleteImage).toHaveBeenCalledWith('img-old');
    });

    it('admin removes the image even after FINALIZED', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status: EventStatuses.FINALIZED, imageId: 'img-old' }));
      tx.$queryRaw.mockResolvedValue(lockedRow({ status: EventStatuses.FINALIZED, imageId: 'img-old' }));

      await service.removeImage(admin, 'event-1');
      expect(images.deleteImage).toHaveBeenCalledWith('img-old');
    });

    it('author cannot remove the image after FINALIZED', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status: EventStatuses.FINALIZED, imageId: 'img-old' }));
      await expect(service.removeImage(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(images.deleteImage).not.toHaveBeenCalled();
    });

    it('teacher cannot remove the image', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ imageId: 'img-old' }));
      await expect(service.removeImage(teacher, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('removing when there is no image does nothing', async () => {
      tx.$queryRaw.mockResolvedValue(lockedRow());
      await expect(service.removeImage(pupil, 'event-1')).resolves.toMatchObject({ imageUrl: null });
      expect(tx.event.update).not.toHaveBeenCalled();
      expect(images.deleteImage).not.toHaveBeenCalled();
    });

    it('a failed cleanup of the old image does not fail the request', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ imageId: 'img-old' }));
      tx.$queryRaw.mockResolvedValue(lockedRow({ imageId: 'img-old' }));
      images.deleteImage.mockRejectedValue(new Error('cloudinary down'));

      await expect(service.setImage(pupil, 'event-1', upload)).resolves.toBeDefined();
    });
  });

  describe('rating', () => {
    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue({ status: EventStatuses.ON_VOTE });
      prisma.eventRating.groupBy.mockResolvedValue([
        { eventId: 'event-1', _avg: { stars: 13 / 3 }, _count: { _all: 3 } },
      ]);
    });

    it('a pupil rates an ON_VOTE event', async () => {
      const result = await service.rate(otherPupil, 'event-1', 5);

      expect(prisma.event.findUnique).toHaveBeenCalledWith({ where: { id: 'event-1' }, select: { status: true } });
      expect(prisma.eventRating.upsert).toHaveBeenCalledWith({
        where: { eventId_raterId: { eventId: 'event-1', raterId: otherPupil.id } },
        create: { eventId: 'event-1', raterId: otherPupil.id, stars: 5 },
        update: { stars: 5 },
      });
      expect(result).toEqual({ eventId: 'event-1', stars: 5, ratingAverage: 4.33, ratingsCount: 3 });
    });

    it.each([
      EventStatuses.ON_VOTE,
      EventStatuses.ON_ADMIN_MODERATION,
      EventStatuses.FINALIZED,
      EventStatuses.DECLINED_BY_ADMIN,
    ])('%s can be rated', async (status) => {
      prisma.event.findUnique.mockResolvedValue({ status });
      await expect(service.rate(otherPupil, 'event-1', 3)).resolves.toBeDefined();
    });

    it('a pupil of any class rates, the scope does not matter', async () => {
      await expect(service.rate({ ...otherPupil, class: '5B' }, 'event-1', 5)).resolves.toBeDefined();
      await expect(service.rate({ ...otherPupil, class: null }, 'event-1', 5)).resolves.toBeDefined();
    });

    it('the author may rate their own event too', async () => {
      await expect(service.rate(pupil, 'event-1', 4)).resolves.toBeDefined();
    });

    it('a concurrent first rating of the same pupil turns into an update', async () => {
      prisma.eventRating.upsert.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      );
      await service.rate(otherPupil, 'event-1', 2);
      expect(prisma.eventRating.update).toHaveBeenCalledWith({
        where: { eventId_raterId: { eventId: 'event-1', raterId: otherPupil.id } },
        data: { stars: 2 },
      });
    });

    it.each([['teacher', teacher], ['admin', admin]])('%s cannot rate', async (_name, actor) => {
      await expect(service.rate(actor, 'event-1', 5)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.eventRating.upsert).not.toHaveBeenCalled();
    });

    it.each([EventStatuses.ON_MODERATION, EventStatuses.DECLINED, EventStatuses.EXPIRED])(
      'Conflict when the event is %s',
      async (status) => {
        prisma.event.findUnique.mockResolvedValue({ status });
        await expect(service.rate(otherPupil, 'event-1', 5)).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.eventRating.upsert).not.toHaveBeenCalled();
      },
    );

    it('NotFound for an unknown event', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.rate(otherPupil, 'event-1', 5)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rating feed: ratable events of every class and scope with the own rating', async () => {
      prisma.event.findMany.mockImplementation((args: { include?: { ratings?: unknown } }) =>
        args.include?.ratings
          ? Promise.resolve([
              { ...storedEvent({ status: EventStatuses.ON_VOTE }), ratings: [{ stars: 4 }] },
              {
                ...storedEvent({ id: 'event-2', status: EventStatuses.FINALIZED, initiator: { ...pupil, class: '11B' } }),
                ratings: [],
              },
            ])
          : Promise.resolve([]),
      );

      const result = await service.findForRating({ ...otherPupil, class: '5A' });

      expect(prisma.event.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          status: {
            in: [
              EventStatuses.ON_VOTE,
              EventStatuses.ON_ADMIN_MODERATION,
              EventStatuses.FINALIZED,
              EventStatuses.DECLINED_BY_ADMIN,
            ],
          },
        },
        include: { ratings: { where: { raterId: otherPupil.id }, select: { stars: true } } },
        orderBy: { createdAt: 'desc' },
      });
      // No scope filter: a 5th-grader sees a CLASS event of 10A and an event of 11B.
      expect(result.map((e) => [e.id, e.myRating, e.ratingAverage, e.ratingsCount])).toEqual([
        ['event-1', 4, 4.33, 3],
        ['event-2', null, null, 0],
      ]);
    });

    it.each([['teacher', teacher], ['admin', admin]])('%s has no rating feed', async (_name, actor) => {
      await expect(service.findForRating(actor)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('every event response carries its rating', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent());
      const result = await service.findOne(admin, 'event-1');
      expect(prisma.eventRating.groupBy).toHaveBeenCalledWith({
        by: ['eventId'],
        where: { eventId: { in: ['event-1'] } },
        _avg: { stars: true },
        _count: { _all: true },
      });
      expect([result.ratingAverage, result.ratingsCount]).toEqual([4.33, 3]);
    });
  });
});
