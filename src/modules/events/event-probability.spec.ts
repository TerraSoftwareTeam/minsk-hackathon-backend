import {
  EventCategories,
  EventStatuses,
} from '../../../prisma/generated/prisma/client';
import {
  P_BASE,
  P_MAX,
  ProbabilityHistoryEvent,
  computeSuccessProbability,
  minskMinutesOfDay,
  timeSimilarity,
} from './event-probability';

const { SPORTS, CULTURAL } = EventCategories;
const { FINALIZED, EXPIRED, DECLINED, DECLINED_BY_ADMIN, ON_VOTE } =
  EventStatuses;

/** Target event: Saturday 2026-12-05 12:00 Minsk time. */
const TARGET = new Date('2026-12-05T12:00:00+03:00');

let nextId = 0;

/** Another Saturday (weeksAgo, negative = later) at `time` Minsk time. */
const past = (
  time: string,
  status: EventStatuses,
  weeksAgo = 1,
  category: EventCategories = SPORTS,
): ProbabilityHistoryEvent => {
  const sameDay = new Date(`2026-12-05T${time}:00+03:00`);
  return {
    id: `e${nextId++}`,
    category,
    status,
    startsAt: new Date(sameDay.getTime() - weeksAgo * 7 * 24 * 3600 * 1000),
  };
};

const times = (n: number, time: string, status: EventStatuses) =>
  Array.from({ length: n }, (_, i) => past(time, status, i + 1));

describe('event probability', () => {
  it('takes the time of day in Minsk time (UTC+3)', () => {
    expect(minskMinutesOfDay(new Date('2026-12-05T09:00:00Z'))).toBe(12 * 60);
    expect(minskMinutesOfDay(new Date('2026-12-05T22:30:00Z'))).toBe(90);
  });

  it('time similarity: 1 at the same time, ignores the date, falls off nonlinearly', () => {
    const at = (t: string, day = '05') =>
      new Date(`2026-12-${day}T${t}:00+03:00`);
    expect(timeSimilarity(at('12:00'), at('12:00', '01'))).toBe(1);
    expect(timeSimilarity(at('12:00'), at('13:00'))).toBeCloseTo(0.8825, 4);
    expect(timeSimilarity(at('12:00'), at('14:00'))).toBeCloseTo(0.6065, 4);
    expect(timeSimilarity(at('12:00'), at('16:00'))).toBeCloseTo(0.1353, 4);
  });

  it('no history: base probability', () => {
    expect(computeSuccessProbability(SPORTS, TARGET, [])).toBe(P_BASE);
  });

  it('5 earlier events at the same time, all successful: exactly 90%', () => {
    expect(
      computeSuccessProbability(SPORTS, TARGET, times(5, '12:00', FINALIZED)),
    ).toBe(P_MAX);
    expect(
      computeSuccessProbability(SPORTS, TARGET, times(12, '12:00', FINALIZED)),
    ).toBe(P_MAX);
  });

  it('fewer earlier events: pulled towards the base by the sample size', () => {
    expect(
      computeSuccessProbability(SPORTS, TARGET, times(1, '12:00', FINALIZED)),
    ).toBe(0.58);
    expect(
      computeSuccessProbability(SPORTS, TARGET, times(3, '12:00', FINALIZED)),
    ).toBe(0.74);
  });

  it('all earlier events at the same time failed: minimum', () => {
    expect(
      computeSuccessProbability(SPORTS, TARGET, times(5, '12:00', EXPIRED)),
    ).toBe(0.05);
  });

  it('mixed history: weighted by how close the start time is', () => {
    const history = [
      past('12:00', FINALIZED, 1),
      past('13:00', FINALIZED, 2),
      past('11:00', FINALIZED, 3),
      past('18:00', EXPIRED, 4),
      past('10:00', EXPIRED, 5),
    ];
    const p = computeSuccessProbability(SPORTS, TARGET, history);
    expect(p).toBeGreaterThan(0.6);
    expect(p).toBeLessThan(0.7);
  });

  it('events at a very different time barely matter, whatever their outcome', () => {
    const same = times(5, '12:00', FINALIZED);
    const far = (status: EventStatuses) =>
      Array.from({ length: 10 }, (_, i) => past('20:00', status, i + 6));
    expect(
      computeSuccessProbability(SPORTS, TARGET, [...same, ...far(EXPIRED)]),
    ).toBeCloseTo(P_MAX, 2);
    // A success elsewhere must not lower the estimate (regression: it used to drop to 0.70).
    expect(
      computeSuccessProbability(SPORTS, TARGET, [...same, ...far(FINALIZED)]),
    ).toBe(P_MAX);
    // Successes elsewhere must not hide a failure at this time.
    const failedHere = [past('12:00', EXPIRED)];
    expect(
      computeSuccessProbability(SPORTS, TARGET, [
        ...failedHere,
        ...far(FINALIZED),
      ]),
    ).toBeCloseTo(computeSuccessProbability(SPORTS, TARGET, failedHere), 2);
  });

  it('compares the time around midnight: 23:30 and 00:30 are 1 hour apart', () => {
    const at = (iso: string) => new Date(iso);
    expect(
      timeSimilarity(
        at('2026-12-05T23:30:00+03:00'),
        at('2026-12-05T00:30:00+03:00'),
      ),
    ).toBeCloseTo(
      timeSimilarity(
        at('2026-12-05T12:00:00+03:00'),
        at('2026-12-05T13:00:00+03:00'),
      ),
      10,
    );
  });

  it('objective: bounded, monotonic in outcomes, independent of order (random histories)', () => {
    // Deterministic pseudo-random generator, so a failure is reproducible.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const randomEvent = (status: EventStatuses): ProbabilityHistoryEvent => {
      const minutes = Math.floor(rand() * 24 * 60);
      const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
      const mm = String(minutes % 60).padStart(2, '0');
      return past(`${hh}:${mm}`, status, 1 + Math.floor(rand() * 50));
    };
    for (let run = 0; run < 300; run++) {
      const history = Array.from({ length: Math.floor(rand() * 15) }, () =>
        randomEvent(rand() < 0.5 ? FINALIZED : EXPIRED),
      );
      const p = computeSuccessProbability(SPORTS, TARGET, history);
      expect(p).toBeGreaterThanOrEqual(0.05);
      expect(p).toBeLessThanOrEqual(P_MAX);

      const extra = randomEvent(FINALIZED);
      expect(
        computeSuccessProbability(SPORTS, TARGET, [...history, extra]),
      ).toBeGreaterThanOrEqual(p);
      expect(
        computeSuccessProbability(SPORTS, TARGET, [
          ...history,
          { ...extra, status: EXPIRED },
        ]),
      ).toBeLessThanOrEqual(p);
      expect(
        computeSuccessProbability(SPORTS, TARGET, [...history].reverse()),
      ).toBe(p);
    }
  });

  it('ignores declined, pending, other-category events and the event itself', () => {
    const base = times(5, '12:00', FINALIZED);
    const noise: ProbabilityHistoryEvent[] = [
      past('12:00', DECLINED),
      past('12:00', DECLINED_BY_ADMIN),
      past('12:00', ON_VOTE),
      past('12:00', EXPIRED, 1, CULTURAL),
    ];
    const self = { ...past('12:00', EXPIRED), id: 'self' };
    expect(
      computeSuccessProbability(
        SPORTS,
        TARGET,
        [...base, ...noise, self],
        'self',
      ),
    ).toBe(P_MAX);
  });

  it('counts a decided event that has not started yet, even at the same moment', () => {
    // Two events at the same moment: one FINALIZED, the other is being estimated.
    const finalized = {
      ...past('12:00', FINALIZED),
      id: 'f',
      startsAt: TARGET,
    };
    expect(
      computeSuccessProbability(SPORTS, TARGET, [finalized], 'other'),
    ).toBe(0.58);
    expect(computeSuccessProbability(SPORTS, TARGET, [finalized], 'f')).toBe(
      P_BASE,
    );
    // Later in the calendar also counts: the outcome is already known.
    expect(
      computeSuccessProbability(SPORTS, TARGET, [past('12:00', FINALIZED, -2)]),
    ).toBe(0.58);
  });
});
