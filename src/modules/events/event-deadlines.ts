import { EventStatuses, Prisma } from '../../../prisma/generated/prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every pending event (teacher moderation, voting, admin moderation) must be decided
 * this long before it takes place, whoever created it; otherwise it becomes EXPIRED.
 */
export const DECIDED_BEFORE_START_MS = 3 * DAY_MS;

/** Old events rejected before every author chose a date have none: their deadline was a month after creation. */
const LEGACY_DECISION_WINDOW_MS = 30 * DAY_MS;

export const PENDING_STATUSES = [
  EventStatuses.ON_MODERATION,
  EventStatuses.ON_VOTE,
  EventStatuses.ON_ADMIN_MODERATION,
] as const;

export type PendingStatus = (typeof PENDING_STATUSES)[number];

export function isPending(status: EventStatuses): status is PendingStatus {
  return (PENDING_STATUSES as readonly EventStatuses[]).includes(status);
}

export type DeadlineFields = {
  createdAt: Date;
  startsAt: Date | null;
};

/** When the event must be decided by: 3 days before its date (startsAt). */
export function decisionDeadline(event: DeadlineFields): Date {
  if (event.startsAt) {
    return new Date(event.startsAt.getTime() - DECIDED_BEFORE_START_MS);
  }
  return new Date(event.createdAt.getTime() + LEGACY_DECISION_WINDOW_MS);
}

export function isPastDeadline(event: DeadlineFields, now: Date = new Date()): boolean {
  return decisionDeadline(event).getTime() <= now.getTime();
}

function startsAtCutoff(now: Date): Date {
  return new Date(now.getTime() + DECIDED_BEFORE_START_MS);
}

/** Events whose deadline has not passed. A pending event always has a date. */
export function beforeDeadline(now: Date = new Date()): Prisma.EventWhereInput {
  return { startsAt: { gt: startsAtCutoff(now) } };
}

/** Events whose deadline has passed. */
export function pastDeadline(now: Date = new Date()): Prisma.EventWhereInput {
  return { startsAt: { lte: startsAtCutoff(now) } };
}
