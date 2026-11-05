import {
  BracketPlan,
  generateBracket,
  nextPowerOfTwo,
  PlannedGame,
} from './bracket.generator';

const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
const seededRandom = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const realGames = (plan: BracketPlan) =>
  plan.games.filter((g) => g.status !== 'BYE');
const at = (plan: BracketPlan, round: number, position: number) =>
  plan.games.find((g) => g.round === round && g.position === position)!;

/** Plays the whole bracket (team A always wins) and returns the champion. */
const simulate = (
  plan: BracketPlan,
): { champion: string | null; played: Map<string, number> } => {
  const games = plan.games.map((g) => ({ ...g }));
  const find = (r: number, p: number) =>
    games.find((g) => g.round === r && g.position === p)!;
  const played = new Map<string, number>();
  const advance = (game: PlannedGame, winner: string) => {
    if (!game.next) return winner;
    const next = find(game.next.round, game.next.position);
    if (game.next.slot === 'A') next.teamA = winner;
    else next.teamB = winner;
    return null;
  };
  let champion: string | null = plan.winner;
  for (let round = 1; round <= plan.rounds; round++) {
    for (const game of games.filter((g) => g.round === round)) {
      if (game.status === 'BYE') continue; // already advanced by the generator
      expect(game.teamA).not.toBeNull();
      expect(game.teamB).not.toBeNull();
      for (const t of [game.teamA!, game.teamB!])
        played.set(t, (played.get(t) ?? 0) + 1);
      champion = advance(game, game.teamA!) ?? champion;
    }
  }
  return { champion, played };
};

describe('generateBracket', () => {
  it('N = 0: empty bracket without winner', () => {
    const plan = generateBracket([]);
    expect(plan).toEqual({
      participantsCount: 0,
      size: 0,
      rounds: 0,
      games: [],
      winner: null,
    });
  });

  it('N = 1: the only participant wins without games', () => {
    const plan = generateBracket(['solo']);
    expect(plan.games).toHaveLength(0);
    expect(plan.winner).toBe('solo');
  });

  it('N = 2: a single READY final', () => {
    const plan = generateBracket(teams(2));
    expect(plan.size).toBe(2);
    expect(plan.rounds).toBe(1);
    expect(plan.games).toHaveLength(1);
    expect(plan.games[0]).toMatchObject({ status: 'READY', next: null });
    expect(new Set([plan.games[0].teamA, plan.games[0].teamB])).toEqual(
      new Set(teams(2)),
    );
  });

  it('N = 3: one BYE whose winner is already placed in the final', () => {
    const plan = generateBracket(teams(3), seededRandom(1));
    const bye = plan.games.find((g) => g.status === 'BYE')!;
    const final = at(plan, 2, 0);
    expect(bye.winner).toBe(bye.teamA);
    expect(bye.teamB).toBeNull();
    expect([final.teamA, final.teamB]).toContain(bye.winner);
    expect(final.status).toBe('PENDING');
  });

  it('N = 5: two BYE winners meeting in round 2 make that game READY', () => {
    // Try many seeds; whenever two BYEs feed the same game it must be READY.
    for (let seed = 0; seed < 200; seed++) {
      const plan = generateBracket(teams(5), seededRandom(seed));
      for (const game of plan.games.filter((g) => g.round === 2)) {
        const feeders = plan.games.filter(
          (g) => g.next?.round === 2 && g.next.position === game.position,
        );
        const byeFeeders = feeders.filter((g) => g.status === 'BYE').length;
        expect(game.status).toBe(byeFeeders === 2 ? 'READY' : 'PENDING');
      }
    }
  });

  it('throws on duplicate participants', () => {
    expect(() => generateBracket(['a', 'a'])).toThrow();
  });

  it('seeding is random', () => {
    const firstPairs = new Set(
      Array.from({ length: 30 }, (_, seed) => {
        const g = at(generateBracket(teams(8), seededRandom(seed)), 1, 0);
        return [g.teamA!, g.teamB!]
          .sort((a, b) => a.localeCompare(b))
          .join('-');
      }),
    );
    expect(firstPairs.size).toBeGreaterThan(1);
  });

  describe.each([2, 3, 5, 8, 9, 16, 17, 100])('invariants for N = %i', (n) => {
    const seeds = [1, 2, 3, 42, 1337];

    it.each(seeds)('seed %i', (seed) => {
      const plan = generateBracket(teams(n), seededRandom(seed));
      const size = nextPowerOfTwo(n);

      // size and rounds
      expect(plan.size).toBe(size);
      expect(plan.rounds).toBe(Math.log2(size));
      expect(plan.games).toHaveLength(size - 1);

      // real (non-BYE) games = N - 1
      expect(realGames(plan)).toHaveLength(n - 1);

      // BYEs only in round 1, size - N of them, each with exactly one team
      const byes = plan.games.filter((g) => g.status === 'BYE');
      expect(byes).toHaveLength(size - n);
      for (const g of byes) {
        expect(g.round).toBe(1);
        expect(g.teamA).not.toBeNull();
        expect(g.teamB).toBeNull();
        expect(g.winner).toBe(g.teamA);
      }

      // every participant appears exactly once in round 1 (in a real game or a BYE)
      const firstRound = plan.games.filter((g) => g.round === 1);
      const seen = firstRound
        .flatMap((g) => [g.teamA, g.teamB])
        .filter((t): t is string => t !== null);
      const byName = (a: string, b: string) => a.localeCompare(b);
      expect(seen.sort(byName)).toEqual(teams(n).sort(byName));

      // every non-final game references an existing game of the next round
      for (const g of plan.games) {
        if (g.round === plan.rounds) {
          expect(g.next).toBeNull();
          continue;
        }
        expect(g.next).not.toBeNull();
        expect(g.next!.round).toBe(g.round + 1);
        expect(at(plan, g.next!.round, g.next!.position)).toBeDefined();
      }
      // each game of round > 1 has exactly two feeders, one per slot
      for (const g of plan.games.filter((x) => x.round > 1)) {
        const feeders = plan.games.filter(
          (x) => x.next?.round === g.round && x.next.position === g.position,
        );
        expect(feeders.map((f) => f.next!.slot).sort()).toEqual(['A', 'B']);
      }

      // exactly one game in the final round
      expect(plan.games.filter((g) => g.round === plan.rounds)).toHaveLength(1);

      // READY iff both teams known (non-BYE games)
      for (const g of realGames(plan)) {
        expect(g.status).toBe(g.teamA && g.teamB ? 'READY' : 'PENDING');
      }

      // playing the bracket out: everyone plays, one champion, N - 1 games played
      const { champion, played } = simulate(plan);
      expect(teams(n)).toContain(champion);
      expect([...played.values()].reduce((a, b) => a + b, 0) / 2).toBe(n - 1);
      expect(played.size).toBe(n);
    });
  });
});
