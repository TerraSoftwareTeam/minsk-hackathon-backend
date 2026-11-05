/**
 * One-time events against a real Postgres database.
 *
 * DESTRUCTIVE: truncates all tables. Runs only when DATABASE_NAME ends with "-test":
 *   DATABASE_NAME=hackathon-db-test npx prisma migrate deploy
 *   DATABASE_NAME=hackathon-db-test npm run test:e2e -- events
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import {
  District,
  EventAccess,
  User,
  UserRoles,
} from '../prisma/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventsService } from '../src/modules/events/events.service';

const enabled = (process.env.DATABASE_NAME ?? '').endsWith('-test');
const suite = enabled ? describe : describe.skip;

suite('Events (real DB)', () => {
  jest.setTimeout(30_000);

  let prisma: PrismaService;
  let events: EventsService;
  let organizator: User;
  let teacherA: User;
  let teacherB: User;
  const pupilsA: User[] = [];
  const pupilsB: User[] = [];
  let schoolAId: string;
  let schoolBId: string;
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
        schoolsById: schoolName ? `ev-${counter}` : null,
        class: schoolName ? '9B' : null,
        schoolName,
      },
    });

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService(process.env));
    await prisma.$connect();
    await prisma.$executeRawUnsafe(
      'TRUNCATE "EventRegistration", "Event", "TournamentGame", "TournamentBracket", "TournamentStage", "TeamMember", "TournamentTeam", "Tournament", "User", "School" CASCADE',
    );
    events = new EventsService(prisma);
    const a = await prisma.school.create({
      data: { name: 'EA', district: District.CENTRAL },
    });
    const b = await prisma.school.create({
      data: { name: 'EB', district: District.SOVETSKY },
    });
    schoolAId = a.id;
    schoolBId = b.id;
    organizator = await makeUser(UserRoles.ORGANIZATOR, null);
    teacherA = await makeUser(UserRoles.TEACHER, 'EA');
    teacherB = await makeUser(UserRoles.TEACHER, 'EB');
    for (let i = 0; i < 4; i++) {
      pupilsA.push(await makeUser(UserRoles.PUPIL, 'EA'));
      pupilsB.push(await makeUser(UserRoles.PUPIL, 'EB'));
    }
  });

  afterAll(async () => prisma?.$disconnect());

  const future = '2099-05-01T15:00';

  it('only teachers and organizators create events; date must be in the future', async () => {
    const dto = {
      title: 't',
      description: 'd',
      startsAt: future,
      access: EventAccess.ALL,
    };
    expect(await status(events.create(pupilsA[0], dto))).toBe(403);
    expect(
      await status(
        events.create(teacherA, { ...dto, startsAt: '2020-01-01T10:00' }),
      ),
    ).toBe(400);
    const e = await events.create(teacherA, dto);
    expect(e).toMatchObject({
      access: EventAccess.ALL,
      schoolId: null,
      isActive: true,
      canManage: true,
      participantsCount: 0,
    });
    // Minsk local time is stored as UTC.
    expect(e.startsAt.toISOString()).toBe('2099-05-01T12:00:00.000Z');
  });

  it('a teacher creates school events only for their own school', async () => {
    const dto = {
      title: 's',
      description: 'd',
      startsAt: future,
      access: EventAccess.SCHOOL,
    };
    expect(
      await status(events.create(teacherA, { ...dto, schoolId: schoolBId })),
    ).toBe(403);
    const e = await events.create(teacherA, dto);
    expect(e.schoolId).toBe(schoolAId);
    expect(await status(events.create(organizator, dto))).toBe(400);
    const byOrg = await events.create(organizator, {
      ...dto,
      schoolId: schoolBId,
    });
    expect(byOrg.schoolName).toBe('EB');
  });

  it('school events are visible only to their school (and organizator)', async () => {
    const forA = await events.create(teacherA, {
      title: 'only A',
      description: 'd',
      startsAt: future,
      access: EventAccess.SCHOOL,
    });
    expect(await status(events.findOne(pupilsB[0], forA.id))).toBe(404);
    expect(await status(events.register(pupilsB[0], forA.id))).toBe(404);
    expect((await events.findOne(pupilsA[0], forA.id)).canManage).toBe(false);
    expect((await events.findOne(organizator, forA.id)).canManage).toBe(true);

    const listB = await events.list(pupilsB[0], {});
    expect(listB.some((e) => e.id === forA.id)).toBe(false);
    expect(listB.some((e) => e.access === EventAccess.ALL)).toBe(true);
    expect(listB.filter((e) => e.access === EventAccess.SCHOOL)).toEqual(
      listB.filter((e) => e.schoolId === schoolBId),
    );
  });

  it('pupils sign up, cancel, and the limit holds under concurrency', async () => {
    const e = await events.create(teacherA, {
      title: 'limited',
      description: 'd',
      startsAt: future,
      access: EventAccess.ALL,
      maxParticipants: 3,
    });
    expect(await status(events.register(teacherB, e.id))).toBe(403);

    const all = [...pupilsA, ...pupilsB];
    const results = await Promise.all(
      all.map((p) => status(events.register(p, e.id))),
    );
    expect(results.filter((s) => s === 200)).toHaveLength(3);
    expect(results.filter((s) => s === 409)).toHaveLength(all.length - 3);

    const after = await events.findOne(teacherA, e.id);
    expect(after).toMatchObject({ participantsCount: 3, isFull: true });

    const winner = all[results.indexOf(200)];
    expect(await status(events.register(winner, e.id))).toBe(409);
    expect((await events.unregister(winner, e.id)).isRegistered).toBe(false);
    expect(await status(events.unregister(winner, e.id))).toBe(404);
    expect((await events.register(winner, e.id)).isRegistered).toBe(true);

    const mine = await events.list(winner, { registered: true });
    expect(mine.map((x) => x.id)).toContain(e.id);
  });

  it('everyone who sees the event sees participants; only the author or an organizator edits', async () => {
    const e = await events.create(teacherA, {
      title: 'edit me',
      description: 'd',
      startsAt: future,
      access: EventAccess.ALL,
    });
    await events.register(pupilsA[0], e.id);
    await events.register(pupilsB[0], e.id);

    expect(await events.participants(teacherB, e.id)).toHaveLength(2);
    expect(await events.participants(pupilsA[1], e.id)).toHaveLength(2);
    const list = await events.participants(teacherA, e.id);
    expect(list.map((p) => p.userId)).toEqual([pupilsA[0].id, pupilsB[0].id]);
    expect(await events.participants(organizator, e.id)).toHaveLength(2);

    expect(await status(events.update(teacherB, e.id, { title: 'x' }))).toBe(
      403,
    );
    expect(
      await status(events.update(teacherA, e.id, { maxParticipants: 1 })),
    ).toBe(409);
    // A pupil of school B is signed up: cannot restrict to school A.
    expect(
      await status(
        events.update(teacherA, e.id, { access: EventAccess.SCHOOL }),
      ),
    ).toBe(409);

    await events.unregister(pupilsB[0], e.id);
    const updated = await events.update(teacherA, e.id, {
      title: 'renamed',
      access: EventAccess.SCHOOL,
      maxParticipants: 2,
    });
    expect(updated).toMatchObject({
      title: 'renamed',
      schoolId: schoolAId,
      maxParticipants: 2,
    });
    const unlimited = await events.update(organizator, e.id, {
      maxParticipants: null,
      access: EventAccess.ALL,
    });
    expect(unlimited).toMatchObject({ maxParticipants: null, schoolId: null });
  });

  it('after startsAt the event is inactive but stays in the database', async () => {
    const e = await events.create(teacherA, {
      title: 'soon',
      description: 'd',
      startsAt: future,
      access: EventAccess.ALL,
    });
    await events.register(pupilsA[1], e.id);
    const later = new Date('2099-05-01T12:00:00Z'); // exactly startsAt

    expect((await events.findOne(pupilsA[0], e.id, later)).isActive).toBe(
      false,
    );
    expect(await status(events.register(pupilsA[0], e.id, later))).toBe(409);
    expect(await status(events.unregister(pupilsA[1], e.id, later))).toBe(409);
    expect(
      await status(events.update(teacherA, e.id, { title: 'x' }, later)),
    ).toBe(409);
    expect(await events.participants(teacherA, e.id)).toHaveLength(1);

    const past = await events.list(teacherA, { active: false }, later);
    expect(past.map((x) => x.id)).toContain(e.id);
    const active = await events.list(teacherA, { active: true }, later);
    expect(active.map((x) => x.id)).not.toContain(e.id);
  });
});
