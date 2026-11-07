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
  it('voting closes 3 days before the date, however long ago the event was created', () => {
    expect(votingClosesAt({ createdAt: at(-40), startsAt: at(10) })).toEqual(at(7));
  });

  it.each([ON_MODERATION, ON_VOTE])('%s ends when voting closes, 3 days before the date', (status) => {
    expect(decisionDeadline({ status, createdAt: at(-1), startsAt: at(10) })).toEqual(at(7));
    expect(isPastDeadline({ status, createdAt: at(-1), startsAt: at(3) }, NOW)).toBe(true);
    expect(isPastDeadline({ status, createdAt: at(-1), startsAt: at(3.01) }, NOW)).toBe(false);
  });

  it('the admin decides until the event starts', () => {
    const event = { status: ON_ADMIN_MODERATION, createdAt: at(-1), startsAt: at(1) };
    expect(decisionDeadline(event)).toEqual(at(1));
    expect(isPastDeadline(event, NOW)).toBe(false);
    expect(isPastDeadline({ ...event, startsAt: NOW }, NOW)).toBe(true);
  });

  it('an old rejected event without a date: a month after the creation', () => {
    expect(votingClosesAt({ createdAt: at(-40), startsAt: null })).toEqual(at(-10));
  });

  it('queries compare startsAt with now + 3 days, or with now on admin moderation', () => {
    expect(beforeDeadline(NOW)).toEqual({
      OR: [
        { status: { in: [ON_MODERATION, ON_VOTE] }, startsAt: { gt: at(3) } },
        { status: ON_ADMIN_MODERATION, startsAt: { gt: NOW } },
      ],
    });
    expect(votingClosed(NOW)).toEqual({ status: ON_VOTE, startsAt: { lte: at(3) } });
    expect(moderationPastDeadline(NOW)).toEqual({
      OR: [
        { status: ON_MODERATION, startsAt: { lte: at(3) } },
        { status: ON_ADMIN_MODERATION, startsAt: { lte: NOW } },
      ],
    });
  });
});
