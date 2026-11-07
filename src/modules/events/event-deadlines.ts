import { EventStatuses, Prisma, UserRoles } from '../../../prisma/generated/prisma/client';

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

export type DeadlineFields = {
  createdByRole: UserRoles;
  createdAt: Date;
  startsAt: Date | null;
};

export function decisionDeadline(event: DeadlineFields): Date {
  if (event.createdByRole === UserRoles.ADMIN && event.startsAt) {
    return event.startsAt;
  }
  return new Date(event.createdAt.getTime() + DECISION_WINDOW_MS);
}

export function deadlineCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - DECISION_WINDOW_MS);
}

export function isPastDeadline(event: DeadlineFields, now: Date = new Date()): boolean {
  return decisionDeadline(event).getTime() <= now.getTime();
}

export function beforeDeadline(now: Date = new Date()): Prisma.EventWhereInput {
  return {
    OR: [
      { createdByRole: { not: UserRoles.ADMIN }, createdAt: { gt: deadlineCutoff(now) } },
      { createdByRole: UserRoles.ADMIN, startsAt: { gt: now } },
    ],
  };
}

export function pastDeadline(now: Date = new Date()): Prisma.EventWhereInput {
  return {
    OR: [
      { createdByRole: { not: UserRoles.ADMIN }, createdAt: { lte: deadlineCutoff(now) } },
      { createdByRole: UserRoles.ADMIN, startsAt: { lte: now } },
    ],
  };
}
