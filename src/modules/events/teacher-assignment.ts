import { Prisma } from '../../../prisma/generated/prisma/client';

type EventUpdater = { event: { updateMany: Prisma.EventDelegate['updateMany'] } };

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
