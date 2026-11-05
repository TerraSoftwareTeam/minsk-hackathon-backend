import {
  District,
  StageType,
} from '../../../../prisma/generated/prisma/client';
import { STAGE_ORDER } from '../stage-engine.service';
import { TOURNAMENT_TIME_ZONE } from '../../../common/time/minsk-time';
import {
  TournamentTreeDto,
  TreeBracketDto,
  TreeDistrictDto,
  TreeMatchDto,
  TreeRoundDto,
  TreeSlotDto,
  TreeStageDto,
  TreeTeamDto,
} from './tournament-tree.dto';

/**
 * Pure mapping from DB rows to the bracket tree the frontend renders.
 *
 * Layout: a bracket is a grid of `roundsCount` columns and `gridRows` rows, one row
 * per first-round match. Match (round r, position p) occupies column r - 1, rows
 * [p * 2^(r-1), (p + 1) * 2^(r-1)), so it is vertically centered between its two
 * feeders. Lines go from each match to `nextMatchId`.
 */

export const STAGE_NAMES: Record<StageType, string> = {
  SCHOOL: 'Школьный этап',
  DISTRICT: 'Районный этап',
  CITY: 'Городской этап',
};

export const DISTRICT_NAMES: Record<District, string> = {
  CENTRAL: 'Центральный',
  FRUNZENSKY: 'Фрунзенский',
  LENINSKY: 'Ленинский',
  MOSKOVSKY: 'Московский',
  OKTYABRSKY: 'Октябрьский',
  PERVOMAYSKY: 'Первомайский',
  PARTIZANSKY: 'Партизанский',
  SOVETSKY: 'Советский',
  ZAVODSKOY: 'Заводской',
};

/** "Финал", "Полуфинал", "1/4 финала", "1/8 финала", ... */
export function roundName(round: number, roundsCount: number): string {
  const fromFinal = roundsCount - round;
  if (fromFinal === 0) return 'Финал';
  if (fromFinal === 1) return 'Полуфинал';
  return `1/${2 ** fromFinal} финала`;
}

// ---- input shapes (subset of Prisma payloads) ----

export interface TeamRow {
  id: string;
  name: string;
  school: { id: string; name: string; district: District };
}

export interface GameRow {
  id: string;
  round: number;
  position: number;
  status: string;
  teamA: TeamRow | null;
  teamB: TeamRow | null;
  scoreA: number | null;
  scoreB: number | null;
  winnerTeamId: string | null;
  nextGameId: string | null;
  nextSlot: 'A' | 'B' | null;
  finishedAt: Date | null;
}

export interface BracketRow {
  id: string;
  status: string;
  participantsCount: number;
  size: number;
  rounds: number;
  district: District | null;
  school: { id: string; name: string; district: District } | null;
  winnerTeam: TeamRow | null;
  games: GameRow[];
}

export interface StageRow {
  type: StageType;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  brackets: BracketRow[];
}

export interface TournamentRow {
  id: string;
  name: string;
  status: string;
  currentStage: StageType | null;
  schoolStageStartAt: Date;
  winnerTeam: TeamRow | null;
}

export interface DistrictResultRow {
  district: District | null;
  status: string;
  winnerTeam: TeamRow | null;
}

// ---- mapping ----

const toTeam = (t: TeamRow | null): TreeTeamDto | null =>
  t
    ? {
        id: t.id,
        name: t.name,
        school: {
          id: t.school.id,
          name: t.school.name,
          district: t.school.district,
        },
      }
    : null;

export function buildBracketTree(
  stage: StageType,
  bracket: BracketRow,
): TreeBracketDto {
  const roundsCount = bracket.rounds;
  const byId = new Map(bracket.games.map((g) => [g.id, g]));
  const feeders = new Map<string, { A: GameRow | null; B: GameRow | null }>();
  for (const g of bracket.games) {
    if (!g.nextGameId || !g.nextSlot) continue;
    const entry = feeders.get(g.nextGameId) ?? { A: null, B: null };
    entry[g.nextSlot] = g;
    feeders.set(g.nextGameId, entry);
  }

  const slot = (game: GameRow, side: 'A' | 'B'): TreeSlotDto => {
    const team = side === 'A' ? game.teamA : game.teamB;
    const score = side === 'A' ? game.scoreA : game.scoreB;
    const source = feeders.get(game.id)?.[side] ?? null;
    let label: string;
    if (team) label = team.name;
    else if (game.status === 'BYE') label = 'BYE';
    else if (source)
      label = `Победитель: ${roundName(source.round, roundsCount)}, матч ${source.position + 1}`;
    else label = 'Ожидается';
    return {
      team: toTeam(team),
      score,
      isWinner: team !== null && game.winnerTeamId === team.id,
      sourceMatchId: source?.id ?? null,
      label,
    };
  };

  const toMatch = (g: GameRow): TreeMatchDto => {
    const span = 2 ** (g.round - 1);
    return {
      id: g.id,
      round: g.round,
      position: g.position,
      label: `Матч ${g.position + 1}`,
      status: g.status,
      isBye: g.status === 'BYE',
      isFinal: g.round === roundsCount,
      teamA: slot(g, 'A'),
      teamB: slot(g, 'B'),
      winnerTeamId: g.winnerTeamId,
      nextMatchId: g.nextGameId && byId.has(g.nextGameId) ? g.nextGameId : null,
      nextSlot: g.nextSlot,
      layout: {
        column: g.round - 1,
        rowStart: g.position * span,
        rowSpan: span,
      },
      finishedAt: g.finishedAt,
    };
  };

  const rounds: TreeRoundDto[] = [];
  for (let round = 1; round <= roundsCount; round++) {
    rounds.push({
      round,
      name: roundName(round, roundsCount),
      matches: bracket.games
        .filter((g) => g.round === round)
        .sort((a, b) => a.position - b.position)
        .map(toMatch),
    });
  }

  const finished = bracket.status === 'FINISHED';
  const outcome: TreeBracketDto['outcome'] =
    bracket.participantsCount === 0
      ? 'NO_PARTICIPANTS'
      : bracket.participantsCount === 1 && bracket.winnerTeam
        ? 'WALKOVER'
        : finished && bracket.winnerTeam
          ? 'WINNER'
          : 'PLAYING';

  const district =
    bracket.district ??
    (stage === StageType.SCHOOL ? (bracket.school?.district ?? null) : null);
  const title =
    stage === StageType.SCHOOL
      ? (bracket.school?.name ?? 'Школа')
      : stage === StageType.DISTRICT
        ? `${DISTRICT_NAMES[bracket.district!]} район`
        : 'Город';

  return {
    id: bracket.id,
    stage,
    title,
    school: bracket.school ? { ...bracket.school } : null,
    district,
    status: bracket.status,
    participantsCount: bracket.participantsCount,
    size: bracket.size,
    roundsCount,
    gridRows: bracket.size / 2 >= 1 ? bracket.size / 2 : 0,
    winner: toTeam(bracket.winnerTeam),
    outcome,
    rounds,
  };
}

export function buildDistrictSummary(
  districtBrackets: DistrictResultRow[],
): TreeDistrictDto[] {
  return (Object.keys(DISTRICT_NAMES) as District[]).map((district) => {
    const bracket = districtBrackets.find((b) => b.district === district);
    const base = { district, name: DISTRICT_NAMES[district] };
    if (!bracket || bracket.status !== 'FINISHED')
      return { ...base, status: 'PENDING', team: null };
    return bracket.winnerTeam
      ? { ...base, status: 'QUALIFIED', team: toTeam(bracket.winnerTeam) }
      : { ...base, status: 'NO_WINNER', team: null };
  });
}

export function buildTournamentTree(
  tournament: TournamentRow,
  stages: StageRow[],
  options: { onlyStage?: StageType; districtResults: DistrictResultRow[] },
): TournamentTreeDto {
  const types = options.onlyStage ? [options.onlyStage] : STAGE_ORDER;
  const treeStages: TreeStageDto[] = types.map((type) => {
    const stage = stages.find((s) => s.type === type);
    const result: TreeStageDto = {
      type,
      name: STAGE_NAMES[type],
      status: stage?.status ?? 'PENDING',
      startedAt: stage?.startedAt ?? null,
      finishedAt: stage?.finishedAt ?? null,
      brackets: (stage?.brackets ?? []).map((b) => buildBracketTree(type, b)),
    };
    if (type === StageType.CITY)
      result.districts = buildDistrictSummary(options.districtResults);
    return result;
  });

  return {
    id: tournament.id,
    name: tournament.name,
    status: tournament.status,
    currentStage: tournament.currentStage,
    schoolStageStartAt: tournament.schoolStageStartAt,
    timeZone: TOURNAMENT_TIME_ZONE,
    winner: toTeam(tournament.winnerTeam),
    stages: treeStages,
  };
}
