import { EventStatuses, Prisma, UserRoles } from '../../../prisma/generated/prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Teacher events: everything (voting and the admin decision) must finish this long after creation. */
export const DECISION_WINDOW_MS = 30 * DAY_MS;

/** Pupil events: voting closes this long before the event takes place. */
export const PUPIL_VOTING_CLOSES_BEFORE_START_MS = 3 * DAY_MS;

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
  status: EventStatuses;
  createdByRole: UserRoles;
  createdAt: Date;
  startsAt: Date | null;
};

/**
 * When voting on the event closes:
 * - PUPIL: 3 days before its date (startsAt, chosen by the pupil on creation);
 * - TEACHER: a month after creation (the date is set by the admin on approval);
 * - ADMIN: at its date.
 * Old pupil events rejected before pupils chose dates have none: a month after creation.
 */
export function votingClosesAt(event: Omit<DeadlineFields, 'status'>): Date {
  if (event.startsAt && event.createdByRole === UserRoles.ADMIN) {
    return event.startsAt;
  }
  if (event.startsAt && event.createdByRole === UserRoles.PUPIL) {
    return new Date(event.startsAt.getTime() - PUPIL_VOTING_CLOSES_BEFORE_START_MS);
  }
  return new Date(event.createdAt.getTime() + DECISION_WINDOW_MS);
}

/**
 * When a pending event in its current status expires, or null if it never does:
 * a pupil event has no deadline on moderation (teachers' or admins'), only for voting.
 * Teacher and admin events have one deadline for every pending status.
 */
export function pendingDeadline(event: DeadlineFields): Date | null {
  if (event.createdByRole === UserRoles.PUPIL && event.status !== EventStatuses.ON_VOTE) {
    return null;
  }
  return votingClosesAt(event);
}

export function isPastDeadline(event: DeadlineFields, now: Date = new Date()): boolean {
  const deadline = pendingDeadline(event);
  return deadline !== null && deadline.getTime() <= now.getTime();
}

function teacherCutoff(now: Date): Date {
  return new Date(now.getTime() - DECISION_WINDOW_MS);
}

function pupilVotingCutoff(now: Date): Date {
  return new Date(now.getTime() + PUPIL_VOTING_CLOSES_BEFORE_START_MS);
}

/** Events whose deadline (pendingDeadline) has not passed, or that have none. */
export function beforeDeadline(now: Date = new Date()): Prisma.EventWhereInput {
  return {
    OR: [
      { createdByRole: UserRoles.PUPIL, status: { not: EventStatuses.ON_VOTE } },
      { createdByRole: UserRoles.PUPIL, status: EventStatuses.ON_VOTE, startsAt: { gt: pupilVotingCutoff(now) } },
      { createdByRole: UserRoles.TEACHER, createdAt: { gt: teacherCutoff(now) } },
      { createdByRole: UserRoles.ADMIN, startsAt: { gt: now } },
    ],
  };
}

/** Events whose deadline (pendingDeadline) has passed. */
export function pastDeadline(now: Date = new Date()): Prisma.EventWhereInput {
  return {
    OR: [
      { createdByRole: UserRoles.PUPIL, status: EventStatuses.ON_VOTE, startsAt: { lte: pupilVotingCutoff(now) } },
      { createdByRole: UserRoles.TEACHER, createdAt: { lte: teacherCutoff(now) } },
      { createdByRole: UserRoles.ADMIN, startsAt: { lte: now } },
    ],
  };
}
