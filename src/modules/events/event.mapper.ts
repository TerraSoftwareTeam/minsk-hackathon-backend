import { Event, User } from '../../../prisma/generated/prisma/client';
import { toUserResponse } from '../auth/user.mapper';
import { EventResponseDto } from './dto/event-response.dto';
import { votingClosesAt } from './event-deadlines';
import { VotingEventResponseDto } from './dto/voting-event-response.dto';

export type EventWithUsers = Event & {
  initiator: User;
  teacher: User;
  image: { url: string } | null;
};

// Explicit field list: never leak extra columns added to the model later.
export function toEventResponse(
  event: EventWithUsers,
  successProbability: number,
): EventResponseDto {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    scope: event.scope,
    category: event.category,
    status: event.status,
    declineReason: event.declineReason,
    voteThreshold: event.voteThreshold,
    startsAt: event.startsAt,
    votingClosesAt: votingClosesAt(event.startsAt),
    successProbability,
    imageUrl: event.image?.url ?? null,
    initiator: toUserResponse(event.initiator),
    teacher: toUserResponse(event.teacher),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/** Loaded with the caller's own vote (0 or 1 rows) and the total vote count. */
export type VotingEvent = EventWithUsers & {
  votes: { voterId: string }[];
  _count: { votes: number };
};

export function toVotingEventResponse(
  event: VotingEvent,
  successProbability: number,
): VotingEventResponseDto {
  return Object.assign(toEventResponse(event, successProbability), {
    votesCount: event._count.votes,
    hasVoted: event.votes.length > 0,
  });
}
