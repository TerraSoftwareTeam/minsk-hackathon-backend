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
  schoolsById: 'a1',
  name: 'N',
  surname: 'S',
  class: null,
  role: UserRoles.PUPIL,
  exp: 0,
  ...over,
});

const pupil = user({ id: 'pupil-1', schoolsById: 'p1', class: '10A' });
const otherPupil = user({ id: 'pupil-2', schoolsById: 'p2', class: '10A' });
const teacher = user({ id: 'teacher-1', schoolsById: 't1', class: '10A', role: UserRoles.TEACHER });
const coTeacher = user({ id: 'teacher-3', schoolsById: 't3', name: 'Co', class: '10A', role: UserRoles.TEACHER });
const otherTeacher = user({ id: 'teacher-2', schoolsById: 't2', class: '11B', role: UserRoles.TEACHER });
const admin = user({ id: 'admin-1', role: UserRoles.ADMIN });
const otherAdmin = user({ id: 'admin-2', schoolsById: 'a2', name: 'A2', role: UserRoles.ADMIN });
const ALL_USERS = [pupil, otherPupil, teacher, coTeacher, otherTeacher, admin, otherAdmin];

const asEventUser = (u: User) => ({ name: u.name, surname: u.surname });

const DAY_MS = 24 * 3600 * 1000;
const FUTURE = new Date(Date.now() + 7 * DAY_MS);
const PAST = new Date(Date.now() - 60 * 1000);
const RECENT = new Date(Date.now() - DAY_MS);
const OVERDUE = new Date(Date.now() - 31 * DAY_MS);
/** An event this soon is past its deadline (3 days before the date). */
const SOON = new Date(Date.now() + 2 * DAY_MS);

const BEFORE_DEADLINE = { startsAt: { gt: expect.any(Date) } };

const DATE = FUTURE.toISOString();

const WITH_USERS_INCLUDE = {
  initiator: true,
  image: { select: { url: true } },
  votes: { select: { voter: true }, orderBy: { createdAt: 'asc' } },
};

const voters = (count: number, first?: User) =>
  Array.from({ length: count }, (_, i) => ({
    voter: i === 0 && first ? first : user({ id: `voter-${i}`, schoolsById: `v${i}` }),
  }));

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
  createdByRole: UserRoles.PUPIL,
  initiator: pupil,
  createdAt: RECENT,
  updatedAt: RECENT,
  imageId: null,
  image: null,
  votes: [],
  ...over,
});

describe('EventsService', () => {
  let service: EventsService;
  let prisma: {
    user: { findMany: jest.Mock };
    event: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    eventVote: { create: jest.Mock; count: jest.Mock };
    eventLike: { groupBy: jest.Mock; createMany: jest.Mock; deleteMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };
  let images: { uploadImage: jest.Mock; deleteImage: jest.Mock };
  let notifier: {
    awaitsTeachers: jest.Mock;
    awaitsAdmin: jest.Mock;
    finalizedByVotes: jest.Mock;
    decisionMade: jest.Mock;
    participantsFinalized: jest.Mock;
    eventDeleted: jest.Mock;
  };
  let tx: {
    $queryRaw: jest.Mock;
    eventVote: { create: jest.Mock; count: jest.Mock; deleteMany: jest.Mock };
    event: { update: jest.Mock; updateMany: jest.Mock; findUniqueOrThrow: jest.Mock; delete: jest.Mock };
    user: { update: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn(({ where }: { where: { role: UserRoles; class?: { in: string[] } } }) =>
          Promise.resolve(
            ALL_USERS.filter(
              (u) => u.role === where.role && (!where.class || where.class.in.includes(u.class!)),
            ),
          ),
        ),
      },
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
      eventLike: {
        groupBy: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ status: EventStatuses.ON_VOTE, voteThreshold: 10, createdAt: RECENT }]),
      eventVote: {
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      event: {
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        // Moderation updates the status in a transaction: the same mock as outside it.
        updateMany: prisma.event.updateMany,
        // Who gets exp when the event is FINALIZED: the pupil author voted too.
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          initiatorId: pupil.id,
          initiator: { role: UserRoles.PUPIL },
          votes: [{ voterId: pupil.id }, { voterId: otherPupil.id }],
        }),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    images = {
      uploadImage: jest.fn().mockResolvedValue({ id: 'img-new', url: 'https://cdn/new.jpg' }),
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };
    notifier = {
      awaitsTeachers: jest.fn(),
      awaitsAdmin: jest.fn(),
      finalizedByVotes: jest.fn(),
      decisionMade: jest.fn(),
      participantsFinalized: jest.fn(),
      eventDeleted: jest.fn(),
    };
    service = new EventsService(
      prisma as unknown as PrismaService,
      images as unknown as ImagesService,
      notifier as unknown as EventModerationNotifier,
    );
  });

  describe('create', () => {
    it('pupil creates an ON_MODERATION event moderated by every teacher of their class', async () => {
      const result = await service.create(pupil, {
        name: 'Trip',
        scope: Scopes.GRADE,
        voteThreshold: 10,
        category: EventCategories.SPORTS,
        startsAt: DATE,
      });

      expect(prisma.event.create.mock.calls[0][0].data).toEqual({
        name: 'Trip',
        description: undefined,
        scope: Scopes.GRADE,
        category: EventCategories.SPORTS,
        voteThreshold: 10,
        status: EventStatuses.ON_MODERATION,
        startsAt: FUTURE,
        initiatorId: pupil.id,
        createdByRole: UserRoles.PUPIL,
        votes: { create: { voterId: pupil.id } },
      });
      expect(result.initiator).toEqual(asEventUser(pupil));
      expect(result.moderators).toEqual([asEventUser(teacher), asEventUser(coTeacher)]);
      expect(notifier.awaitsTeachers).toHaveBeenCalledWith(storedEvent());
    });

    it('the pupil organizer is listed among the voters like any participant', async () => {
      prisma.event.create.mockResolvedValue(storedEvent({ votes: [{ voter: pupil }] }));

      const result = await service.create(pupil, { name: 'Trip', voteThreshold: 10, category: EventCategories.SPORTS, startsAt: DATE });

      expect(result.voters).toEqual([asEventUser(pupil)]);
      expect(result.votesCount).toBe(1);
    });

    it('BadRequest, nothing created, for a pupil event with voteThreshold 1', async () => {
      await expect(
        service.create(pupil, { name: 'Trip', voteThreshold: 1, category: EventCategories.SPORTS, startsAt: DATE }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.event.create).not.toHaveBeenCalled();
    });

    it('a teacher is not a participant of their event, voteThreshold 1 is fine', async () => {
      await service.create(teacher, { name: 'Trip', voteThreshold: 1, category: EventCategories.SPORTS, startsAt: DATE });
      expect(prisma.event.create.mock.calls[0][0].data).not.toHaveProperty('votes');
    });

    describe('school event of a teacher', () => {
      beforeEach(() => {
        prisma.event.create.mockResolvedValue(
          storedEvent({
            status: EventStatuses.ON_VOTE,
            initiatorId: teacher.id,
            initiator: teacher,
            createdByRole: UserRoles.TEACHER,
          }),
        );
      });

      it('skips the teacher moderation: ON_VOTE at once, scope and date chosen by the teacher', async () => {
        const result = await service.create(teacher, {
          name: 'Trip',
          scope: Scopes.GRADE,
          voteThreshold: 10,
          category: EventCategories.SPORTS,
          startsAt: DATE,
        });

        expect(prisma.event.create.mock.calls[0][0].data).toEqual({
          name: 'Trip',
          description: undefined,
          scope: Scopes.GRADE,
          category: EventCategories.SPORTS,
          voteThreshold: 10,
          status: EventStatuses.ON_VOTE,
          startsAt: FUTURE,
          initiatorId: teacher.id,
          createdByRole: UserRoles.TEACHER,
        });
        expect(result.status).toBe(EventStatuses.ON_VOTE);
        expect(result.createdByRole).toBe(UserRoles.TEACHER);
        expect(result.moderators).toEqual([]);
        expect(result.startsAt).toEqual(FUTURE);
        expect(result.votingClosesAt.getTime()).toBe(FUTURE.getTime() - 3 * DAY_MS);
        expect(notifier.awaitsTeachers).not.toHaveBeenCalled();
      });

      it.each([
        ['without a date', { startsAt: undefined as unknown as string }],
        ['with a past date', { startsAt: PAST.toISOString() }],
      ])('BadRequest, nothing created, %s', async (_, over) => {
        await expect(
          service.create(teacher, {
            name: 'Trip',
            voteThreshold: 10,
            category: EventCategories.SPORTS,
            ...over,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.event.create).not.toHaveBeenCalled();
      });

      it('BadRequest when the teacher has no class', async () => {
        await expect(
          service.create(
            { ...teacher, class: null },
            { name: 'Trip', voteThreshold: 10, category: EventCategories.SPORTS, startsAt: DATE },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('school event of an admin', () => {
      const adminEvent = (over: Partial<EventWithUsers> = {}) =>
        storedEvent({
          scope: Scopes.SCHOOL,
          status: EventStatuses.ON_VOTE,
          startsAt: FUTURE,
          initiatorId: admin.id,
          initiator: admin,
          createdByRole: UserRoles.ADMIN,
          ...over,
        });

      beforeEach(() => {
        prisma.event.create.mockResolvedValue(adminEvent());
      });

      it('no moderation: SCHOOL, ON_VOTE, with the date; voting closes 3 days before it', async () => {
        const result = await service.create(admin, {
          name: 'Trip',
          voteThreshold: 10,
          category: EventCategories.SPORTS,
          startsAt: FUTURE.toISOString(),
        });

        expect(prisma.event.create.mock.calls[0][0].data).toEqual({
          name: 'Trip',
          description: undefined,
          scope: Scopes.SCHOOL,
          category: EventCategories.SPORTS,
          voteThreshold: 10,
          status: EventStatuses.ON_VOTE,
          startsAt: FUTURE,
          initiatorId: admin.id,
          createdByRole: UserRoles.ADMIN,
        });
        expect(result.startsAt).toEqual(FUTURE);
        expect(result.votingClosesAt.getTime()).toBe(FUTURE.getTime() - 3 * DAY_MS);
        expect(result.moderators).toEqual([]);
        expect(notifier.awaitsTeachers).not.toHaveBeenCalled();
      });

      it('an explicit SCHOOL scope is accepted', async () => {
        await service.create(admin, {
          name: 'Trip',
          scope: Scopes.SCHOOL,
          voteThreshold: 10,
          category: EventCategories.SPORTS,
          startsAt: FUTURE.toISOString(),
        });
        expect(prisma.event.create.mock.calls[0][0].data.scope).toBe(Scopes.SCHOOL);
      });

      it.each([
        ['without a date', { startsAt: undefined as unknown as string }],
        ['with a past date', { startsAt: PAST.toISOString() }],
        ['with a CLASS scope', { scope: Scopes.CLASS }],
        ['with a GRADE scope', { scope: Scopes.GRADE }],
      ])('BadRequest, nothing created, %s', async (_name, over) => {
        await expect(
          service.create(admin, {
            name: 'Trip',
            voteThreshold: 10,
            category: EventCategories.SPORTS,
            startsAt: FUTURE.toISOString(),
            ...over,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.event.create).not.toHaveBeenCalled();
      });
    });

    it.each([
      ['without a date', { startsAt: undefined as unknown as string }],
      ['with a past date', { startsAt: PAST.toISOString() }],
    ])('BadRequest, nothing created, for a pupil event %s', async (_, over) => {
      await expect(
        service.create(pupil, {
          name: 'Trip',
          voteThreshold: 10,
          category: EventCategories.SPORTS,
          ...over,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.event.create).not.toHaveBeenCalled();
    });

    it('class without a teacher: no moderators until one registers', async () => {
      prisma.event.findUnique.mockResolvedValue(
        storedEvent({ initiator: { ...pupil, class: '9A' } }),
      );
      await expect(service.findOne(admin, 'event-1')).resolves.toMatchObject({ moderators: [] });
    });

    it('BadRequest when the pupil has no class', async () => {
      await expect(
        service.create({ ...pupil, class: null }, { name: 'Trip', voteThreshold: 10, category: EventCategories.SPORTS, startsAt: DATE }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('the pupil chooses the date; voting closes 3 days before it', async () => {
      const result = await service.create(pupil, {
        name: 'Trip',
        voteThreshold: 10,
        category: EventCategories.SPORTS,
        startsAt: DATE,
      });
      expect(prisma.event.create.mock.calls[0][0].data.startsAt).toEqual(FUTURE);
      expect(result.startsAt).toEqual(FUTURE);
      expect(result.votingClosesAt.getTime()).toBe(FUTURE.getTime() - 3 * DAY_MS);
    });

    it('Conflict on a duplicate name', async () => {
      prisma.event.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.create(pupil, { name: 'Trip', voteThreshold: 10, category: EventCategories.SPORTS, startsAt: DATE })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('findForModeration', () => {
    it("returns the teacher's ON_MODERATION events, oldest first", async () => {
      const result = await service.findForModeration(teacher);

      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: {
          initiator: { class: '10A' },
          status: EventStatuses.ON_MODERATION,
          ...BEFORE_DEADLINE,
        },
        include: WITH_USERS_INCLUDE,
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('is teacher-only', async () => {
      await expect(service.findForModeration(pupil)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('moderators', () => {
    it('ON_MODERATION: every teacher of the author\'s class, not of other classes', async () => {
      const result = await service.findOne(admin, 'event-1');
      expect(result.moderators).toEqual([asEventUser(teacher), asEventUser(coTeacher)]);
    });

    it('ON_ADMIN_MODERATION: every admin', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status: EventStatuses.ON_ADMIN_MODERATION }));
      const result = await service.findOne(admin, 'event-1');
      expect(result.moderators).toEqual([asEventUser(admin), asEventUser(otherAdmin)]);
    });

    it.each([
      EventStatuses.ON_VOTE,
      EventStatuses.DECLINED,
      EventStatuses.FINALIZED,
      EventStatuses.DECLINED_BY_ADMIN,
      EventStatuses.EXPIRED,
    ])('%s: nobody', async (status) => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status }));
      const result = await service.findOne(admin, 'event-1');
      expect(result.moderators).toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('a list loads the teachers of all the classes and the admins once', async () => {
      prisma.event.findMany.mockResolvedValueOnce([
        storedEvent(),
        storedEvent({ id: 'e2', initiator: { ...pupil, class: '11B' } }),
        storedEvent({ id: 'e3', status: EventStatuses.ON_ADMIN_MODERATION }),
      ]);
      prisma.event.findMany.mockResolvedValue([]);

      const result = await service.findForModeration(teacher);

      expect(result.map((event) => event.moderators)).toEqual([
        [asEventUser(teacher), asEventUser(coTeacher)],
        [asEventUser(otherTeacher)],
        [asEventUser(admin), asEventUser(otherAdmin)],
      ]);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('findOne', () => {
    it.each([
      ['initiator', pupil],
      ['teacher of the class', teacher],
      ['another teacher of the class', coTeacher],
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
    it.each([
      ['a teacher of the class', teacher],
      ['another teacher of the class', coTeacher],
    ])('%s approves: ON_MODERATION -> ON_VOTE', async (_name, actor) => {
      prisma.event.findUnique
        .mockResolvedValueOnce(storedEvent())
        .mockResolvedValueOnce(storedEvent({ status: EventStatuses.ON_VOTE }));

      const result = await service.approve(actor, 'event-1');

      expect(prisma.event.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'event-1',
          status: EventStatuses.ON_MODERATION,
          ...BEFORE_DEADLINE,
        },
        data: { status: EventStatuses.ON_VOTE },
      });
      expect(result.status).toBe(EventStatuses.ON_VOTE);
      expect(notifier.decisionMade).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'event-1', initiatorId: pupil.id }),
        EventStatuses.ON_VOTE,
        null,
        0,
      );
    });

    it('a teacher of the class declines with a reason', async () => {
      await service.decline(teacher, 'event-1', { reason: 'Pick another date' });
      expect(prisma.event.updateMany.mock.calls[0][0].data).toEqual({
        status: EventStatuses.DECLINED,
        declineReason: 'Pick another date',
      });
      expect(notifier.decisionMade).toHaveBeenCalledWith(
        expect.objectContaining({ initiatorId: pupil.id }),
        EventStatuses.DECLINED,
        'Pick another date',
        0,
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

    it('still moderated a month after the creation, while its date is more than 3 days away', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ createdAt: OVERDUE }));
      await service.approve(teacher, 'event-1');
      await service.decline(teacher, 'event-1', {});
      expect(prisma.event.updateMany).toHaveBeenCalledTimes(2);
    });

    it('Conflict, nothing changed, 3 days before the date', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ startsAt: SOON }));
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

  describe('voters in every event response', () => {
    it('lists every voter in vote order; every user of the event has only name and surname', async () => {
      prisma.event.findUnique.mockResolvedValue(
        storedEvent({ status: EventStatuses.ON_VOTE, votes: voters(2, otherPupil) }),
      );

      const result = await service.findOne(teacher, 'event-1');

      expect(result.votesCount).toBe(2);
      expect(result.voters).toEqual([
        { name: otherPupil.name, surname: otherPupil.surname },
        { name: 'N', surname: 'S' },
      ]);
      expect(result.initiator).toEqual({ name: pupil.name, surname: pupil.surname });
      expect(result.moderators).toEqual([]);
    });
  });

  describe('findMine', () => {
    it("returns the author's events in any status, newest first, with vote counts", async () => {
      prisma.event.findMany.mockResolvedValue([
        {
          ...storedEvent({ id: 'e2', status: EventStatuses.DECLINED }),
          likes: [],
        },
        {
          ...storedEvent({ id: 'e1', status: EventStatuses.ON_VOTE, votes: voters(4, pupil) }),
          likes: [{ userId: pupil.id }],
        },
      ]);

      const result = await service.findMine(pupil);

      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: { initiatorId: pupil.id },
        include: {
          ...WITH_USERS_INCLUDE,
          likes: { where: { userId: pupil.id }, select: { userId: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result.map((e) => [e.id, e.status, e.votesCount])).toEqual([
        ['e2', EventStatuses.DECLINED, 0],
        ['e1', EventStatuses.ON_VOTE, 4],
      ]);
      expect(result.map((e) => e.hasVoted)).toEqual([false, true]);
      expect(result.map((e) => e.likedByMe)).toEqual([false, true]);
      expect(result[1].voters).toHaveLength(4);
      expect(result[1].voters[0]).toEqual({ name: pupil.name, surname: pupil.surname });
    });

    it.each([
      ['teacher', teacher],
      ['admin', admin],
    ])('%s has an own events list too: staff create school events', async (_name, actor) => {
      prisma.event.findMany.mockResolvedValue([]);
      await expect(service.findMine(actor)).resolves.toEqual([]);
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { initiatorId: actor.id } }),
      );
    });
  });

  describe('findForVoting', () => {
    const votingEvent = (
      id: string,
      scope: Scopes,
      initiatorClass: string,
      over: { votesCount?: number; votedByMe?: boolean; liked?: boolean } = {},
    ) => ({
      ...storedEvent({
        id,
        scope,
        status: EventStatuses.ON_VOTE,
        initiator: { ...otherPupil, class: initiatorClass },
        votes: voters(over.votesCount ?? 0, over.votedByMe ? pupil : undefined),
      }),
      likes: over.liked ? [{ userId: pupil.id }] : [],
    });

    it('queries ON_VOTE events of the pupil scope with their vote state, newest first', async () => {
      prisma.event.findMany.mockResolvedValue([]);

      await service.findForVoting(pupil);

      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: {
          status: EventStatuses.ON_VOTE,
          AND: [
            BEFORE_DEADLINE,
            {
              OR: [
                { scope: Scopes.SCHOOL },
                { scope: Scopes.GRADE },
                { scope: Scopes.CLASS, initiator: { class: '10A' } },
              ],
            },
          ],
        },
        include: {
          ...WITH_USERS_INCLUDE,
          likes: { where: { userId: pupil.id }, select: { userId: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('keeps only GRADE events of the same grade and maps the vote state', async () => {
      prisma.event.findMany.mockResolvedValue([
        votingEvent('school', Scopes.SCHOOL, '5A'),
        votingEvent('grade-same', Scopes.GRADE, '10Б', {
          votesCount: 7,
          votedByMe: true,
          liked: true,
        }),
        votingEvent('grade-other', Scopes.GRADE, '11A'),
        votingEvent('grade-prefix', Scopes.GRADE, '1A'),
        votingEvent('class-same', Scopes.CLASS, '10A'),
      ]);

      const result = await service.findForVoting(pupil);

      expect(result.map((e) => e.id)).toEqual(['school', 'grade-same', 'class-same']);
      expect(result[1]).toMatchObject({ votesCount: 7, hasVoted: true, likedByMe: true });
      expect(result[0]).toMatchObject({ votesCount: 0, hasVoted: false, likedByMe: false });
      expect(result[0]).not.toHaveProperty('votes');
      expect(result[0]).not.toHaveProperty('likes');
      expect(result[0]).not.toHaveProperty('_count');
    });

    it('hasVoted is false when only other pupils voted', async () => {
      prisma.event.findMany.mockResolvedValue([
        votingEvent('school', Scopes.SCHOOL, '5A', { votesCount: 3 }),
      ]);

      const [event] = await service.findForVoting(pupil);

      expect(event).toMatchObject({ votesCount: 3, hasVoted: false });
      expect(event.voters).toHaveLength(3);
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
    const onAdminModeration = (over: Partial<EventWithUsers> = {}) =>
      storedEvent({ status: EventStatuses.ON_ADMIN_MODERATION, ...over });

    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(onAdminModeration());
    });

    it('lists ON_ADMIN_MODERATION events of all classes, oldest first', async () => {
      await service.findForAdminModeration(admin);

      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: { status: EventStatuses.ON_ADMIN_MODERATION, ...BEFORE_DEADLINE },
        include: WITH_USERS_INCLUDE,
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

    const teacherEventOnAdminModeration = (over: Partial<EventWithUsers> = {}) =>
      storedEvent({
        status: EventStatuses.ON_ADMIN_MODERATION,
        initiatorId: teacher.id,
        initiator: teacher,
        createdByRole: UserRoles.TEACHER,
        ...over,
      });

    it("admin approves, the author's date stays: ON_ADMIN_MODERATION -> FINALIZED", async () => {
      prisma.event.findUnique
        .mockResolvedValueOnce(onAdminModeration())
        .mockResolvedValueOnce(storedEvent({ status: EventStatuses.FINALIZED }));

      const result = await service.adminApprove(admin, 'event-1');

      expect(prisma.event.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'event-1',
          status: EventStatuses.ON_ADMIN_MODERATION,
          ...BEFORE_DEADLINE,
        },
        data: { status: EventStatuses.FINALIZED },
      });
      expect(result.status).toBe(EventStatuses.FINALIZED);
      expect(result.startsAt).toEqual(FUTURE);
      expect(notifier.decisionMade).toHaveBeenCalledWith(
        expect.objectContaining({ initiatorId: pupil.id }),
        EventStatuses.FINALIZED,
        null,
        25,
      );
    });

    it('FINALIZED: the pupil author gets 25 exp, every other voter 5 exp, and the voters are pushed', async () => {
      prisma.event.findUnique
        .mockResolvedValueOnce(onAdminModeration())
        .mockResolvedValueOnce(storedEvent({ status: EventStatuses.FINALIZED, startsAt: FUTURE }));

      await service.adminApprove(admin, 'event-1');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: pupil.id },
        data: { exp: { increment: 25 } },
      });
      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [otherPupil.id] } },
        data: { exp: { increment: 5 } },
      });
      expect(notifier.participantsFinalized).toHaveBeenCalledWith(
        { id: 'event-1', name: 'Trip', startsAt: FUTURE },
        [otherPupil.id],
      );
    });

    it("admin approves a teacher's event, the teacher's date stays", async () => {
      prisma.event.findUnique
        .mockResolvedValueOnce(teacherEventOnAdminModeration())
        .mockResolvedValueOnce(teacherEventOnAdminModeration({ status: EventStatuses.FINALIZED }));

      const result = await service.adminApprove(admin, 'event-1');

      expect(prisma.event.updateMany.mock.calls[0][0].data).toEqual({ status: EventStatuses.FINALIZED });
      expect(result.startsAt).toEqual(FUTURE);
    });

    it("FINALIZED teacher's event: no exp for the teacher, the voters still get theirs", async () => {
      prisma.event.findUnique.mockResolvedValue(teacherEventOnAdminModeration());
      tx.event.findUniqueOrThrow.mockResolvedValue({
        initiatorId: teacher.id,
        initiator: { role: UserRoles.TEACHER },
        votes: [{ voterId: pupil.id }],
      });

      await service.adminApprove(admin, 'event-1');

      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.user.updateMany.mock.calls[0][0].where).toEqual({ id: { in: [pupil.id] } });
      expect(notifier.decisionMade).toHaveBeenCalledWith(
        expect.objectContaining({ initiatorId: teacher.id }),
        EventStatuses.FINALIZED,
        null,
        0,
      );
      expect(notifier.participantsFinalized).toHaveBeenCalledWith(expect.anything(), [pupil.id]);
    });

    it('no exp and no participant push when the event is declined or the approval lost a race', async () => {
      await service.adminDecline(admin, 'event-1', {});
      prisma.event.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.adminApprove(admin, 'event-1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(tx.event.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.user.updateMany).not.toHaveBeenCalled();
      expect(notifier.participantsFinalized).not.toHaveBeenCalled();
    });

    it("a teacher's event: the admin decision goes to the teacher who created it", async () => {
      const teacherEvent = (over: Partial<EventWithUsers> = {}) =>
        storedEvent({
          status: EventStatuses.ON_ADMIN_MODERATION,
          initiatorId: teacher.id,
          initiator: teacher,
          createdByRole: UserRoles.TEACHER,
          ...over,
        });
      prisma.event.findUnique
        .mockResolvedValueOnce(teacherEvent())
        .mockResolvedValueOnce(teacherEvent({ status: EventStatuses.DECLINED_BY_ADMIN, declineReason: 'No budget' }));

      await service.adminDecline(admin, 'event-1', { reason: 'No budget' });

      expect(notifier.decisionMade).toHaveBeenCalledWith(
        expect.objectContaining({ initiatorId: teacher.id }),
        EventStatuses.DECLINED_BY_ADMIN,
        'No budget',
        0,
      );
    });

    it('admin declines with a reason: -> DECLINED_BY_ADMIN', async () => {
      await service.adminDecline(admin, 'event-1', { reason: 'Not this term' });
      expect(prisma.event.updateMany.mock.calls[0][0].data).toEqual({
        status: EventStatuses.DECLINED_BY_ADMIN,
        declineReason: 'Not this term',
      });
      expect(prisma.event.updateMany.mock.calls[0][0].data).not.toHaveProperty('startsAt');
      expect(notifier.decisionMade).toHaveBeenCalledWith(
        expect.objectContaining({ initiatorId: pupil.id }),
        EventStatuses.DECLINED_BY_ADMIN,
        'Not this term',
        0,
      );
    });

    it('admin decline without a reason stores null', async () => {
      await service.adminDecline(admin, 'event-1', {});
      expect(prisma.event.updateMany.mock.calls[0][0].data.declineReason).toBeNull();
    });

    it.each([
      ['teacher of the class', teacher],
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

    it('still moderated a month after the creation, while the date is more than 3 days away', async () => {
      prisma.event.findUnique.mockResolvedValue(teacherEventOnAdminModeration({ createdAt: OVERDUE }));
      await service.adminApprove(admin, 'event-1');
      await service.adminDecline(admin, 'event-1', {});
      expect(prisma.event.updateMany).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['pupil', onAdminModeration],
      ['teacher', teacherEventOnAdminModeration],
    ])('Conflict, nothing changed, 3 days before the date of a %s event', async (_, event) => {
      prisma.event.findUnique.mockResolvedValue(event({ startsAt: SOON }));
      await expect(service.adminApprove(admin, 'event-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.adminDecline(admin, 'event-1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.event.updateMany).not.toHaveBeenCalled();
    });

    it('Conflict when a concurrent admin decided first', async () => {
      prisma.event.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.adminDecline(admin, 'event-1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('vote', () => {
    it('Conflict, no transaction, when the organizer votes for their own event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        status: EventStatuses.ON_VOTE,
        scope: Scopes.CLASS,
        createdByRole: UserRoles.PUPIL,
        createdAt: RECENT,
        startsAt: null,
        initiatorId: pupil.id,
        initiator: { class: '10A' },
      });

      await expect(service.vote(pupil, 'event-1')).rejects.toThrow(/organizer/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue(voteTarget(Scopes.SCHOOL));
    });

    const voteTarget = (scope: Scopes, initiatorClass: string | null = '10A') => ({
      status: EventStatuses.ON_VOTE,
      scope,
      createdByRole: UserRoles.PUPIL,
      createdAt: RECENT,
      startsAt: FUTURE,
      initiator: { class: initiatorClass },
    });

    describe('school event of an admin', () => {
      const adminTarget = (startsAt: Date) => ({
        status: EventStatuses.ON_VOTE,
        scope: Scopes.SCHOOL,
        createdByRole: UserRoles.ADMIN,
        createdAt: OVERDUE,
        startsAt,
        initiator: { class: null },
      });
      const lockedAdminEvent = (startsAt: Date, voteThreshold = 10) => [
        { status: EventStatuses.ON_VOTE, voteThreshold, createdByRole: UserRoles.ADMIN, createdAt: OVERDUE, startsAt },
      ];

      it('voting stays open until 3 days before the date, even more than a month after the creation', async () => {
        prisma.event.findUnique.mockResolvedValue(adminTarget(FUTURE));
        tx.$queryRaw.mockResolvedValue(lockedAdminEvent(FUTURE));
        tx.eventVote.count.mockResolvedValue(3);

        await expect(service.vote(pupil, 'event-1')).resolves.toMatchObject({
          status: EventStatuses.ON_VOTE,
          votesCount: 3,
        });
      });

      it('the vote that reaches the threshold finalizes it: no admin moderation', async () => {
        prisma.event.findUnique.mockResolvedValue(adminTarget(FUTURE));
        tx.$queryRaw.mockResolvedValue(lockedAdminEvent(FUTURE));
        tx.eventVote.count.mockResolvedValue(10);

        const result = await service.vote(pupil, 'event-1');

        expect(tx.event.update).toHaveBeenCalledWith({
          where: { id: 'event-1' },
          data: { status: EventStatuses.FINALIZED },
        });
        expect(result.status).toBe(EventStatuses.FINALIZED);
        expect(notifier.awaitsAdmin).not.toHaveBeenCalled();
        expect(tx.user.update).toHaveBeenCalledWith({
          where: { id: pupil.id },
          data: { exp: { increment: 25 } },
        });
        expect(tx.user.updateMany).toHaveBeenCalledWith({
          where: { id: { in: [otherPupil.id] } },
          data: { exp: { increment: 5 } },
        });
        expect(notifier.finalizedByVotes).toHaveBeenCalledWith('event-1', [otherPupil.id]);
      });

      it('Conflict, no vote stored, 3 days before the date', async () => {
        prisma.event.findUnique.mockResolvedValue(adminTarget(SOON));

        await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('Conflict, no vote stored, when the date came after the pre-check', async () => {
        prisma.event.findUnique.mockResolvedValue(adminTarget(FUTURE));
        tx.$queryRaw.mockResolvedValue(lockedAdminEvent(PAST));

        await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
        expect(tx.eventVote.create).not.toHaveBeenCalled();
      });
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
      expect(notifier.finalizedByVotes).not.toHaveBeenCalled();
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
      expect(notifier.finalizedByVotes).not.toHaveBeenCalled();
    });

    it('threshold 1: the first vote already moves the event', async () => {
      tx.$queryRaw.mockResolvedValue([
        { status: EventStatuses.ON_VOTE, voteThreshold: 1, createdAt: RECENT },
      ]);
      tx.eventVote.count.mockResolvedValue(1);

      const result = await service.vote(pupil, 'event-1');

      expect(result.status).toBe(EventStatuses.ON_ADMIN_MODERATION);
    });

    it('Conflict, no vote stored, when voting has closed (3 days before the date)', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...voteTarget(Scopes.SCHOOL),
        startsAt: SOON,
      });

      await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('Conflict, no vote stored, when voting closed after the pre-check', async () => {
      tx.$queryRaw.mockResolvedValue([
        { status: EventStatuses.ON_VOTE, voteThreshold: 10, createdByRole: UserRoles.PUPIL, createdAt: RECENT, startsAt: SOON },
      ]);

      await expect(service.vote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.eventVote.create).not.toHaveBeenCalled();
    });

    it('Conflict, no vote stored, when the event left ON_VOTE after the pre-check', async () => {
      tx.$queryRaw.mockResolvedValue([
        { status: EventStatuses.ON_ADMIN_MODERATION, voteThreshold: 10, createdAt: RECENT },
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
    it('expires every pending event 3 days before its date, whoever created it', async () => {
      prisma.event.updateMany.mockResolvedValue({ count: 2 });
      const now = new Date('2026-12-01T10:00:00Z');

      await expect(service.expireOverdue(now)).resolves.toBe(2);
      expect(prisma.event.updateMany).toHaveBeenCalledWith({
        where: {
          status: {
            in: [
              EventStatuses.ON_MODERATION,
              EventStatuses.ON_VOTE,
              EventStatuses.ON_ADMIN_MODERATION,
            ],
          },
          startsAt: { lte: new Date('2026-12-04T10:00:00Z') },
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

    it('preview loads only FINALIZED events with a date of the category', async () => {
      prisma.event.findMany.mockResolvedValue(history(5, EventStatuses.FINALIZED));

      await expect(service.previewProbability(EventCategories.SPORTS, SAT_NOON)).resolves.toBe(0.9);
      expect(prisma.event.findMany).toHaveBeenCalledWith({
        where: {
          category: { in: [EventCategories.SPORTS] },
          status: EventStatuses.FINALIZED,
          startsAt: { not: null },
        },
        select: { id: true, category: true, startsAt: true, status: true },
      });
    });

    it('preview without a start time does not compare the time', async () => {
      const evening = history(5, EventStatuses.FINALIZED).map((e) => ({
        ...e,
        startsAt: new Date(e.startsAt.getTime() + 8 * 3600 * 1000),
      }));
      prisma.event.findMany.mockResolvedValue(evening);

      await expect(service.previewProbability(EventCategories.SPORTS, null)).resolves.toBe(0.9);
      await expect(service.previewProbability(EventCategories.SPORTS, SAT_NOON)).resolves.toBeLessThan(0.6);
    });

    it('recomputes on every request: a changed history changes the probability', async () => {
      prisma.event.findMany.mockResolvedValueOnce(history(5, EventStatuses.FINALIZED));
      await expect(service.previewProbability(EventCategories.SPORTS, SAT_NOON)).resolves.toBe(0.9);

      prisma.event.findMany.mockResolvedValueOnce(history(1, EventStatuses.FINALIZED));
      await expect(service.previewProbability(EventCategories.SPORTS, SAT_NOON)).resolves.toBe(0.58);
    });

    it('event responses carry the probability', async () => {
      prisma.event.findUnique.mockResolvedValue(
        storedEvent({ status: EventStatuses.FINALIZED, startsAt: SAT_NOON }),
      );
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
        likes: [],
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
    const lockedRow = (over: Partial<{ status: EventStatuses; createdAt: Date; imageId: string | null }> = {}) => [
      { status: EventStatuses.ON_MODERATION, createdAt: RECENT, imageId: null, ...over },
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
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status: EventStatuses.ON_VOTE, startsAt: SOON }));
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

  describe('remove', () => {
    const lockedRow = (over: Partial<{ status: EventStatuses; createdAt: Date; imageId: string | null }> = {}) => [
      { status: EventStatuses.ON_MODERATION, createdByRole: UserRoles.PUPIL, createdAt: RECENT, startsAt: null, imageId: null, ...over },
    ];
    const pending = [EventStatuses.ON_MODERATION, EventStatuses.ON_VOTE, EventStatuses.ON_ADMIN_MODERATION];
    const decided = [EventStatuses.FINALIZED, EventStatuses.DECLINED, EventStatuses.DECLINED_BY_ADMIN, EventStatuses.EXPIRED];

    it.each(pending)('the author deletes the event while it is %s, nobody is pushed', async (status) => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status }));
      tx.$queryRaw.mockResolvedValue(lockedRow({ status }));

      await expect(service.remove(pupil, 'event-1')).resolves.toBeUndefined();

      expect(tx.event.delete).toHaveBeenCalledWith({ where: { id: 'event-1' } });
      expect(images.deleteImage).not.toHaveBeenCalled();
      expect(notifier.eventDeleted).not.toHaveBeenCalled();
    });

    it('the image of the deleted event is discarded', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ imageId: 'img-old' }));
      tx.$queryRaw.mockResolvedValue(lockedRow({ imageId: 'img-old' }));

      await service.remove(pupil, 'event-1');

      expect(images.deleteImage).toHaveBeenCalledWith('img-old');
    });

    it.each([
      ['a teacher of the class', teacher],
      ['another teacher of the class', coTeacher],
    ])("%s deletes a pupil's pending event, the author is pushed", async (_name, actor) => {
      tx.$queryRaw.mockResolvedValue(lockedRow());

      await service.remove(actor, 'event-1');

      expect(tx.event.delete).toHaveBeenCalled();
      expect(notifier.eventDeleted).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'event-1', name: 'Trip', initiatorId: pupil.id }),
        UserRoles.TEACHER,
      );
    });

    it.each([...pending, ...decided])('an admin deletes the event even when it is %s', async (status) => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status, createdAt: OVERDUE }));
      tx.$queryRaw.mockResolvedValue(lockedRow({ status, createdAt: OVERDUE }));

      await service.remove(admin, 'event-1');

      expect(tx.event.delete).toHaveBeenCalled();
      expect(notifier.eventDeleted).toHaveBeenCalledWith(
        expect.objectContaining({ initiatorId: pupil.id }),
        UserRoles.ADMIN,
      );
    });

    it('an admin deleting their own event is not pushed', async () => {
      prisma.event.findUnique.mockResolvedValue(
        storedEvent({ initiatorId: admin.id, initiator: admin, createdByRole: UserRoles.ADMIN, status: EventStatuses.ON_VOTE, startsAt: FUTURE }),
      );
      tx.$queryRaw.mockResolvedValue(lockedRow({ status: EventStatuses.ON_VOTE }));

      await service.remove(admin, 'event-1');

      expect(tx.event.delete).toHaveBeenCalled();
      expect(notifier.eventDeleted).not.toHaveBeenCalled();
    });

    it.each([
      ['a classmate', otherPupil],
      ['a teacher of another class', otherTeacher],
    ])('Forbidden for %s, nothing deleted', async (_name, actor) => {
      await expect(service.remove(actor, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("Forbidden for a teacher of the class to delete another teacher's event", async () => {
      prisma.event.findUnique.mockResolvedValue(
        storedEvent({ initiatorId: teacher.id, initiator: teacher, createdByRole: UserRoles.TEACHER, status: EventStatuses.ON_VOTE }),
      );
      await expect(service.remove(coTeacher, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove(teacher, 'event-1')).resolves.toBeUndefined();
    });

    it.each(decided)('Conflict for the author once the event is %s, nothing deleted', async (status) => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status }));
      await expect(service.remove(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.remove(teacher, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.event.delete).not.toHaveBeenCalled();
    });

    it('Conflict for the author past the deadline, nothing deleted', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent({ status: EventStatuses.ON_VOTE, startsAt: SOON }));
      await expect(service.remove(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.event.delete).not.toHaveBeenCalled();
    });

    it('Conflict, nothing deleted, when the event was decided after the pre-check', async () => {
      tx.$queryRaw.mockResolvedValue(lockedRow({ status: EventStatuses.FINALIZED }));
      await expect(service.remove(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.event.delete).not.toHaveBeenCalled();
      expect(notifier.eventDeleted).not.toHaveBeenCalled();
    });

    it('404 for a missing event', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.remove(admin, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unvote', () => {
    it('Conflict, no vote removed, when the organizer tries to leave their event', async () => {
      tx.$queryRaw.mockResolvedValue([
        { status: EventStatuses.ON_VOTE, voteThreshold: 10, initiatorId: pupil.id, createdAt: RECENT },
      ]);

      await expect(service.unvote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.eventVote.deleteMany).not.toHaveBeenCalled();
    });

    it('pupil takes the vote back and gets the new count', async () => {
      tx.eventVote.count.mockResolvedValue(4);

      const result = await service.unvote(pupil, 'event-1');

      expect(tx.eventVote.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', voterId: pupil.id },
      });
      expect(tx.event.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        eventId: 'event-1',
        votesCount: 4,
        voteThreshold: 10,
        status: EventStatuses.ON_VOTE,
      });
    });

    it('locks the event row before deleting, like a vote does', async () => {
      await service.unvote(pupil, 'event-1');

      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.eventVote.deleteMany.mock.invocationCallOrder[0],
      );
    });

    it('Conflict when the pupil has not voted', async () => {
      tx.eventVote.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.unvote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.eventVote.count).not.toHaveBeenCalled();
    });

    it.each([EventStatuses.ON_ADMIN_MODERATION, EventStatuses.FINALIZED, EventStatuses.EXPIRED])(
      'Conflict, no vote removed, when the event is %s',
      async (status) => {
        tx.$queryRaw.mockResolvedValue([{ status, voteThreshold: 10, createdAt: RECENT }]);

        await expect(service.unvote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
        expect(tx.eventVote.deleteMany).not.toHaveBeenCalled();
      },
    );

    it('Conflict, no vote removed, when voting has closed (3 days before the date)', async () => {
      tx.$queryRaw.mockResolvedValue([
        { status: EventStatuses.ON_VOTE, voteThreshold: 10, createdByRole: UserRoles.PUPIL, createdAt: RECENT, startsAt: SOON },
      ]);

      await expect(service.unvote(pupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.eventVote.deleteMany).not.toHaveBeenCalled();
    });

    it('NotFound when the event does not exist', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(service.unvote(pupil, 'event-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['teacher', teacher],
      ['admin', admin],
    ])('%s: Forbidden, no transaction', async (_name, actor) => {
      await expect(service.unvote(actor, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('likes', () => {
    beforeEach(() => {
      prisma.event.findUnique.mockResolvedValue({ status: EventStatuses.ON_VOTE });
      prisma.eventLike.count.mockResolvedValue(3);
      prisma.eventLike.groupBy.mockResolvedValue([{ eventId: 'event-1', _count: { _all: 3 } }]);
    });

    it('a pupil likes an ON_VOTE event: +1, a repeat is a no-op', async () => {
      const result = await service.like(otherPupil, 'event-1');

      expect(prisma.event.findUnique).toHaveBeenCalledWith({ where: { id: 'event-1' }, select: { status: true } });
      expect(prisma.eventLike.createMany).toHaveBeenCalledWith({
        data: [{ eventId: 'event-1', userId: otherPupil.id }],
        skipDuplicates: true,
      });
      expect(prisma.eventLike.count).toHaveBeenCalledWith({ where: { eventId: 'event-1' } });
      expect(result).toEqual({ eventId: 'event-1', liked: true, likesCount: 3 });
    });

    it.each([
      EventStatuses.ON_VOTE,
      EventStatuses.ON_ADMIN_MODERATION,
      EventStatuses.FINALIZED,
      EventStatuses.DECLINED_BY_ADMIN,
    ])('%s can be liked', async (status) => {
      prisma.event.findUnique.mockResolvedValue({ status });
      await expect(service.like(otherPupil, 'event-1')).resolves.toBeDefined();
    });

    it('a pupil of any class likes, the scope does not matter; the author too', async () => {
      await expect(service.like({ ...otherPupil, class: '5B' }, 'event-1')).resolves.toBeDefined();
      await expect(service.like({ ...otherPupil, class: null }, 'event-1')).resolves.toBeDefined();
      await expect(service.like(pupil, 'event-1')).resolves.toBeDefined();
    });

    it.each([['teacher', teacher], ['admin', admin]])('%s cannot like or unlike', async (_name, actor) => {
      await expect(service.like(actor, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.unlike(actor, 'event-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.eventLike.createMany).not.toHaveBeenCalled();
      expect(prisma.eventLike.deleteMany).not.toHaveBeenCalled();
    });

    it.each([EventStatuses.ON_MODERATION, EventStatuses.DECLINED, EventStatuses.EXPIRED])(
      'Conflict, no like stored, when the event is %s',
      async (status) => {
        prisma.event.findUnique.mockResolvedValue({ status });
        await expect(service.like(otherPupil, 'event-1')).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.eventLike.createMany).not.toHaveBeenCalled();
      },
    );

    it('NotFound for an unknown event', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.like(otherPupil, 'event-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.unlike(otherPupil, 'event-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('unlike takes the own like back: -1, in any status', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: 'event-1' });
      prisma.eventLike.count.mockResolvedValue(2);

      const result = await service.unlike(otherPupil, 'event-1');

      expect(prisma.eventLike.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', userId: otherPupil.id },
      });
      expect(result).toEqual({ eventId: 'event-1', liked: false, likesCount: 2 });
    });

    it('every event response carries its like count', async () => {
      prisma.event.findUnique.mockResolvedValue(storedEvent());
      const result = await service.findOne(admin, 'event-1');
      expect(prisma.eventLike.groupBy).toHaveBeenCalledWith({
        by: ['eventId'],
        where: { eventId: { in: ['event-1'] } },
        _count: { _all: true },
      });
      expect(result.likesCount).toBe(3);
      expect(result).not.toHaveProperty('ratingAverage');
    });
  });
});
