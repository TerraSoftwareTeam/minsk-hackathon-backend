import { EventStatuses, UserRoles } from '../../../prisma/generated/prisma/client';
import { DeadlineFields, isPastDeadline, pendingDeadline, votingClosesAt } from './event-deadlines';

const DAY_MS = 24 * 3600 * 1000;
const NOW = new Date('2026-12-01T10:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

const pupilEvent = (over: Partial<DeadlineFields> = {}): DeadlineFields => ({
  status: EventStatuses.ON_VOTE,
  createdByRole: UserRoles.PUPIL,
  createdAt: at(-40),
  startsAt: at(10),
  ...over,
});

describe('event deadlines', () => {
  describe('pupil event', () => {
    it('voting closes 3 days before the date, however long ago it was created', () => {
      expect(votingClosesAt(pupilEvent())).toEqual(at(7));
      expect(isPastDeadline(pupilEvent(), NOW)).toBe(false);
      expect(isPastDeadline(pupilEvent({ startsAt: at(3) }), NOW)).toBe(true);
    });

    it.each([EventStatuses.ON_MODERATION, EventStatuses.ON_ADMIN_MODERATION])(
      'has no deadline when %s, even after its date',
      (status) => {
        const event = pupilEvent({ status, startsAt: at(-1) });
        expect(pendingDeadline(event)).toBeNull();
        expect(isPastDeadline(event, NOW)).toBe(false);
      },
    );

    it('an old rejected event without a date: a month after the creation', () => {
      const event = pupilEvent({ status: EventStatuses.DECLINED, startsAt: null });
      expect(votingClosesAt(event)).toEqual(at(-10));
    });
  });

  it.each([EventStatuses.ON_VOTE, EventStatuses.ON_ADMIN_MODERATION])(
    'teacher event %s: a month after the creation',
    (status) => {
      const event: DeadlineFields = { status, createdByRole: UserRoles.TEACHER, createdAt: at(-31), startsAt: null };
      expect(pendingDeadline(event)).toEqual(at(-1));
      expect(isPastDeadline(event, NOW)).toBe(true);
    },
  );

  it('admin event: at its date', () => {
    const event: DeadlineFields = {
      status: EventStatuses.ON_VOTE,
      createdByRole: UserRoles.ADMIN,
      createdAt: at(-40),
      startsAt: at(1),
    };
    expect(pendingDeadline(event)).toEqual(at(1));
    expect(isPastDeadline(event, NOW)).toBe(false);
  });
});
