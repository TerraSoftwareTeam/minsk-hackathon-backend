import {
  District,
  StageType,
} from '../../../../prisma/generated/prisma/client';
import { generateBracket } from '../bracket/bracket.generator';
import {
  BracketRow,
  buildBracketTree,
  buildDistrictSummary,
  buildTournamentTree,
  GameRow,
  roundName,
  TeamRow,
} from './tournament-tree.mapper';

const school = { id: 's1', name: 'Школа №1', district: District.CENTRAL };
const team = (id: string): TeamRow => ({ id, name: `Team ${id}`, school });

/** Turns a generated plan into DB-like rows (ids "r:p"). */
const bracketFrom = (n: number, seed = 0.42): BracketRow => {
  const plan = generateBracket(
    Array.from({ length: n }, (_, i) => `t${i + 1}`),
    () => seed,
  );
  const games: GameRow[] = plan.games.map((g) => ({
    id: `${g.round}:${g.position}`,
    round: g.round,
    position: g.position,
    status: g.status,
    teamA: g.teamA ? team(g.teamA) : null,
    teamB: g.teamB ? team(g.teamB) : null,
    scoreA: null,
    scoreB: null,
    winnerTeamId: g.winner,
    nextGameId: g.next ? `${g.next.round}:${g.next.position}` : null,
    nextSlot: g.next?.slot ?? null,
    finishedAt: null,
  }));
  return {
    id: 'b1',
    status: plan.games.length ? 'IN_PROGRESS' : 'FINISHED',
    participantsCount: n,
    size: plan.size,
    rounds: plan.rounds,
    district: null,
    school,
    winnerTeam: plan.winner ? team(plan.winner) : null,
    games,
  };
};

describe('roundName', () => {
  it.each([
    [3, 3, 'Финал'],
    [2, 3, 'Полуфинал'],
    [1, 3, '1/4 финала'],
    [1, 5, '1/16 финала'],
  ])('round %i of %i → %s', (round, total, name) => {
    expect(roundName(round, total)).toBe(name);
  });
});

describe('buildBracketTree', () => {
  it('groups matches into ordered rounds with names', () => {
    const tree = buildBracketTree(StageType.SCHOOL, bracketFrom(8));
    expect(tree.rounds.map((r) => r.name)).toEqual([
      '1/4 финала',
      'Полуфинал',
      'Финал',
    ]);
    expect(tree.rounds.map((r) => r.matches.length)).toEqual([4, 2, 1]);
    expect(tree.rounds[0].matches.map((m) => m.position)).toEqual([0, 1, 2, 3]);
    expect(tree.rounds[2].matches[0].isFinal).toBe(true);
    expect(tree.gridRows).toBe(4);
    expect(tree.title).toBe('Школа №1');
  });

  it('layout centers each match between its feeders', () => {
    const tree = buildBracketTree(StageType.SCHOOL, bracketFrom(16));
    const all = tree.rounds.flatMap((r) => r.matches);
    for (const m of all) {
      expect(m.layout.column).toBe(m.round - 1);
      expect(m.layout.rowSpan).toBe(2 ** (m.round - 1));
      if (m.round === 1) continue;
      const a = all.find((x) => x.id === m.teamA.sourceMatchId)!;
      const b = all.find((x) => x.id === m.teamB.sourceMatchId)!;
      expect(m.layout.rowStart).toBe(a.layout.rowStart);
      expect(m.layout.rowStart + m.layout.rowSpan).toBe(
        b.layout.rowStart + b.layout.rowSpan,
      );
    }
    const final = tree.rounds.at(-1)!.matches[0];
    expect(final.layout).toEqual({ column: 3, rowStart: 0, rowSpan: 8 });
  });

  it('links feeders and next matches both ways', () => {
    const tree = buildBracketTree(StageType.SCHOOL, bracketFrom(5));
    const all = tree.rounds.flatMap((r) => r.matches);
    for (const m of all) {
      if (m.nextMatchId) {
        const next = all.find((x) => x.id === m.nextMatchId)!;
        const slot = m.nextSlot === 'A' ? next.teamA : next.teamB;
        expect(slot.sourceMatchId).toBe(m.id);
      } else {
        expect(m.isFinal).toBe(true);
      }
      if (m.round === 1) {
        expect(m.teamA.sourceMatchId).toBeNull();
        expect(m.teamB.sourceMatchId).toBeNull();
      }
    }
  });

  it('labels: team name, BYE, and where an unknown team comes from', () => {
    const tree = buildBracketTree(StageType.SCHOOL, bracketFrom(3));
    const bye = tree.rounds[0].matches.find((m) => m.isBye)!;
    expect(bye.teamA.label).toMatch(/^Team t/);
    expect(bye.teamA.isWinner).toBe(true);
    expect(bye.teamB).toMatchObject({ team: null, label: 'BYE' });

    const real = tree.rounds[0].matches.find((m) => !m.isBye)!;
    const final = tree.rounds[1].matches[0];
    const waiting = real.nextSlot === 'A' ? final.teamA : final.teamB;
    expect(waiting.team).toBeNull();
    expect(waiting.label).toBe(
      `Победитель: Полуфинал, матч ${real.position + 1}`,
    );
  });

  it('outcome for N = 0, 1 and a playing bracket', () => {
    expect(buildBracketTree(StageType.SCHOOL, bracketFrom(0))).toMatchObject({
      outcome: 'NO_PARTICIPANTS',
      rounds: [],
      gridRows: 0,
      winner: null,
    });
    expect(buildBracketTree(StageType.SCHOOL, bracketFrom(1))).toMatchObject({
      outcome: 'WALKOVER',
      rounds: [],
      winner: { id: 't1' },
    });
    expect(buildBracketTree(StageType.SCHOOL, bracketFrom(4)).outcome).toBe(
      'PLAYING',
    );
  });

  it('district and city titles', () => {
    const b = { ...bracketFrom(2), school: null };
    expect(
      buildBracketTree(StageType.DISTRICT, {
        ...b,
        district: District.LENINSKY,
      }).title,
    ).toBe('Ленинский район');
    expect(buildBracketTree(StageType.CITY, b).title).toBe('Город');
  });
});

describe('buildTournamentTree', () => {
  const tournament = {
    id: 't',
    name: 'T',
    status: 'IN_PROGRESS',
    currentStage: StageType.SCHOOL,
    schoolStageStartAt: new Date(0),
    winnerTeam: null,
  };

  it('always lists the three stages in order, empty when not started', () => {
    const tree = buildTournamentTree(
      tournament,
      [
        {
          type: StageType.SCHOOL,
          status: 'IN_PROGRESS',
          startedAt: null,
          finishedAt: null,
          brackets: [bracketFrom(2)],
        },
      ],
      { districtResults: [] },
    );
    expect(
      tree.stages.map((s) => [s.type, s.status, s.brackets.length]),
    ).toEqual([
      ['SCHOOL', 'IN_PROGRESS', 1],
      ['DISTRICT', 'PENDING', 0],
      ['CITY', 'PENDING', 0],
    ]);
    expect(tree.stages[2].districts).toHaveLength(9);
    expect(tree.stages[0].districts).toBeUndefined();
  });

  it('district summary marks qualified and missing districts', () => {
    const summary = buildDistrictSummary([
      { district: District.CENTRAL, status: 'FINISHED', winnerTeam: team('x') },
      { district: District.SOVETSKY, status: 'FINISHED', winnerTeam: null },
      { district: District.LENINSKY, status: 'IN_PROGRESS', winnerTeam: null },
    ]);
    const by = Object.fromEntries(summary.map((d) => [d.district, d]));
    expect(by.CENTRAL).toMatchObject({
      status: 'QUALIFIED',
      name: 'Центральный',
      team: { id: 'x' },
    });
    expect(by.SOVETSKY.status).toBe('NO_WINNER');
    expect(by.LENINSKY.status).toBe('PENDING');
    expect(by.ZAVODSKOY.status).toBe('PENDING');
  });
});
