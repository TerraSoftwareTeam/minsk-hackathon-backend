import { EventStatuses } from '../../../prisma/generated/prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Voting (and teacher moderation before it) closes this long before the event starts. */
export const VOTING_CLOSES_BEFORE_START_MS = 2 * DAY_MS;

/**
 * How long before startsAt an event in each pending status expires.
 * Collecting votes ends at the voting deadline; an event that passed the vote
 * keeps the remaining time until the start for the admin decision.
 * Statuses not listed here are final and never expire.
 */
export const EXPIRES_BEFORE_START_MS = {
  [EventStatuses.ON_MODERATION]: VOTING_CLOSES_BEFORE_START_MS,
  [EventStatuses.ON_VOTE]: VOTING_CLOSES_BEFORE_START_MS,
  [EventStatuses.ON_ADMIN_MODERATION]: 0,
} as const;

export type PendingStatus = keyof typeof EXPIRES_BEFORE_START_MS;

export function votingClosesAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() - VOTING_CLOSES_BEFORE_START_MS);
}

/**
 * Events with startsAt at or before this moment are past a deadline that is
 * `leadMs` before the start: startsAt - leadMs <= now  <=>  startsAt <= now + leadMs.
 * Comparing startsAt directly keeps the queries on the (status, startsAt) index.
 */
export function deadlineCutoff(leadMs: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + leadMs);
}

export function isPastDeadline(startsAt: Date, leadMs: number, now: Date = new Date()): boolean {
  return startsAt.getTime() <= deadlineCutoff(leadMs, now).getTime();
}
