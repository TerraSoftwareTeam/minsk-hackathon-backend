import { EventStatuses } from '../../../prisma/generated/prisma/client';
import {
  beforeDeadline,
  decisionDeadline,
  isPastDeadline,
  moderationPastDeadline,
  votingClosed,
  votingClosesAt,
} from './event-deadlines';

const DAY_MS = 24 * 3600 * 1000;
const NOW = new Date('2026-12-01T10:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY_MS);
const { ON_MODERATION, ON_VOTE, ON_ADMIN_MODERATION } = EventStatuses;

describe('event deadlines', () => {
  it('voting closes 5 days before the date, however long ago the event was created', () => {
    expect(votingClosesAt({ createdAt: at(-40), startsAt: at(10) })).toEqual(at(5));
  });

  it.each([ON_MODERATION, ON_VOTE])('%s ends when voting closes, 5 days before the date', (status) => {
    expect(decisionDeadline({ status, createdAt: at(-1), startsAt: at(10) })).toEqual(at(5));
    expect(isPastDeadline({ status, createdAt: at(-1), startsAt: at(5) }, NOW)).toBe(true);
    expect(isPastDeadline({ status, createdAt: at(-1), startsAt: at(5.01) }, NOW)).toBe(false);
  });

  it('the admin decides by 3 days before the date', () => {
    const event = { status: ON_ADMIN_MODERATION, createdAt: at(-1), startsAt: at(4) };
    expect(decisionDeadline(event)).toEqual(at(1));
    expect(isPastDeadline(event, NOW)).toBe(false);
    expect(isPastDeadline({ ...event, startsAt: at(3) }, NOW)).toBe(true);
  });

  it('an old rejected event without a date: a month after the creation', () => {
    expect(votingClosesAt({ createdAt: at(-40), startsAt: null })).toEqual(at(-10));
  });

  it('queries compare startsAt with now + 5 days, or now + 3 days on admin moderation', () => {
    expect(beforeDeadline(NOW)).toEqual({
      OR: [
        { status: { in: [ON_MODERATION, ON_VOTE] }, startsAt: { gt: at(5) } },
        { status: ON_ADMIN_MODERATION, startsAt: { gt: at(3) } },
      ],
    });
    expect(votingClosed(NOW)).toEqual({ status: ON_VOTE, startsAt: { lte: at(5) } });
    expect(moderationPastDeadline(NOW)).toEqual({
      OR: [
        { status: ON_MODERATION, startsAt: { lte: at(5) } },
        { status: ON_ADMIN_MODERATION, startsAt: { lte: at(3) } },
      ],
    });
  });
});
