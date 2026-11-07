import { EventStatuses } from '../../../prisma/generated/prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DECISION_WINDOW_MS = 30 * DAY_MS;

export const PENDING_STATUSES = [
  EventStatuses.ON_MODERATION,
  EventStatuses.ON_VOTE,
  EventStatuses.ON_ADMIN_MODERATION,
] as const;

export type PendingStatus = (typeof PENDING_STATUSES)[number];

export function isPending(status: EventStatuses): status is PendingStatus {
  return (PENDING_STATUSES as readonly EventStatuses[]).includes(status);
}

export function decisionDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DECISION_WINDOW_MS);
}

export function deadlineCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - DECISION_WINDOW_MS);
}

export function isPastDeadline(createdAt: Date, now: Date = new Date()): boolean {
  return createdAt.getTime() <= deadlineCutoff(now).getTime();
}
