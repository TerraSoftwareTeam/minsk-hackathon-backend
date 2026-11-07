import { Prisma, UserRoles } from '../../../prisma/generated/prisma/client';

/** Exp for an event that takes place (FINALIZED). Only pupils collect exp. */
export const ORGANIZER_EXP = 25;
export const PARTICIPANT_EXP = 5;

export type FinalizedExpAward = {
  /** Exp the organizer (initiator) got: ORGANIZER_EXP, or 0 when the organizer is not a pupil. */
  organizerExp: number;
  /** Participants (pupils who voted), the organizer excluded; each got PARTICIPANT_EXP. */
  participantIds: string[];
};

/**
 * Awards the exp of an event that has just become FINALIZED. Call it in the
 * transaction that moves the event to FINALIZED, so it is awarded exactly once.
 * The organizer gets the organizer reward only, even if they also voted.
 */
export async function awardFinalizedExp(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<FinalizedExpAward> {
  const event = await tx.event.findUniqueOrThrow({
    where: { id: eventId },
    select: {
      initiatorId: true,
      initiator: { select: { role: true } },
      votes: { where: { voter: { role: UserRoles.PUPIL } }, select: { voterId: true } },
    },
  });
  const organizerExp = event.initiator.role === UserRoles.PUPIL ? ORGANIZER_EXP : 0;
  const participantIds = event.votes
    .map((vote) => vote.voterId)
    .filter((voterId) => voterId !== event.initiatorId);

  if (organizerExp > 0) {
    await tx.user.update({
      where: { id: event.initiatorId },
      data: { exp: { increment: organizerExp } },
    });
  }
  if (participantIds.length > 0) {
    await tx.user.updateMany({
      where: { id: { in: participantIds } },
      data: { exp: { increment: PARTICIPANT_EXP } },
    });
  }
  return { organizerExp, participantIds };
}
