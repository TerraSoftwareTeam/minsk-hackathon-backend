import {
  EventCategories,
  EventStatuses,
} from '../../../prisma/generated/prisma/client';

/**
 * Probability that an event takes place, estimated from the events of the
 * same category that took place: FINALIZED, with the date set by the admin
 * (even if not started yet). Pending, declined and expired events carry no
 * date and are not counted. The more such events the history holds at this
 * start time of day, the higher the estimate.
 *
 * All events are held on Saturdays, so only the time of day matters, not the
 * date. Time is taken in Minsk local time (UTC+3 all year, no DST). An event
 * without a date yet (any status before FINALIZED) has no time to compare:
 * every FINALIZED event of its category counts with full weight.
 *
 *   wᵢ = exp(−dᵢ² / 2σ²)        dᵢ - difference of start times in minutes (across midnight too);
 *                               wᵢ = 1 when the estimated event has no date
 *   W  = Σ wᵢ                   evidence: how many events at this time the history holds
 *   k  = min(1, W / N)          confidence: full once the evidence reaches N events
 *   P  = P_BASE + (P_MAX − P_BASE) · k
 *
 * Properties:
 * - N or more events at the same time: exactly P_MAX (90%). No history: P_BASE.
 * - Events at a distant time have weight ≈ 0: a success at 20:00 barely raises the estimate for 12:00.
 * - Monotonic: another FINALIZED event never lowers P.
 */

/** The only status that counts: the event took place and has its date. */
export const OUTCOME_STATUS = EventStatuses.FINALIZED;

export const P_MAX = 0.9;
export const P_BASE = 0.5;
/** Width of the time similarity kernel: 1 h -> 0.88, 2 h -> 0.61, 4 h -> 0.14. */
export const TIME_SIGMA_MINUTES = 120;
/** Events at the same time needed for full confidence (the sample size correction). */
export const FULL_CONFIDENCE_SAMPLE = 5;

const MINSK_UTC_OFFSET_MINUTES = 3 * 60;
const MINUTES_PER_DAY = 24 * 60;

export type ProbabilityHistoryEvent = {
  id: string;
  category: EventCategories;
  startsAt: Date | null;
  status: EventStatuses;
};

/** Minutes since midnight in Minsk time. */
export function minskMinutesOfDay(date: Date): number {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + MINSK_UTC_OFFSET_MINUTES) % MINUTES_PER_DAY;
}

/** 1 for the same start time, falls off as a Gaussian of the difference in minutes. */
export function timeSimilarity(a: Date, b: Date): number {
  const diff = Math.abs(minskMinutesOfDay(a) - minskMinutesOfDay(b));
  // Around the clock: 23:30 and 00:30 are 1 hour apart, not 23.
  const d = Math.min(diff, MINUTES_PER_DAY - diff);
  return Math.exp(-(d * d) / (2 * TIME_SIGMA_MINUTES * TIME_SIGMA_MINUTES));
}

/**
 * Probability (0..1) for an event of `category` starting at `startsAt`
 * (null: no date yet, the time is not compared). Uses the FINALIZED `history`
 * events of the same category with a date, except `excludeId` (the event being
 * estimated). A FINALIZED event counts even before it starts.
 */
export function computeSuccessProbability(
  category: EventCategories,
  startsAt: Date | null,
  history: readonly ProbabilityHistoryEvent[],
  excludeId?: string,
): number {
  let evidence = 0;
  for (const event of history) {
    if (
      event.id === excludeId ||
      event.category !== category ||
      event.status !== OUTCOME_STATUS ||
      event.startsAt === null
    ) {
      continue;
    }
    evidence +=
      startsAt === null ? 1 : timeSimilarity(startsAt, event.startsAt);
  }
  const confidence = Math.min(1, evidence / FULL_CONFIDENCE_SAMPLE);
  const probability = P_BASE + (P_MAX - P_BASE) * confidence;
  return Math.round(probability * 10000) / 10000;
}
