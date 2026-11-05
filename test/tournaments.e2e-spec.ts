/**
 * Full tournament flow against a real Postgres database.
 *
 * DESTRUCTIVE: truncates all tables. Runs only when DATABASE_NAME ends with "-test":
 *   DATABASE_NAME=hackathon-db-test npx prisma migrate deploy
 *   DATABASE_NAME=hackathon-db-test npm run test:e2e -- tournaments
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import {
  District,
  GameStatus,
  StageStatus,
  StageType,
  TournamentStatus,
  User,
  UserRoles,
} from '../prisma/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { GamesService } from '../src/modules/tournaments/games.service';
import { StageEngineService } from '../src/modules/tournaments/stage-engine.service';
import { TeamsService } from '../src/modules/tournaments/teams.service';
import { TournamentsService } from '../src/modules/tournaments/tournaments.service';

const enabled = (process.env.DATABASE_NAME ?? '').endsWith('-test');
const suite = enabled ? describe : describe.skip;

suite('Tournament flow (real DB)', () => {
  jest.setTimeout(60_000);

  let prisma: PrismaService;
  let tournaments: TournamentsService;
  let teams: TeamsService;
  let games: GamesService;
  let engine: StageEngineService;

  let organizator: User;
  const teachers: Record<string, User> = {};
  const pupils: Record<string, User[]> = {};
  let counter = 0;

  const status = async (p: Promise<unknown>) => {
    try {
      await p;
      return 200;
    } catch (e) {
      return (e as { status?: number }).status ?? 500;
    }
  };

  const makeUser = (role: UserRoles, schoolName: string | null) =>
    prisma.user.create({
      data: {
        name: `n${++counter}`,
        surname: `s${counter}`,
        fathersName: 'f',
        role,
        schoolsById: schoolName ? `sid-${counter}` : null,
        class: schoolName ? '10A' : null,
        schoolName,
      },
    });

  /** Plays every READY game of a bracket (team A wins 2:1) until the bracket finishes. */
  const playBracket = async (bracketId: string, actor: User) => {
    for (;;) {
      const ready = await prisma.tournamentGame.findMany({
        where: { bracketId, status: GameStatus.READY },
      });
      if (ready.length === 0) return;
      for (const g of ready)
        await games.recordResult(actor, g.id, { scoreA: 2, scoreB: 1 });
    }
  };

  const schools: Record<string, { name: string; district: District }> = {
    A1: { name: 'A1', district: District.CENTRAL },
    A2: { name: 'A2', district: District.CENTRAL },
    A3: { name: 'A3', district: District.CENTRAL },
    B1: { name: 'B1', district: District.LENINSKY },
    C1: { name: 'C1', district: District.SOVETSKY },
  };

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService(process.env));
    await prisma.$connect();
    await prisma.$executeRawUnsafe(
      'TRUNCATE "TournamentGame", "TournamentBracket", "TournamentStage", "TeamMember", "TournamentTeam", "Tournament", "User", "School" CASCADE',
    );
    engine = new StageEngineService(prisma);
    tournaments = new TournamentsService(prisma);
    teams = new TeamsService(prisma);
    games = new GamesService(prisma, engine);

    await prisma.school.createMany({ data: Object.values(schools) });
    organizator = await makeUser(UserRoles.ORGANIZATOR, null);
    for (const key of Object.keys(schools)) {
      teachers[key] = await makeUser(UserRoles.TEACHER, key);
      pupils[key] = [];
      for (let i = 0; i < 12; i++)
        pupils[key].push(await makeUser(UserRoles.PUPIL, key));
    }
  });

  afterAll(async () => prisma?.$disconnect());

  let tournamentId: string;

  it('only an organizator creates a tournament, and only one at a time', async () => {
    const dto = {
      name: 'T',
      minTeamSize: 2,
      maxTeamSize: 3,
      schoolStageStartAt: '2099-01-01T10:00',
    };
    expect(await status(tournaments.create(teachers.A1, dto))).toBe(403);
    expect(
      await status(
        tournaments.create(organizator, {
          ...dto,
          schoolStageStartAt: '2000-01-01T10:00',
        }),
      ),
    ).toBe(400);

    const t = await tournaments.create(organizator, dto);
    tournamentId = t.id;
    expect(t.schoolStageStartAt.toISOString()).toBe('2099-01-01T07:00:00.000Z'); // Minsk = UTC+3
    expect(await status(tournaments.create(organizator, dto))).toBe(409);
  });

  it('team rules: creation, joining, limits, creator rights', async () => {
    const [p0, p1, p2, p3] = pupils.A1;
    expect(await status(teams.create(teachers.A1, tournamentId, 'x'))).toBe(
      403,
    );

    const team = await teams.create(p0, tournamentId, 'Owls');
    expect(team.creatorId).toBe(p0.id);
    expect(team.isFull).toBe(false);
    expect(await status(teams.create(p0, tournamentId, 'Second'))).toBe(409); // one team per pupil
    expect(await status(teams.create(p1, tournamentId, 'Owls'))).toBe(409); // name taken

    await teams.addMember(p1, team.id, p1.id); // self-join, no approval
    expect(
      await status(teams.addMember(pupils.B1[0], team.id, pupils.B1[0].id)),
    ).toBe(403); // other school
    expect(
      await status(teams.addMember(pupils.A1[5], team.id, pupils.A1[6].id)),
    ).toBe(403); // not creator
    expect(await status(teams.rename(teachers.B1, team.id, 'Nope'))).toBe(403); // other school teacher
    await teams.rename(teachers.A1, team.id, 'Owls!');
    await teams.addMember(teachers.A1, team.id, p2.id);
    expect(await status(teams.addMember(p3, team.id, p3.id))).toBe(409); // max 3

    // creator cannot leave while others remain; transfer first
    expect(await status(teams.removeMember(p0, team.id, p0.id))).toBe(409);
    expect(await status(teams.transferCreator(p1, team.id, p2.id))).toBe(403);
    await teams.transferCreator(p0, team.id, p1.id);
    const after = await teams.removeMember(p0, team.id, p0.id);
    expect(after!.creatorId).toBe(p1.id);
    expect(after!.members).toHaveLength(2);
    expect(after!.isFull).toBe(true);

    // a sole creator leaving deletes the team
    const solo = await teams.create(p0, tournamentId, 'Solo');
    expect(await teams.removeMember(p0, solo.id, p0.id)).toBeNull();
    expect(await status(teams.findOne(solo.id))).toBe(404);
  });

  it('parallel joins never exceed MAX_TEAM_SIZE', async () => {
    const creator = pupils.A2[0];
    const team = await teams.create(creator, tournamentId, 'Race');
    const joiners = pupils.A2.slice(1, 9);
    const results = await Promise.all(
      joiners.map((p) => status(teams.addMember(p, team.id, p.id))),
    );
    expect(results.filter((s) => s === 200)).toHaveLength(2);
    expect(results.filter((s) => s === 409)).toHaveLength(6);
    expect((await teams.findOne(team.id)).members).toHaveLength(3);
  });

  it('parallel team creation by one pupil yields one team', async () => {
    const p = pupils.A3[11];
    const results = await Promise.all(
      ['R1', 'R2', 'R3'].map((n) => status(teams.create(p, tournamentId, n))),
    );
    expect(results.filter((s) => s === 200)).toHaveLength(1);
    const mine = await prisma.teamMember.findMany({ where: { userId: p.id } });
    expect(mine).toHaveLength(1);
    await teams.removeMember(p, mine[0].teamId, p.id); // clean up: sole creator leaves
  });

  const fullTeam = async (school: string, name: string, from: number) => {
    const [creator, mate] = pupils[school].slice(from, from + 2);
    const t = await teams.create(creator, tournamentId, name);
    await teams.addMember(mate, t.id, mate.id);
    return t.id;
  };

  it('prepares the field', async () => {
    // A1: Owls (full) + 2 more full + 1 incomplete; A2: Race; A3: 2 full; B1: 1 full; C1: incomplete only
    await fullTeam('A1', 'A1-b', 4);
    await fullTeam('A1', 'A1-c', 6);
    await teams.create(pupils.A1[8], tournamentId, 'A1-incomplete');
    await fullTeam('A3', 'A3-a', 0);
    await fullTeam('A3', 'A3-b', 2);
    await fullTeam('B1', 'B1-a', 0);
    await teams.create(pupils.C1[0], tournamentId, 'C1-incomplete');
  });

  it('school stage starts once, removes incomplete teams and locks rosters', async () => {
    expect(await engine.startSchoolStageIfDue(tournamentId)).toBe(false); // not due yet

    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { schoolStageStartAt: new Date(Date.now() - 1000) },
    });
    const owls = (await teams.list(tournamentId)).find(
      (t) => t.name === 'Owls!',
    )!;
    expect(
      await status(teams.addMember(pupils.A1[10], owls.id, pupils.A1[10].id)),
    ).toBe(409); // start time passed

    const started = await Promise.all([
      engine.startSchoolStageIfDue(tournamentId),
      engine.startSchoolStageIfDue(tournamentId),
    ]);
    expect(started.filter(Boolean)).toHaveLength(1);

    const remaining = (await teams.list(tournamentId))
      .map((t) => t.name)
      .sort();
    expect(remaining).toEqual([
      'A1-b',
      'A1-c',
      'A3-a',
      'A3-b',
      'B1-a',
      'Owls!',
      'Race',
    ]);
    expect(
      await prisma.teamMember.count({ where: { userId: pupils.C1[0].id } }),
    ).toBe(0); // released

    expect(await status(teams.remove(teachers.A1, owls.id))).toBe(409);
    expect(
      await status(teams.removeMember(pupils.A1[1], owls.id, pupils.A1[1].id)),
    ).toBe(409);
    expect(
      await status(
        tournaments.update(organizator, tournamentId, {
          schoolStageStartAt: '2099-01-01T10:00',
        }),
      ),
    ).toBe(409);
    expect(await status(engine.startSchoolStageIfDue(tournamentId))).toBe(200); // no restart, no error

    const stage = await tournaments.getStage(tournamentId, StageType.SCHOOL);
    expect(stage.status).toBe(StageStatus.IN_PROGRESS);
    const bySchool = Object.fromEntries(
      stage.brackets.map((b) => [b.school!.name, b]),
    );
    expect(bySchool.A1).toMatchObject({
      participantsCount: 3,
      size: 4,
      rounds: 2,
      status: 'IN_PROGRESS',
    });
    expect(
      bySchool.A1.games.filter((g) => g.status !== GameStatus.BYE),
    ).toHaveLength(2);
    expect(bySchool.A2).toMatchObject({
      participantsCount: 1,
      status: 'FINISHED',
    });
    expect(bySchool.A2.winnerTeam!.name).toBe('Race');
    expect(bySchool.C1).toMatchObject({
      participantsCount: 0,
      status: 'FINISHED',
      winnerTeamId: null,
    });
  });

  it('results: permissions, no draws, double submit, corrections', async () => {
    const stage = await tournaments.getStage(tournamentId, StageType.SCHOOL);
    const a1 = stage.brackets.find((b) => b.school!.name === 'A1')!;
    const semi = a1.games.find(
      (g) => g.round === 1 && g.status === GameStatus.READY,
    )!;

    expect(
      await status(
        games.recordResult(pupils.A1[1], semi.id, { scoreA: 1, scoreB: 0 }),
      ),
    ).toBe(403);
    expect(
      await status(
        games.recordResult(teachers.B1, semi.id, { scoreA: 1, scoreB: 0 }),
      ),
    ).toBe(403);
    expect(
      await status(
        games.recordResult(teachers.A1, semi.id, { scoreA: 1, scoreB: 1 }),
      ),
    ).toBe(400);

    const double = await Promise.all([
      status(
        games.recordResult(teachers.A1, semi.id, { scoreA: 3, scoreB: 0 }),
      ),
      status(
        games.recordResult(organizator, semi.id, { scoreA: 0, scoreB: 3 }),
      ),
    ]);
    expect(double.sort((a, b) => a - b)).toEqual([200, 409]);

    const played = await games.findOne(semi.id);
    const final = await prisma.tournamentGame.findUniqueOrThrow({
      where: { id: played.nextGameId! },
    });
    expect(final.status).toBe(GameStatus.READY); // other semi was a BYE
    expect([final.teamAId, final.teamBId]).toContain(played.winnerTeamId);

    // correction flips the winner while the final is not played
    const flipped =
      played.scoreA! > played.scoreB!
        ? { scoreA: 0, scoreB: 5 }
        : { scoreA: 5, scoreB: 0 };
    const corrected = await games.correctResult(teachers.A1, semi.id, flipped);
    expect(corrected.winnerTeamId).not.toBe(played.winnerTeamId);
    const finalAfter = await prisma.tournamentGame.findUniqueOrThrow({
      where: { id: final.id },
    });
    expect([finalAfter.teamAId, finalAfter.teamBId]).toContain(
      corrected.winnerTeamId,
    );
    expect([finalAfter.teamAId, finalAfter.teamBId]).not.toContain(
      played.winnerTeamId,
    );

    await games.recordResult(teachers.A1, final.id, { scoreA: 2, scoreB: 1 });
    // the semi's winner has played the final: changing the semi winner is refused, score-only fix is fine
    expect(
      await status(
        games.correctResult(teachers.A1, semi.id, {
          scoreA: flipped.scoreB,
          scoreB: flipped.scoreA,
        }),
      ),
    ).toBe(409);
    expect(
      await status(
        games.correctResult(teachers.A1, semi.id, {
          scoreA: flipped.scoreA * 2,
          scoreB: flipped.scoreB * 2,
        }),
      ),
    ).toBe(200);
  });

  it('last school final starts the district stage automatically', async () => {
    const stage = await tournaments.getStage(tournamentId, StageType.SCHOOL);
    const a3 = stage.brackets.find((b) => b.school!.name === 'A3')!;
    await playBracket(a3.id, teachers.A3);

    expect(
      (await tournaments.getStage(tournamentId, StageType.SCHOOL)).status,
    ).toBe(StageStatus.FINISHED);
    const district = await tournaments.getStage(
      tournamentId,
      StageType.DISTRICT,
    );
    expect(district.status).toBe(StageStatus.IN_PROGRESS);
    expect(district.brackets).toHaveLength(9);
    const byDistrict = Object.fromEntries(
      district.brackets.map((b) => [b.district!, b]),
    );
    expect(byDistrict.CENTRAL).toMatchObject({
      participantsCount: 3,
      status: 'IN_PROGRESS',
    });
    expect(byDistrict.LENINSKY).toMatchObject({
      participantsCount: 1,
      status: 'FINISHED',
    });
    expect(byDistrict.SOVETSKY).toMatchObject({
      participantsCount: 0,
      status: 'FINISHED',
      winnerTeamId: null,
    });
    expect((await tournaments.findOne(tournamentId)).currentStage).toBe(
      StageType.DISTRICT,
    );

    // school results are final now
    const anyGame = a3.games.find((g) => g.status !== GameStatus.BYE)!;
    expect(
      await status(
        games.correctResult(organizator, anyGame.id, { scoreA: 9, scoreB: 0 }),
      ),
    ).toBe(409);
  });

  it('district → city → finished; organizator sees missing districts', async () => {
    const district = await tournaments.getStage(
      tournamentId,
      StageType.DISTRICT,
    );
    const central = district.brackets.find(
      (b) => b.district === District.CENTRAL,
    )!;
    await playBracket(central.id, teachers.B1); // any teacher may record district results

    const city = await tournaments.getStage(tournamentId, StageType.CITY);
    expect(city.brackets).toHaveLength(1);
    expect(city.brackets[0].participantsCount).toBe(2);
    const summary = Object.fromEntries(
      city.districts!.map((d) => [d.district, d.status]),
    );
    expect(summary.CENTRAL).toBe('QUALIFIED');
    expect(summary.LENINSKY).toBe('QUALIFIED');
    expect(
      Object.values(summary).filter((s) => s === 'NO_WINNER'),
    ).toHaveLength(7);

    await playBracket(city.brackets[0].id, organizator);
    const t = await tournaments.findOne(tournamentId);
    expect(t.status).toBe(TournamentStatus.FINISHED);
    expect(t.winnerTeamId).toBeTruthy();
    expect(t.winnerTeamId).toBe(
      (await tournaments.getStage(tournamentId, StageType.CITY)).brackets[0]
        .winnerTeamId,
    );
  });

  it('a tournament without full teams finishes immediately with no winner', async () => {
    const t = await tournaments.create(organizator, {
      name: 'Empty',
      minTeamSize: 5,
      maxTeamSize: 6,
      schoolStageStartAt: '2099-01-01T10:00',
    });
    await teams.create(pupils.A1[0], t.id, 'Lonely');
    await prisma.tournament.update({
      where: { id: t.id },
      data: { schoolStageStartAt: new Date(Date.now() - 1000) },
    });
    await engine.startSchoolStageIfDue(t.id);

    const after = await tournaments.findOne(t.id);
    expect(after.status).toBe(TournamentStatus.FINISHED);
    expect(after.winnerTeamId).toBeNull();
    const stages = await prisma.tournamentStage.findMany({
      where: { tournamentId: t.id },
    });
    expect(stages.every((s) => s.status === StageStatus.FINISHED)).toBe(true);
  });
});
