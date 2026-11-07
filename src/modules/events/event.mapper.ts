import { Event, User } from '../../../prisma/generated/prisma/client';
import { EventResponseDto } from './dto/event-response.dto';
import { EventUserResponseDto } from './dto/event-user-response.dto';
import { decisionDeadline } from './event-deadlines';
import { VotingEventResponseDto } from './dto/voting-event-response.dto';

export type EventWithUsers = Event & {
  initiator: User;
  teacher: User | null;
  image: { url: string } | null;
  votes: { voter: User }[];
};

function toEventUser(user: User): EventUserResponseDto {
  return { name: user.name, surname: user.surname };
}

export type EventComputed = {
  successProbability: number;
  likesCount: number;
};

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

export type VotingEvent = EventWithUsers & {
  likes: { userId: string }[];
};

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
