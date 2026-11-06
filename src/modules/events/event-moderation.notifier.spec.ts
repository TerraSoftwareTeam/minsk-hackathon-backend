import { EventStatuses, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notifications/push.service';
import { EventModerationNotifier, MODERATION_PUSH_TYPES } from './event-moderation.notifier';

/** Lets the fire-and-forget task finish. */
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

  it('notifies the assigned teacher about a new event', async () => {
    notifier.awaitsTeacher({
      id: 'event-1',
      name: 'Trip',
      teacherId: 'teacher-1',
      initiator: { name: 'Ivan', surname: 'Ivanov', class: '10A' },
    });
    await flush();

    expect(push.sendToUsers).toHaveBeenCalledWith(['teacher-1'], {
      title: expect.any(String),
      body: '«Trip» — Ivanov Ivan, 10A',
      data: {
        type: MODERATION_PUSH_TYPES.TEACHER,
        eventId: 'event-1',
        status: EventStatuses.ON_MODERATION,
      },
    });
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

  it('swallows a failure instead of rejecting', async () => {
    prisma.user.findMany.mockRejectedValue(new Error('db down'));
    expect(() => notifier.awaitsAdmin('event-1')).not.toThrow();
    await flush();
    expect(push.sendToUsers).not.toHaveBeenCalled();
  });
});
