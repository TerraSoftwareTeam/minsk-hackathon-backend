import {
  EventCategories,
  EventStatuses,
} from '../../../prisma/generated/prisma/client';

/**
 * Probability that an event takes place, estimated from other events of the
 * same category whose outcome is already known (decided, even if not started
 * yet), weighted by how close their start time of day is to this one.
 *
 * All events are held on Saturdays, so only the time of day matters, not the
 * date. Time is taken in Minsk local time (UTC+3 all year, no DST).
 *
 *   wᵢ = exp(−dᵢ² / 2σ²)        dᵢ - difference of start times in minutes (across midnight too)
 *   W  = Σ wᵢ                   evidence: how many events at this time the history holds
 *   r  = Σ wᵢ·sᵢ / W            success rate at this time (sᵢ = 1 if FINALIZED, 0 if EXPIRED)
 *   k  = min(1, W / N)          confidence: full once the evidence reaches N events
 *   target = P_MIN + (P_MAX − P_MIN) · r
 *   P      = P_BASE + (target − P_BASE) · k
 *
 * Properties:
 * - N or more events at the same time, all successful: exactly P_MAX (90%). No history: P_BASE.
 * - Events at a distant time have weight ≈ 0, so they change neither r nor k:
 *   a success at 20:00 does not lower the estimate for 12:00, a failure does not raise it.
 * - Monotonic: another success never lowers P, another failure never raises it.
 */

/** Outcome of each status that counts. Declined requests and pending events are ignored. */
export const OUTCOME_STATUSES = [
  EventStatuses.FINALIZED,
  EventStatuses.EXPIRED,
] as const;

export const P_MAX = 0.9;
export const P_MIN = 0.05;
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
  startsAt: Date;
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

function isOutcome(status: EventStatuses): boolean {
  return (OUTCOME_STATUSES as readonly EventStatuses[]).includes(status);
}

/**
 * Probability (0..1) for an event of `category` starting at `startsAt`.
 * Uses `history` events of the same category with a known outcome, except
 * `excludeId` (the event being estimated). The outcome is known once the event
 * is decided, so a FINALIZED event counts even before it starts.
 */
export function computeSuccessProbability(
  category: EventCategories,
  startsAt: Date,
  history: readonly ProbabilityHistoryEvent[],
  excludeId?: string,
): number {
  const known = history.filter(
    (event) =>
      event.id !== excludeId &&
      event.category === category &&
      isOutcome(event.status),
  );
  if (known.length === 0) {
    return P_BASE;
  }

  let evidence = 0;
  let successWeight = 0;
  for (const event of known) {
    const w = timeSimilarity(startsAt, event.startsAt);
    evidence += w;
    if (event.status === EventStatuses.FINALIZED) {
      successWeight += w;
    }
  }

  // w > 0 always (at most 12 h apart: exp(-18) ≈ 1.5e-8), so evidence > 0 here.
  const successRate = successWeight / evidence;
  const confidence = Math.min(1, evidence / FULL_CONFIDENCE_SAMPLE);

  const target = P_MIN + (P_MAX - P_MIN) * successRate;
  const probability = P_BASE + (target - P_BASE) * confidence;
  return Math.round(probability * 10000) / 10000;
}
