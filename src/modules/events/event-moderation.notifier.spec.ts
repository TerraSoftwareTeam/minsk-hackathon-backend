import { EventStatuses, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notifications/push.service';
import { EventModerationNotifier, MODERATION_PUSH_TYPES } from './event-moderation.notifier';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('EventModerationNotifier', () => {
  let prisma: { event: { findUnique: jest.Mock }; user: { findMany: jest.Mock } };
  let push: { sendToUsers: jest.Mock };
  let notifier: EventModerationNotifier;

  beforeEach(() => {
    prisma = {
      event: { findUnique: jest.fn().mockResolvedValue({ name: 'Trip' }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]) },
    };
    push = { sendToUsers: jest.fn().mockResolvedValue(undefined) };
    notifier = new EventModerationNotifier(
      prisma as unknown as PrismaService,
      push as unknown as PushService,
    );
  });

  it('notifies every teacher of the class about a new event', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'teacher-1' }, { id: 'teacher-2' }]);
    notifier.awaitsTeachers({
      id: 'event-1',
      name: 'Trip',
      initiator: { name: 'Ivan', surname: 'Ivanov', class: '10A' },
    });
    await flush();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: UserRoles.TEACHER, class: '10A' },
      select: { id: true },
    });
    expect(push.sendToUsers).toHaveBeenCalledWith(['teacher-1', 'teacher-2'], {
      title: expect.any(String),
      body: '«Trip» — Ivanov Ivan, 10A',
      data: {
        type: MODERATION_PUSH_TYPES.TEACHER,
        eventId: 'event-1',
        status: EventStatuses.ON_MODERATION,
      },
    });
  });

  it('pushes nobody while the class has no teacher', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    notifier.awaitsTeachers({
      id: 'event-1',
      name: 'Trip',
      initiator: { name: 'Ivan', surname: 'Ivanov', class: '9A' },
    });
    await flush();

    expect(push.sendToUsers).not.toHaveBeenCalled();
  });

  it('notifies every admin about an event that collected its votes', async () => {
    notifier.awaitsAdmin('event-1');
    await flush();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: UserRoles.ADMIN },
      select: { id: true },
    });
    expect(push.sendToUsers).toHaveBeenCalledWith(['admin-1', 'admin-2'], {
      title: expect.any(String),
      body: expect.stringContaining('Trip'),
      data: {
        type: MODERATION_PUSH_TYPES.ADMIN,
        eventId: 'event-1',
        status: EventStatuses.ON_ADMIN_MODERATION,
      },
    });
  });

  describe('event that collected its votes', () => {
    it('a teacher author learns it went to the admins', async () => {
      prisma.event.findUnique.mockResolvedValue({
        name: 'Trip',
        initiatorId: 'teacher-1',
        createdByRole: UserRoles.TEACHER,
      });
      notifier.awaitsAdmin('event-1');
      await flush();

      expect(push.sendToUsers).toHaveBeenCalledTimes(2);
      expect(push.sendToUsers).toHaveBeenCalledWith(['admin-1', 'admin-2'], expect.anything());
      expect(push.sendToUsers).toHaveBeenCalledWith(['teacher-1'], {
        title: 'Мероприятие передано администрации',
        body: '«Trip» набрало нужное число голосов и ждёт решения администрации',
        data: {
          type: MODERATION_PUSH_TYPES.SENT_TO_ADMIN,
          eventId: 'event-1',
          status: EventStatuses.ON_ADMIN_MODERATION,
        },
      });
    });

    it('a pupil author is not pushed, only the admins', async () => {
      prisma.event.findUnique.mockResolvedValue({
        name: 'Trip',
        initiatorId: 'pupil-1',
        createdByRole: UserRoles.PUPIL,
      });
      notifier.awaitsAdmin('event-1');
      await flush();

      expect(push.sendToUsers).toHaveBeenCalledTimes(1);
      expect(push.sendToUsers).toHaveBeenCalledWith(['admin-1', 'admin-2'], expect.anything());
    });

    it('an admin event FINALIZED by the votes: every admin is told', async () => {
      notifier.finalizedByVotes('event-1', []);
      await flush();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { role: UserRoles.ADMIN },
        select: { id: true },
      });
      expect(push.sendToUsers).toHaveBeenCalledWith(['admin-1', 'admin-2'], {
        title: 'Школьное мероприятие состоится',
        body: '«Trip» набрало нужное число голосов',
        data: {
          type: MODERATION_PUSH_TYPES.FINALIZED_BY_VOTES,
          eventId: 'event-1',
          status: EventStatuses.FINALIZED,
        },
      });
    });

    it('an admin event FINALIZED by the votes: the participants learn the date and their exp', async () => {
      prisma.event.findUnique.mockResolvedValue({ name: 'Trip', startsAt: new Date('2026-11-14T12:00:00Z') });
      notifier.finalizedByVotes('event-1', ['pupil-1', 'pupil-2']);
      await flush();

      expect(push.sendToUsers).toHaveBeenCalledTimes(2);
      expect(push.sendToUsers).toHaveBeenCalledWith(['pupil-1', 'pupil-2'], {
        title: 'Мероприятие состоится',
        body: '«Trip» пройдёт 14 ноября в 15:00. +5 exp за участие',
        data: {
          type: MODERATION_PUSH_TYPES.FINALIZED,
          eventId: 'event-1',
          status: EventStatuses.FINALIZED,
          exp: '5',
        },
      });
    });

    it('nobody is pushed for a deleted event', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      notifier.finalizedByVotes('event-1', ['pupil-1']);
      await flush();
      expect(push.sendToUsers).not.toHaveBeenCalled();
    });
  });

  describe('decision to the author', () => {
    const event = { id: 'event-1', name: 'Trip', initiatorId: 'pupil-1' };
    const sent = () => push.sendToUsers.mock.calls[0];

    it.each([
      [EventStatuses.ON_VOTE, 'Учитель одобрил мероприятие', '«Trip» вышло на голосование'],
      [EventStatuses.DECLINED, 'Учитель отклонил мероприятие', '«Trip»'],
      [EventStatuses.FINALIZED, 'Мероприятие одобрено', 'Администрация одобрила «Trip»'],
      [EventStatuses.DECLINED_BY_ADMIN, 'Администрация отклонила мероприятие', '«Trip»'],
    ] as const)('%s', async (status, title, body) => {
      notifier.decisionMade(event, status);
      await flush();

      expect(push.sendToUsers).toHaveBeenCalledWith(['pupil-1'], {
        title,
        body,
        data: { type: MODERATION_PUSH_TYPES.DECISION, eventId: 'event-1', status },
      });
    });

    it('FINALIZED: adds the exp the organizer got', async () => {
      notifier.decisionMade(event, EventStatuses.FINALIZED, null, 25);
      await flush();
      expect(push.sendToUsers).toHaveBeenCalledWith(['pupil-1'], {
        title: 'Мероприятие одобрено',
        body: 'Администрация одобрила «Trip». +25 exp за организацию',
        data: {
          type: MODERATION_PUSH_TYPES.DECISION,
          eventId: 'event-1',
          status: EventStatuses.FINALIZED,
          exp: '25',
        },
      });
    });

    it('participants of an approved event learn the date and their exp', async () => {
      notifier.participantsFinalized(
        { id: 'event-1', name: 'Trip', startsAt: new Date('2026-11-14T12:00:00Z') },
        ['pupil-2'],
      );
      await flush();
      expect(push.sendToUsers).toHaveBeenCalledWith(['pupil-2'], {
        title: 'Мероприятие состоится',
        body: '«Trip» пройдёт 14 ноября в 15:00. +5 exp за участие',
        data: {
          type: MODERATION_PUSH_TYPES.FINALIZED,
          eventId: 'event-1',
          status: EventStatuses.FINALIZED,
          exp: '5',
        },
      });
    });

    it('adds the decline reason', async () => {
      notifier.decisionMade(event, EventStatuses.DECLINED, 'Pick another date');
      await flush();
      expect(sent()[1].body).toBe('«Trip». Причина: Pick another date');
    });

    it('shortens a long reason to fit the FCM 4 KB limit', async () => {
      notifier.decisionMade(event, EventStatuses.DECLINED_BY_ADMIN, 'я'.repeat(2000));
      await flush();
      const reason = sent()[1].body.split('Причина: ')[1];
      expect(Array.from(reason)).toHaveLength(200);
      expect(reason.endsWith('…')).toBe(true);
    });
  });

  it.each([
    [UserRoles.TEACHER, 'Учитель удалил «Trip»'],
    [UserRoles.ADMIN, 'Администрация удалила «Trip»'],
  ])('tells the author that a %s deleted the event', async (role, body) => {
    notifier.eventDeleted({ id: 'event-1', name: 'Trip', initiatorId: 'pupil-1' }, role);
    await flush();
    expect(push.sendToUsers).toHaveBeenCalledWith(['pupil-1'], {
      title: 'Заявка удалена',
      body,
      data: { type: MODERATION_PUSH_TYPES.DELETED, eventId: 'event-1' },
    });
  });

  it('swallows a failure instead of rejecting', async () => {
    prisma.user.findMany.mockRejectedValue(new Error('db down'));
    expect(() => notifier.awaitsAdmin('event-1')).not.toThrow();
    await flush();
    expect(push.sendToUsers).not.toHaveBeenCalled();
  });
});
