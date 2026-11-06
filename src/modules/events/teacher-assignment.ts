import { Prisma } from '../../../prisma/generated/prisma/client';

type EventUpdater = { event: { updateMany: Prisma.EventDelegate['updateMany'] } };

/**
 * Gives `teacherId` every event of pupils of `className` that has no teacher
 * yet (created while the class had none), in any status. Returns how many.
 * Idempotent: events that already have a teacher are left alone, so concurrent
 * calls assign each event once.
 *
 * Called after the teacher is committed (AuthService) and after an event
 * without a teacher is committed (EventsService.create): whichever of the two
 * runs last sees the other's row, so no event is left without a teacher.
 */
export async function assignEventsWithoutTeacher(
  prisma: EventUpdater,
  teacherId: string,
  className: string,
): Promise<number> {
  const { count } = await prisma.event.updateMany({
    where: { teacherId: null, initiator: { class: className } },
    data: { teacherId },
  });
  return count;
}
