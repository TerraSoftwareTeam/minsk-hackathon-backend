import {
  EventCategories,
  EventStatuses,
} from '../../../prisma/generated/prisma/client';

export const OUTCOME_STATUS = EventStatuses.FINALIZED;

export const P_MAX = 0.9;
export const P_BASE = 0.5;
export const TIME_SIGMA_MINUTES = 120;
export const FULL_CONFIDENCE_SAMPLE = 5;

const MINSK_UTC_OFFSET_MINUTES = 3 * 60;
const MINUTES_PER_DAY = 24 * 60;

export type ProbabilityHistoryEvent = {
  id: string;
  category: EventCategories;
  startsAt: Date | null;
  status: EventStatuses;
};

export function minskMinutesOfDay(date: Date): number {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + MINSK_UTC_OFFSET_MINUTES) % MINUTES_PER_DAY;
}

export function timeSimilarity(a: Date, b: Date): number {
  const diff = Math.abs(minskMinutesOfDay(a) - minskMinutesOfDay(b));
  const d = Math.min(diff, MINUTES_PER_DAY - diff);
  return Math.exp(-(d * d) / (2 * TIME_SIGMA_MINUTES * TIME_SIGMA_MINUTES));
}

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
