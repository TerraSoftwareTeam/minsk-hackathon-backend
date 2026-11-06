import { Event, User } from '../../../prisma/generated/prisma/client';
import { toUserResponse } from '../auth/user.mapper';
import { EventResponseDto } from './dto/event-response.dto';

export type EventWithUsers = Event & { initiator: User; teacher: User };

// Explicit field list: never leak extra columns added to the model later.
export function toEventResponse(event: EventWithUsers): EventResponseDto {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    scope: event.scope,
    status: event.status,
    declineReason: event.declineReason,
    voteThreshold: event.voteThreshold,
    initiator: toUserResponse(event.initiator),
    teacher: toUserResponse(event.teacher),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}
