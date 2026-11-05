import { Prisma } from '../../../prisma/generated/prisma/client';

/**
 * Row locks used to serialize tournament state changes (Postgres, READ COMMITTED).
 *
 * - Roster changes take FOR SHARE on the tournament row, so many can run in
 *   parallel, but none can overlap with the school-stage start (FOR UPDATE).
 * - Stage start and result recording take FOR UPDATE on the tournament row, so
 *   "is this the last bracket of the stage?" checks never race each other.
 * - Each roster change also locks its team row FOR UPDATE, so the MAX_TEAM_SIZE
 *   check and the insert are atomic.
 *
 * Always read the state you validate AFTER taking the lock.
 */
export type Tx = Prisma.TransactionClient;

export async function lockTournament(
  tx: Tx,
  tournamentId: string,
  mode: 'update' | 'share',
): Promise<boolean> {
  const rows =
    mode === 'update'
      ? await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`
      : await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR SHARE`;
  return rows.length > 0;
}

export async function lockTeam(tx: Tx, teamId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "TournamentTeam" WHERE id = ${teamId} FOR UPDATE`;
  return rows.length > 0;
}

/** Serializes tournament creation so that only one unfinished tournament exists. */
const CREATE_TOURNAMENT_LOCK = 7_210_001;
export async function lockTournamentCreation(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CREATE_TOURNAMENT_LOCK}::bigint)`;
}

/** Long enough for building every school bracket of the city in one transaction. */
export const LONG_TX = { timeout: 60_000, maxWait: 10_000 } as const;
