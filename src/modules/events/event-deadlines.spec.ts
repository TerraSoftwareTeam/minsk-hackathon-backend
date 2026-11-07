import { beforeDeadline, decisionDeadline, isPastDeadline, pastDeadline } from './event-deadlines';

const DAY_MS = 24 * 3600 * 1000;
const NOW = new Date('2026-12-01T10:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

describe('event deadlines', () => {
  it('an event must be decided 3 days before its date, however long ago it was created', () => {
    const event = { createdAt: at(-40), startsAt: at(10) };
    expect(decisionDeadline(event)).toEqual(at(7));
    expect(isPastDeadline(event, NOW)).toBe(false);
  });

  it('past the deadline from 3 days before the date', () => {
    expect(isPastDeadline({ createdAt: at(-1), startsAt: at(3) }, NOW)).toBe(true);
    expect(isPastDeadline({ createdAt: at(-1), startsAt: at(3.01) }, NOW)).toBe(false);
  });

  it('an old rejected event without a date: a month after the creation', () => {
    expect(decisionDeadline({ createdAt: at(-40), startsAt: null })).toEqual(at(-10));
  });

  it('queries compare startsAt with now + 3 days, whatever the role and pending status', () => {
    expect(beforeDeadline(NOW)).toEqual({ startsAt: { gt: at(3) } });
    expect(pastDeadline(NOW)).toEqual({ startsAt: { lte: at(3) } });
  });
});
