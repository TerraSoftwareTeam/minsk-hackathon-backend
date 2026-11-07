import { EventStatuses, Prisma } from '../../../prisma/generated/prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Teacher moderation and voting (gathering participants) end this long before the
 * event takes place, whoever created it. At that moment voting closes: enough votes ->
 * the event moves on (admin moderation, or FINALIZED for an admin event), else EXPIRED.
 */
export const VOTING_CLOSES_BEFORE_START_MS = 5 * DAY_MS;

/** The admin decides by this long before the event takes place, otherwise it is EXPIRED. */
export const ADMIN_DECIDES_BEFORE_START_MS = 3 * DAY_MS;

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

/** Statuses that end when voting closes (VOTING_CLOSES_BEFORE_START_MS). */
const UNTIL_VOTING_CLOSES = [EventStatuses.ON_MODERATION, EventStatuses.ON_VOTE];

export type DeadlineFields = {
  status: EventStatuses;
  createdAt: Date;
  startsAt: Date | null;
};

function beforeStart(startsAt: Date, ms: number): Date {
  return new Date(startsAt.getTime() - ms);
}

/** When voting (and teacher moderation) closes: 5 days before the date. */
export function votingClosesAt(event: Omit<DeadlineFields, 'status'>): Date {
  if (!event.startsAt) {
    return new Date(event.createdAt.getTime() + LEGACY_DECISION_WINDOW_MS);
  }
  return beforeStart(event.startsAt, VOTING_CLOSES_BEFORE_START_MS);
}

/** When the current pending stage ends: 3 days before the date on admin moderation, else when voting closes. */
export function decisionDeadline(event: DeadlineFields): Date {
  if (event.status === EventStatuses.ON_ADMIN_MODERATION && event.startsAt) {
    return beforeStart(event.startsAt, ADMIN_DECIDES_BEFORE_START_MS);
  }
  return votingClosesAt(event);
}

export function isPastDeadline(event: DeadlineFields, now: Date = new Date()): boolean {
  return decisionDeadline(event).getTime() <= now.getTime();
}

function cutoff(now: Date, ms: number): Date {
  return new Date(now.getTime() + ms);
}

/** Pending events whose current stage has not ended. A pending event always has a date. */
export function beforeDeadline(now: Date = new Date()): Prisma.EventWhereInput {
  return {
    OR: [
      { status: { in: UNTIL_VOTING_CLOSES }, startsAt: { gt: cutoff(now, VOTING_CLOSES_BEFORE_START_MS) } },
      {
        status: EventStatuses.ON_ADMIN_MODERATION,
        startsAt: { gt: cutoff(now, ADMIN_DECIDES_BEFORE_START_MS) },
      },
    ],
  };
}

/** ON_VOTE events whose voting has closed: they move on or expire (EventsService.closeVoting). */
export function votingClosed(now: Date = new Date()): Prisma.EventWhereInput {
  return { status: EventStatuses.ON_VOTE, startsAt: { lte: cutoff(now, VOTING_CLOSES_BEFORE_START_MS) } };
}

/** Events on teacher or admin moderation past their deadline: they expire. */
export function moderationPastDeadline(now: Date = new Date()): Prisma.EventWhereInput {
  return {
    OR: [
      { status: EventStatuses.ON_MODERATION, startsAt: { lte: cutoff(now, VOTING_CLOSES_BEFORE_START_MS) } },
      {
        status: EventStatuses.ON_ADMIN_MODERATION,
        startsAt: { lte: cutoff(now, ADMIN_DECIDES_BEFORE_START_MS) },
      },
    ],
  };
}
