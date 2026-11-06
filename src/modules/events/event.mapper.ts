import { Event, User } from '../../../prisma/generated/prisma/client';
import { EventResponseDto } from './dto/event-response.dto';
import { EventUserResponseDto } from './dto/event-user-response.dto';
import { decisionDeadline } from './event-deadlines';
import { VotingEventResponseDto } from './dto/voting-event-response.dto';

export type EventWithUsers = Event & {
  initiator: User;
  /** Null while the initiator's class has no teacher. */
  teacher: User | null;
  image: { url: string } | null;
  /** Everyone who voted for the event, in the order they voted. */
  votes: { voter: User }[];
};

// Name and surname only: in particular no schoolsById, which is enough to log in as the user.
function toEventUser(user: User): EventUserResponseDto {
  return { name: user.name, surname: user.surname };
}

/** Values computed for a response, not stored in the event row. */
export type EventComputed = {
  successProbability: number;
  likesCount: number;
};

// Explicit field list: never leak extra columns added to the model later.
export function toEventResponse(
  event: EventWithUsers,
  { successProbability, likesCount }: EventComputed,
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
    votingClosesAt: decisionDeadline(event.createdAt),
    successProbability,
    imageUrl: event.image?.url ?? null,
    likesCount,
    initiator: toEventUser(event.initiator),
    teacher: event.teacher ? toEventUser(event.teacher) : null,
    voters: event.votes.map((vote) => toEventUser(vote.voter)),
    votesCount: event.votes.length,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/** Loaded with the caller's own like (0 or 1 rows). */
export type VotingEvent = EventWithUsers & {
  likes: { userId: string }[];
};

/** The event as seen by `viewerId`: whether they voted and liked it. */
export function toVotingEventResponse(
  event: VotingEvent,
  computed: EventComputed,
  viewerId: string,
): VotingEventResponseDto {
  return Object.assign(toEventResponse(event, computed), {
    hasVoted: event.votes.some((vote) => vote.voter.id === viewerId),
    likedByMe: event.likes.length > 0,
  });
}
