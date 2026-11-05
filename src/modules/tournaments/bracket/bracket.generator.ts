/**
 * Pure single-elimination bracket generator. No DB access, no Nest.
 *
 * Behaviour by participant count N:
 * - N = 0: empty plan, no games, winner = null. The bracket is finished immediately
 *          and gives no winner (e.g. a school without full teams).
 * - N = 1: no games, the only participant is the winner.
 * - N >= 2: size = smallest power of two >= N, rounds = log2(size).
 *           Seeding is random. There are size - N byes; each first-round game gets
 *           at most one bye (possible because byes < size / 2), so a BYE game always
 *           has exactly one team, which advances immediately.
 *
 * Rounds are 1-based, positions are 0-based within a round. Game (r, p) feeds
 * game (r + 1, floor(p / 2)) into slot A when p is even, slot B when p is odd.
 */

export type Slot = 'A' | 'B';

export type PlannedGameStatus = 'PENDING' | 'READY' | 'BYE';

export interface PlannedGame {
  round: number;
  position: number;
  status: PlannedGameStatus;
  teamA: string | null;
  teamB: string | null;
  /** Set only for BYE games: the team that advances without playing. */
  winner: string | null;
  /** Null only for the final. */
  next: { round: number; position: number; slot: Slot } | null;
}

export interface BracketPlan {
  participantsCount: number;
  size: number;
  rounds: number;
  games: PlannedGame[];
  /** Known immediately only when N = 1. */
  winner: string | null;
}

export type Random = () => number;

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

export function shuffle<T>(
  items: readonly T[],
  random: Random = Math.random,
): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateBracket(
  participants: readonly string[],
  random: Random = Math.random,
): BracketPlan {
  if (new Set(participants).size !== participants.length) {
    throw new Error('Bracket participants must be unique');
  }
  const n = participants.length;
  if (n === 0) {
    return {
      participantsCount: 0,
      size: 0,
      rounds: 0,
      games: [],
      winner: null,
    };
  }
  if (n === 1) {
    return {
      participantsCount: 1,
      size: 1,
      rounds: 0,
      games: [],
      winner: participants[0],
    };
  }

  const size = nextPowerOfTwo(n);
  const rounds = Math.log2(size);
  const firstRoundGames = size / 2;
  const byes = size - n;

  const seeded = shuffle(participants, random);
  // Which first-round games are BYE games: a random subset of size `byes`.
  const byeGames = new Set(
    shuffle([...Array(firstRoundGames).keys()], random).slice(0, byes),
  );

  const games: PlannedGame[] = [];
  const byKey = new Map<string, PlannedGame>();
  const key = (round: number, position: number) => `${round}:${position}`;

  for (let round = 1; round <= rounds; round++) {
    const count = size / 2 ** round;
    for (let position = 0; position < count; position++) {
      const game: PlannedGame = {
        round,
        position,
        status: 'PENDING',
        teamA: null,
        teamB: null,
        winner: null,
        next:
          round < rounds
            ? {
                round: round + 1,
                position: Math.floor(position / 2),
                slot: position % 2 === 0 ? 'A' : 'B',
              }
            : null,
      };
      games.push(game);
      byKey.set(key(round, position), game);
    }
  }

  let cursor = 0;
  for (let position = 0; position < firstRoundGames; position++) {
    const game = byKey.get(key(1, position))!;
    if (byeGames.has(position)) {
      game.teamA = seeded[cursor++];
      game.status = 'BYE';
      game.winner = game.teamA;
    } else {
      game.teamA = seeded[cursor++];
      game.teamB = seeded[cursor++];
      game.status = 'READY';
    }
  }

  // Advance BYE winners right away; their next game may become READY.
  for (const game of games) {
    if (game.status !== 'BYE' || !game.next) continue;
    const next = byKey.get(key(game.next.round, game.next.position))!;
    if (game.next.slot === 'A') next.teamA = game.winner;
    else next.teamB = game.winner;
    if (next.teamA && next.teamB) next.status = 'READY';
  }

  return { participantsCount: n, size, rounds, games, winner: null };
}
