import { ForbiddenException } from '@nestjs/common';
import {
  EventAccess,
  User,
  UserRoles,
} from '../../../prisma/generated/prisma/client';

/**
 * Permission rules for one-time events. Checked in services.
 *
 * - ORGANIZATOR: creates events for everyone or for any school, sees and manages all events.
 * - TEACHER: creates events for everyone or for their own school; manages the events
 *   they created. Sees ALL events and the events of their school.
 * - PUPIL: sees ALL events and the events of their school; signs up and cancels
 *   while the event is active.
 */

type EventScope = {
  access: EventAccess;
  creatorId: string | null;
  school: { name: string } | null;
};

export function canCreateEvents(actor: User): boolean {
  return (
    actor.role === UserRoles.ORGANIZATOR || actor.role === UserRoles.TEACHER
  );
}

export function canViewEvent(actor: User, event: EventScope): boolean {
  if (actor.role === UserRoles.ORGANIZATOR) return true;
  if (event.access === EventAccess.ALL) return true;
  return event.school !== null && event.school.name === actor.schoolName;
}

export function canManageEvent(actor: User, event: EventScope): boolean {
  if (actor.role === UserRoles.ORGANIZATOR) return true;
  return event.creatorId !== null && event.creatorId === actor.id;
}

export function assertCanManageEvent(actor: User, event: EventScope): void {
  if (!canManageEvent(actor, event)) {
    throw new ForbiddenException(
      'Only the author of the event or an organizator can do this',
    );
  }
}
