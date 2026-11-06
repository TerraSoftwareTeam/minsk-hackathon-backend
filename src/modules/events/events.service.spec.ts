import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { EventWithUsers } from './event.mapper';
import { EventsService } from './events.service';

const user = (over: Partial<User>): User => ({
  id: 'x',
  schoolsById: null,
  name: 'N',
  surname: 'S',
  fathersName: 'F',
  class: null,
  role: UserRoles.PUPIL,
  ...over,
});

const pupil = user({ id: 'pupil-1', schoolsById: 'p1', class: '10A' });
const otherPupil = user({ id: 'pupil-2', schoolsById: 'p2', class: '10A' });
const teacher = user({ id: 'teacher-1', schoolsById: 't1', class: '10A', role: UserRoles.TEACHER });
const otherTeacher = user({ id: 'teacher-2', schoolsById: 't2', class: '11B', role: UserRoles.TEACHER });
const admin = user({ id: 'admin-1', role: UserRoles.ADMIN });

const storedEvent = (over: Partial<EventWithUsers> = {}): EventWithUsers => ({
  id: 'event-1',
  name: 'Trip',
  description: null,
  scope: Scopes.CLASS,
  status: EventStatuses.ON_MODERATION,
  declineReason: null,
  initiatorId: pupil.id,
  teacherId: teacher.id,
  initiator: pupil,
  teacher,
  createdAt: new Date('2026-11-06T10:00:00Z'),
  updatedAt: new Date('2026-11-06T10:00:00Z'),
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
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    service = new EventsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('pupil creates an ON_MODERATION event assigned to the teacher of their class', async () => {
      const result = await service.create(pupil, { name: 'Trip', scope: Scopes.GRADE });

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { role: UserRoles.TEACHER, class: '10A' },
        orderBy: { id: 'asc' },
      });
      expect(prisma.event.create.mock.calls[0][0].data).toEqual({
        name: 'Trip',
        description: undefined,
        scope: Scopes.GRADE,
        status: EventStatuses.ON_MODERATION,
        initiatorId: pupil.id,
        teacherId: teacher.id,
      });
      expect(result.initiator.id).toBe(pupil.id);
      expect(result.teacher.id).toBe(teacher.id);
    });

    it.each([
      ['teacher', teacher],
      ['admin', admin],
    ])('%s cannot create an event', async (_name, actor) => {
      await expect(service.create(actor, { name: 'Trip' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.event.create).not.toHaveBeenCalled();
    });

    it('BadRequest when the class has no teacher', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.create(pupil, { name: 'Trip' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.event.create).not.toHaveBeenCalled();
    });

    it('BadRequest when the pupil has no class', async () => {
      await expect(
        service.create({ ...pupil, class: null }, { name: 'Trip' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('Conflict on a duplicate name', async () => {
      prisma.event.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.create(pupil, { name: 'Trip' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('findForModeration', () => {
    it("returns the teacher's ON_MODERATION events, oldest first", async () => {
      const result = await service.findForModeration(teacher);

      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: { teacherId: teacher.id, status: EventStatuses.ON_MODERATION },
        include: { initiator: true, teacher: true },
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
        where: { id: 'event-1', teacherId: teacher.id, status: EventStatuses.ON_MODERATION },
        data: { status: EventStatuses.ON_VOTE },
      });
      expect(result.status).toBe(EventStatuses.ON_VOTE);
    });

    it('assigned teacher declines with a reason', async () => {
      await service.decline(teacher, 'event-1', { reason: 'Pick another date' });
      expect(prisma.event.updateMany.mock.calls[0][0].data).toEqual({
        status: EventStatuses.DECLINED,
        declineReason: 'Pick another date',
      });
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

    it('Conflict when a concurrent request moderated it first', async () => {
      prisma.event.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.approve(teacher, 'event-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('vote', () => {
    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(voteTarget(Scopes.SCHOOL));
    });

    const voteTarget = (scope: Scopes, initiatorClass: string | null = '10A') => ({
      status: EventStatuses.ON_VOTE,
      scope,
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
      expect(prisma.eventVote.create).not.toHaveBeenCalled();
    });

    it('pupil votes for an ON_VOTE event and gets the vote count', async () => {
      prisma.eventVote.count.mockResolvedValue(3);

      const result = await service.vote(otherPupil, 'event-1');

      expect(prisma.eventVote.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', voterId: otherPupil.id },
      });
      expect(result).toEqual({ eventId: 'event-1', votesCount: 3 });
    });

    it.each([
      ['teacher', teacher],
      ['admin', admin],
    ])('%s cannot vote', async (_name, actor) => {
      await expect(service.vote(actor, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.eventVote.create).not.toHaveBeenCalled();
    });

    it.each([
      EventStatuses.ON_MODERATION,
      EventStatuses.DECLINED,
      EventStatuses.FINALIZED,
    ])('Conflict when the event is %s', async (status) => {
      prisma.event.findUnique.mockResolvedValue({ ...voteTarget(Scopes.SCHOOL), status });
      await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.eventVote.create).not.toHaveBeenCalled();
    });

    it('404 for a missing event', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.vote(pupil, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('Conflict on a second vote by the same pupil', async () => {
      prisma.eventVote.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
