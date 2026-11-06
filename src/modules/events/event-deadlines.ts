import { EventStatuses } from '../../../prisma/generated/prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A pending event must be decided within this time after it was created:
 * teacher moderation, voting and the admin decision all close at
 * createdAt + DECISION_WINDOW_MS. A month is counted as 30 days, so the
 * deadline is a plain offset and the queries can compare createdAt directly.
 */
export const DECISION_WINDOW_MS = 30 * DAY_MS;

/** Statuses that still await a decision and expire at the deadline. The rest are final. */
export const PENDING_STATUSES = [
  EventStatuses.ON_MODERATION,
  EventStatuses.ON_VOTE,
  EventStatuses.ON_ADMIN_MODERATION,
] as const;

export type PendingStatus = (typeof PENDING_STATUSES)[number];

export function isPending(status: EventStatuses): status is PendingStatus {
  return (PENDING_STATUSES as readonly EventStatuses[]).includes(status);
}

/** When voting (and every other pending step) closes for an event created at `createdAt`. */
export function decisionDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DECISION_WINDOW_MS);
}

/**
 * Events created at or before this moment are past their deadline:
 * createdAt + window <= now  <=>  createdAt <= now - window.
 * Comparing createdAt directly keeps the queries on the (status, createdAt) index.
 */
export function deadlineCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - DECISION_WINDOW_MS);
}

export function isPastDeadline(createdAt: Date, now: Date = new Date()): boolean {
  return createdAt.getTime() <= deadlineCutoff(now).getTime();
}
