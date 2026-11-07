/**
 * Test data: admins, 4 classes with a teacher and pupils, a class without a
 * teacher, and events in every status with votes and likes, so every list, the
 * moderation flow, likes and the success probability have something to show.
 *
 *   npm run db:seed        (or: npx prisma db seed)
 *
 * Idempotent and safe for an existing database: it touches only its own rows
 * (fixed ids, schoolsById starting with "seed-"). On every run the seed events
 * are recreated with dates relative to now, so pending events stay pending.
 *
 * Log in:
 *   ADMIN    { "role": "ADMIN",   "schoolsById": "seed-admin-1" }   (1..2)
 *   TEACHER  { "role": "TEACHER", "schoolsById": "seed-teacher-10A" }
 *   PUPIL    { "role": "PUPIL",   "schoolsById": "seed-pupil-10A-1" }   (1..6, classes 8B 9A 10A 10B 11A)
 *
 * Class 9A has no teacher: its ON_MODERATION events have no moderators. Register a
 * teacher into it and they moderate them at once:
 *   POST /auth/register { "schoolsById": "my-teacher-9A", "name": "Ирина", "surname": "Петрова",
 *                         "role": "TEACHER", "class": "9A" }
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  EventCategories,
  EventStatuses,
  PrismaClient,
  Scopes,
  UserRoles,
} from './generated/prisma/client';
import { buildDatabaseUrl } from './database-url';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINSK_OFFSET = '+03:00';

/** Stable UUID (v5 layout) from a key, so re-running the seed updates the same rows. */
function seedId(key: string): string {
  const h = createHash('sha1')
    .update(`minsk-hackathon-seed:${key}`)
    .digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The Saturday `weeks` from the coming one (negative = in the past), at hh:mm Minsk time. */
function saturday(weeks: number, hhmm: string): Date {
  const now = new Date();
  const daysToSaturday = (6 - now.getUTCDay() + 7) % 7 || 7;
  const day = new Date(now.getTime() + (daysToSaturday + 7 * weeks) * DAY_MS);
  return new Date(
    `${day.toISOString().slice(0, 10)}T${hhmm}:00${MINSK_OFFSET}`,
  );
}

// ---------- users ----------

const ADMINS = [
  {
    id: '00000000-0000-4000-8000-00000000a002',
    schoolsById: 'seed-admin-2',
    name: 'Дмитрий',
    surname: 'Жуков',
  },
];

/** teacher: null = the class has no teacher yet. */
const CLASSES: Record<
  string,
  {
    teacher: readonly [string, string] | null;
    pupils: readonly (readonly [string, string])[];
  }
> = {
  '8B': {
    teacher: ['Татьяна', 'Лукашевич'],
    pupils: [
      ['Максим', 'Шевчук'],
      ['Полина', 'Мельник'],
      ['Егор', 'Кравец'],
      ['Ева', 'Бондарь'],
      ['Артём', 'Савицкий'],
      ['Злата', 'Гончар'],
    ],
  },
  '9A': {
    teacher: null,
    pupils: [
      ['Роман', 'Карпович'],
      ['Алина', 'Дубовская'],
      ['Илья', 'Сокол'],
      ['Милана', 'Жданович'],
    ],
  },
  '10A': {
    teacher: ['Елена', 'Новик'],
    pupils: [
      ['Иван', 'Козлов'],
      ['Анна', 'Ткачук'],
      ['Никита', 'Лешко'],
      ['София', 'Макаревич'],
      ['Кирилл', 'Пашкевич'],
      ['Дарья', 'Климович'],
    ],
  },
  '10B': {
    teacher: ['Андрей', 'Сидоренко'],
    pupils: [
      ['Матвей', 'Ермаков'],
      ['Алиса', 'Головач'],
      ['Даниил', 'Шульга'],
      ['Вероника', 'Зайко'],
      ['Тимофей', 'Ракович'],
      ['Ксения', 'Борисевич'],
    ],
  },
  '11A': {
    teacher: ['Наталья', 'Гриценко'],
    pupils: [
      ['Александр', 'Войтович'],
      ['Виктория', 'Семенчук'],
      ['Михаил', 'Протасеня'],
      ['Мария', 'Курило'],
      ['Глеб', 'Адамович'],
      ['Ульяна', 'Ясинская'],
    ],
  },
};

type ClassName = keyof typeof CLASSES;
const CLASS_NAMES = Object.keys(CLASSES);

const teacherId = (cls: ClassName) => seedId(`teacher:${cls}`);
const pupilId = (cls: ClassName, n: number) => seedId(`pupil:${cls}:${n}`);
const pupilsOf = (cls: ClassName) =>
  CLASSES[cls].pupils.map((_, i) => pupilId(cls, i + 1));
const gradeOf = (cls: ClassName) => cls.match(/\d+/)![0];

/** Pupils allowed to vote for an event of `scope` created in `cls` (same rule as EventsService.isInScope). */
function audience(cls: ClassName, scope: Scopes): string[] {
  const classes = CLASS_NAMES.filter((c) =>
    scope === Scopes.SCHOOL
      ? true
      : scope === Scopes.GRADE
        ? gradeOf(c) === gradeOf(cls)
        : c === cls,
  );
  return classes.flatMap(pupilsOf);
}

// ---------- events ----------

type SeedEvent = {
  name: string;
  description?: string;
  category: EventCategories;
  scope: Scopes;
  status: EventStatuses;
  cls: ClassName;
  /** Pupil number (1..6) in `cls` who created the event. */
  by: number;
  /** Saturday offset in weeks from the coming one; negative = past. */
  week: number;
  time: string;
  voteThreshold: number;
  /** Votes cast; defaults to the threshold for passed events, 0 otherwise. */
  votes?: number;
  /** Likes; defaults to a few more than the votes for likable events, 0 otherwise. */
  likes?: number;
  declineReason?: string;
};

const {
  SPORTS,
  INTELLECTUAL,
  CULTURAL,
  CREATIVE,
  EDUCATIONAL,
  VOLUNTEER,
  ENVIRONMENTAL,
  TOURISM,
  ENTERTAINMENT,
} = EventCategories;
const {
  ON_MODERATION,
  DECLINED,
  ON_VOTE,
  EXPIRED,
  ON_ADMIN_MODERATION,
  FINALIZED,
  DECLINED_BY_ADMIN,
} = EventStatuses;
const { CLASS, GRADE, SCHOOL } = Scopes;

/**
 * History is shaped so the probability differs by category and time:
 * - ENVIRONMENTAL at 09:00: 5 of 5 took place          -> ~0.9 for a 09:00 clean-up
 * - SPORTS at 10:00 mostly took place, at 18:00 mostly expired
 * - ENTERTAINMENT in the evening mostly expired
 * - CULTURAL: only 2 events                            -> pulled towards 0.5
 * - declined events are in the history but do not count
 */
const PAST: SeedEvent[] = [
  // ENVIRONMENTAL, 09:00: always works
  {
    name: 'Субботник в школьном дворе',
    category: ENVIRONMENTAL,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '10A',
    by: 1,
    week: -10,
    time: '09:00',
    voteThreshold: 8,
  },
  {
    name: 'Посадка деревьев в парке Победы',
    category: ENVIRONMENTAL,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '11A',
    by: 2,
    week: -8,
    time: '09:00',
    voteThreshold: 10,
  },
  {
    name: 'Уборка берега Свислочи',
    category: ENVIRONMENTAL,
    scope: GRADE,
    status: FINALIZED,
    cls: '10B',
    by: 3,
    week: -6,
    time: '09:30',
    voteThreshold: 6,
  },
  {
    name: 'Сбор макулатуры',
    category: ENVIRONMENTAL,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '8B',
    by: 1,
    week: -4,
    time: '09:00',
    voteThreshold: 7,
  },
  {
    name: 'Экологический десант',
    category: ENVIRONMENTAL,
    scope: CLASS,
    status: FINALIZED,
    cls: '11A',
    by: 4,
    week: -2,
    time: '08:30',
    voteThreshold: 4,
  },

  // SPORTS: mornings work, evenings do not
  {
    name: 'Турнир по мини-футболу',
    category: SPORTS,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '10A',
    by: 3,
    week: -12,
    time: '10:00',
    voteThreshold: 12,
  },
  {
    name: 'Эстафета «Весёлые старты»',
    category: SPORTS,
    scope: GRADE,
    status: FINALIZED,
    cls: '10B',
    by: 1,
    week: -9,
    time: '10:00',
    voteThreshold: 8,
  },
  {
    name: 'Волейбольный турнир параллели',
    category: SPORTS,
    scope: GRADE,
    status: FINALIZED,
    cls: '10A',
    by: 5,
    week: -7,
    time: '11:00',
    voteThreshold: 8,
  },
  {
    name: 'Шахматный блиц',
    category: SPORTS,
    scope: SCHOOL,
    status: EXPIRED,
    cls: '8B',
    by: 2,
    week: -5,
    time: '10:00',
    voteThreshold: 15,
    votes: 6,
  },
  {
    name: 'Забег на 3 км',
    category: SPORTS,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '11A',
    by: 1,
    week: -3,
    time: '09:30',
    voteThreshold: 10,
  },
  {
    name: 'Вечерний баскетбол',
    category: SPORTS,
    scope: CLASS,
    status: EXPIRED,
    cls: '10B',
    by: 2,
    week: -11,
    time: '18:00',
    voteThreshold: 5,
    votes: 2,
  },
  {
    name: 'Ночной футбол',
    category: SPORTS,
    scope: CLASS,
    status: EXPIRED,
    cls: '11A',
    by: 3,
    week: -6,
    time: '19:00',
    voteThreshold: 6,
    votes: 1,
  },
  {
    name: 'Настольный теннис после уроков',
    category: SPORTS,
    scope: CLASS,
    status: DECLINED,
    cls: '8B',
    by: 4,
    week: -4,
    time: '17:00',
    voteThreshold: 4,
    declineReason: 'Спортзал занят секцией',
  },

  // INTELLECTUAL, 12:00: mixed
  {
    name: 'Квиз «Что? Где? Когда?»',
    category: INTELLECTUAL,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '11A',
    by: 5,
    week: -10,
    time: '12:00',
    voteThreshold: 10,
  },
  {
    name: 'Дебаты о будущем технологий',
    category: INTELLECTUAL,
    scope: GRADE,
    status: EXPIRED,
    cls: '10A',
    by: 2,
    week: -8,
    time: '12:00',
    voteThreshold: 10,
    votes: 4,
  },
  {
    name: 'Математический бой',
    category: INTELLECTUAL,
    scope: GRADE,
    status: FINALIZED,
    cls: '10B',
    by: 4,
    week: -5,
    time: '13:00',
    voteThreshold: 6,
  },
  {
    name: 'Олимпиада по программированию',
    category: INTELLECTUAL,
    scope: SCHOOL,
    status: DECLINED_BY_ADMIN,
    cls: '10A',
    by: 4,
    week: -3,
    time: '12:00',
    voteThreshold: 8,
    declineReason: 'Совпадает с районной олимпиадой',
  },
  {
    name: 'Брейн-ринг',
    category: INTELLECTUAL,
    scope: CLASS,
    status: EXPIRED,
    cls: '8B',
    by: 5,
    week: -1,
    time: '14:00',
    voteThreshold: 6,
    votes: 3,
  },

  // ENTERTAINMENT, evenings: mostly expired
  {
    name: 'Осенний бал',
    category: ENTERTAINMENT,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '11A',
    by: 6,
    week: -9,
    time: '18:00',
    voteThreshold: 12,
  },
  {
    name: 'Дискотека',
    category: ENTERTAINMENT,
    scope: SCHOOL,
    status: EXPIRED,
    cls: '10B',
    by: 5,
    week: -7,
    time: '19:00',
    voteThreshold: 20,
    votes: 9,
  },
  {
    name: 'Квест по школе',
    category: ENTERTAINMENT,
    scope: GRADE,
    status: EXPIRED,
    cls: '10A',
    by: 6,
    week: -4,
    time: '18:30',
    voteThreshold: 10,
    votes: 5,
  },
  {
    name: 'Вечер настольных игр',
    category: ENTERTAINMENT,
    scope: CLASS,
    status: EXPIRED,
    cls: '8B',
    by: 3,
    week: -2,
    time: '19:00',
    voteThreshold: 5,
    votes: 2,
  },
  {
    name: 'Караоке-вечер',
    category: ENTERTAINMENT,
    scope: CLASS,
    status: DECLINED,
    cls: '10B',
    by: 6,
    week: -1,
    time: '20:00',
    voteThreshold: 4,
    declineReason: 'Слишком поздно для школьного мероприятия',
  },

  // CULTURAL: small sample
  {
    name: 'Поход в Национальный художественный музей',
    category: CULTURAL,
    scope: CLASS,
    status: FINALIZED,
    cls: '10A',
    by: 1,
    week: -6,
    time: '11:00',
    voteThreshold: 4,
  },
  {
    name: 'Спектакль в Купаловском театре',
    category: CULTURAL,
    scope: GRADE,
    status: FINALIZED,
    cls: '11A',
    by: 2,
    week: -3,
    time: '12:00',
    voteThreshold: 4,
  },

  // others
  {
    name: 'Выставка рисунков «Мой Минск»',
    category: CREATIVE,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '8B',
    by: 6,
    week: -8,
    time: '11:00',
    voteThreshold: 8,
  },
  {
    name: 'Концерт к Дню учителя',
    category: CREATIVE,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '11A',
    by: 4,
    week: -5,
    time: '12:00',
    voteThreshold: 10,
  },
  {
    name: 'Мастер-класс по робототехнике',
    category: EDUCATIONAL,
    scope: GRADE,
    status: FINALIZED,
    cls: '10B',
    by: 1,
    week: -6,
    time: '11:00',
    voteThreshold: 6,
  },
  {
    name: 'Встреча с IT-специалистом',
    category: EDUCATIONAL,
    scope: SCHOOL,
    status: EXPIRED,
    cls: '10A',
    by: 3,
    week: -2,
    time: '15:00',
    voteThreshold: 15,
    votes: 7,
  },
  {
    name: 'Помощь приюту для животных',
    category: VOLUNTEER,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '8B',
    by: 2,
    week: -7,
    time: '10:00',
    voteThreshold: 8,
  },
  {
    name: 'Ярмарка добрых дел',
    category: VOLUNTEER,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '10B',
    by: 3,
    week: -3,
    time: '11:00',
    voteThreshold: 10,
  },
  {
    name: 'Поход в Налибокскую пущу',
    category: TOURISM,
    scope: CLASS,
    status: EXPIRED,
    cls: '11A',
    by: 5,
    week: -9,
    time: '08:00',
    voteThreshold: 6,
    votes: 3,
  },
  {
    name: 'Экскурсия в Несвиж',
    category: TOURISM,
    scope: GRADE,
    status: FINALIZED,
    cls: '10A',
    by: 2,
    week: -4,
    time: '08:00',
    voteThreshold: 8,
  },
];

/** Upcoming events in every pending status. Pending ones must be created less than a month (30 days) ago. */
const UPCOMING: SeedEvent[] = [
  // teacher queues
  {
    name: 'Субботник у школьного стадиона',
    description: 'Сбор у входа в школу, перчатки выдадут',
    category: ENVIRONMENTAL,
    scope: SCHOOL,
    status: ON_MODERATION,
    cls: '10A',
    by: 2,
    week: 1,
    time: '09:00',
    voteThreshold: 8,
  },
  {
    name: 'Турнир по стритболу',
    category: SPORTS,
    scope: GRADE,
    status: ON_MODERATION,
    cls: '10B',
    by: 4,
    week: 2,
    time: '18:00',
    voteThreshold: 6,
  },
  {
    name: 'Поход в кино на премьеру',
    category: CULTURAL,
    scope: CLASS,
    status: ON_MODERATION,
    cls: '8B',
    by: 1,
    week: 1,
    time: '16:00',
    voteThreshold: 4,
  },
  {
    name: 'Литературная гостиная',
    category: CREATIVE,
    scope: CLASS,
    status: ON_MODERATION,
    cls: '11A',
    by: 3,
    week: 3,
    time: '13:00',
    voteThreshold: 4,
  },

  // class without a teacher: waits until a teacher registers into 9A
  {
    name: 'Шахматный турнир 9А',
    description: 'Ждёт, пока в класс зарегистрируется учитель',
    category: INTELLECTUAL,
    scope: CLASS,
    status: ON_MODERATION,
    cls: '9A',
    by: 1,
    week: 1,
    time: '12:00',
    voteThreshold: 3,
  },
  {
    name: 'Поход на каток',
    category: SPORTS,
    scope: GRADE,
    status: ON_MODERATION,
    cls: '9A',
    by: 2,
    week: 2,
    time: '15:00',
    voteThreshold: 3,
  },

  // voting feed
  {
    name: 'Утренний турнир по футболу',
    description: 'Команды по 6 человек',
    category: SPORTS,
    scope: SCHOOL,
    status: ON_VOTE,
    cls: '10A',
    by: 4,
    week: 1,
    time: '10:00',
    voteThreshold: 12,
    votes: 7,
  },
  {
    name: 'Квиз по истории Беларуси',
    category: INTELLECTUAL,
    scope: GRADE,
    status: ON_VOTE,
    cls: '10B',
    by: 2,
    week: 2,
    time: '12:00',
    voteThreshold: 8,
    votes: 3,
  },
  {
    name: 'Новогодняя дискотека',
    category: ENTERTAINMENT,
    scope: SCHOOL,
    status: ON_VOTE,
    cls: '11A',
    by: 1,
    week: 3,
    time: '19:00',
    voteThreshold: 15,
    votes: 10,
  },
  {
    name: 'Экскурсия в Мирский замок',
    category: TOURISM,
    scope: CLASS,
    status: ON_VOTE,
    cls: '8B',
    by: 5,
    week: 2,
    time: '08:00',
    voteThreshold: 5,
    votes: 1,
  },
  {
    name: 'Мастер-класс по фотографии',
    category: EDUCATIONAL,
    scope: CLASS,
    status: ON_VOTE,
    cls: '10A',
    by: 5,
    week: 1,
    time: '11:00',
    voteThreshold: 4,
    votes: 1, // only the organizer so far
  },

  // admin queue
  {
    name: 'Благотворительная ярмарка',
    category: VOLUNTEER,
    scope: SCHOOL,
    status: ON_ADMIN_MODERATION,
    cls: '10B',
    by: 5,
    week: 1,
    time: '11:00',
    voteThreshold: 10,
  },
  {
    name: 'Посадка аллеи выпускников',
    category: ENVIRONMENTAL,
    scope: GRADE,
    status: ON_ADMIN_MODERATION,
    cls: '11A',
    by: 6,
    week: 2,
    time: '09:00',
    voteThreshold: 5,
  },

  // decided, not started yet
  {
    name: 'Зимний лыжный забег',
    category: SPORTS,
    scope: SCHOOL,
    status: FINALIZED,
    cls: '11A',
    by: 2,
    week: 4,
    time: '10:00',
    voteThreshold: 10,
  },
  {
    name: 'Ночь в музее',
    category: CULTURAL,
    scope: GRADE,
    status: DECLINED_BY_ADMIN,
    cls: '10A',
    by: 6,
    week: 3,
    time: '20:00',
    voteThreshold: 6,
    declineReason: 'Музей не работает ночью',
  },
  {
    name: 'Пейнтбол',
    category: ENTERTAINMENT,
    scope: CLASS,
    status: DECLINED,
    cls: '10B',
    by: 1,
    week: 2,
    time: '15:00',
    voteThreshold: 4,
    declineReason: 'Требуется согласие родителей, оформите заявку заново',
  },
];

const PASSED = new Set<EventStatuses>([
  ON_ADMIN_MODERATION,
  FINALIZED,
  DECLINED_BY_ADMIN,
]);
/** Never reached the vote: only the organizer's own vote. */
const NOT_VOTED = new Set<EventStatuses>([ON_MODERATION, DECLINED]);

/** The pupil organizer votes on creation (src/modules/events/events.service.ts), so at least 1. */
function votesFor(event: SeedEvent): number {
  if (NOT_VOTED.has(event.status)) return 1;
  return Math.max(1, event.votes ?? (PASSED.has(event.status) ? event.voteThreshold : 0));
}

/** As LIKABLE_STATUSES in src/modules/events/events.service.ts. */
const LIKABLE = new Set<EventStatuses>([
  ON_VOTE,
  ON_ADMIN_MODERATION,
  FINALIZED,
  DECLINED_BY_ADMIN,
]);

const ALL_PUPILS = CLASS_NAMES.flatMap(pupilsOf);

function likesFor(event: SeedEvent): number {
  if (!LIKABLE.has(event.status)) return 0;
  return (
    event.likes ??
    Math.min(ALL_PUPILS.length, votesFor(event) + (event.by % 4) + 1)
  );
}

/** A month, as in src/modules/events/event-deadlines.ts. */
const DECISION_WINDOW_MS = 30 * DAY_MS;

/**
 * Requests are filed 1-3 weeks before the planned date, never in the future.
 * Expired ones are moved past the deadline and pending ones kept before it.
 */
function seedCreatedAt(event: SeedEvent, planned: Date, now: Date): Date {
  let created = Math.min(
    planned.getTime() - (7 + (event.by % 3) * 7) * DAY_MS,
    now.getTime() - DAY_MS,
  );
  if (event.status === EXPIRED) {
    created = Math.min(created, now.getTime() - DECISION_WINDOW_MS - DAY_MS);
  }
  if (
    ([ON_MODERATION, ON_VOTE, ON_ADMIN_MODERATION] as EventStatuses[]).includes(
      event.status,
    )
  ) {
    created = Math.max(created, now.getTime() - DECISION_WINDOW_MS + DAY_MS);
  }
  return new Date(created);
}

/** Catches seed data that the app itself could never produce. */
function assertConsistent(event: SeedEvent, createdAt: Date, now: Date): void {
  const fail = (why: string) => {
    throw new Error(`Seed event "${event.name}": ${why}`);
  };
  const voters = audience(event.cls, event.scope);
  const votes = votesFor(event);
  if (votes > voters.length)
    fail(`${votes} votes but only ${voters.length} pupils in scope`);
  if (PASSED.has(event.status) && votes < event.voteThreshold)
    fail('passed the vote without enough votes');
  if (
    (event.status === ON_VOTE || event.status === EXPIRED) &&
    votes >= event.voteThreshold
  ) {
    fail('reached the threshold but did not move on');
  }
  const pending = [
    ON_MODERATION,
    ON_VOTE,
    ON_ADMIN_MODERATION,
  ] as EventStatuses[];
  const overdue = createdAt.getTime() <= now.getTime() - DECISION_WINDOW_MS;
  const likes = likesFor(event);
  if (likes > ALL_PUPILS.length)
    fail(`${likes} likes but only ${ALL_PUPILS.length} pupils in the school`);
  if (likes > 0 && !LIKABLE.has(event.status))
    fail(`liked in status ${event.status}, before the teacher approved it`);
  if (
    !CLASSES[event.cls].teacher &&
    event.status !== ON_MODERATION &&
    event.status !== EXPIRED
  )
    fail('moved past moderation in a class that has no teacher');
  if (pending.includes(event.status) && overdue)
    fail('pending, but its deadline (a month after creation) has passed');
  if (event.status === EXPIRED && !overdue)
    fail('expired before its deadline (a month after creation)');
}

async function main(): Promise<void> {
  const url = buildDatabaseUrl((key) => process.env[key]);
  if (!url)
    throw new Error('Database is not configured: set DATABASE_* in .env');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      // Users: upsert, so ids stay stable and tokens issued before keep working.
      for (const admin of ADMINS) {
        await tx.user.upsert({
          where: { id: admin.id },
          create: { ...admin, role: UserRoles.ADMIN },
          update: {
            ...admin,
            role: UserRoles.ADMIN,
            class: null,
          },
        });
      }
      for (const cls of CLASS_NAMES) {
        const seedTeacher = CLASSES[cls].teacher;
        if (seedTeacher) {
          const [name, surname] = seedTeacher;
          const teacher = {
            name,
            surname,
            role: UserRoles.TEACHER,
            class: cls,
            schoolsById: `seed-teacher-${cls}`,
          };
          await tx.user.upsert({
            where: { id: teacherId(cls) },
            create: { id: teacherId(cls), ...teacher },
            update: teacher,
          });
        }
        for (const [i, [pName, pSurname]] of CLASSES[cls].pupils.entries()) {
          const pupil = {
            name: pName,
            surname: pSurname,
            role: UserRoles.PUPIL,
            class: cls,
            schoolsById: `seed-pupil-${cls}-${i + 1}`,
          };
          const id = pupilId(cls, i + 1);
          await tx.user.upsert({
            where: { id },
            create: { id, ...pupil },
            update: pupil,
          });
        }
      }

      // Events: recreated, so their dates move with "now". Votes go with them (cascade).
      const all = [...PAST, ...UPCOMING];
      await tx.event.deleteMany({
        where: { id: { in: all.map((e) => seedId(`event:${e.name}`)) } },
      });

      for (const event of all) {
        // The planned Saturday: the date the admin set for FINALIZED events;
        // for the others only the creation time is derived from it.
        const planned = saturday(event.week, event.time);
        const id = seedId(`event:${event.name}`);
        const initiator = pupilId(event.cls, event.by);
        const createdAt = seedCreatedAt(event, planned, now);
        assertConsistent(event, createdAt, now);

        await tx.event.create({
          data: {
            id,
            name: event.name,
            description: event.description ?? null,
            category: event.category,
            scope: event.scope,
            status: event.status,
            declineReason: event.declineReason ?? null,
            voteThreshold: event.voteThreshold,
            // Only the admin sets the date, on approval.
            startsAt: event.status === FINALIZED ? planned : null,
            initiatorId: initiator,
            createdAt,
          },
        });

        // The initiator votes first, then classmates, then the rest of the audience.
        const voters = audience(event.cls, event.scope).sort((a, b) =>
          a === initiator ? -1 : b === initiator ? 1 : 0,
        );
        const count = votesFor(event);
        if (count > 0) {
          await tx.eventVote.createMany({
            data: voters
              .slice(0, count)
              .map((voterId) => ({ eventId: id, voterId, createdAt })),
          });
        }

        // Voters like first, then any other pupil of the school (likes are not limited by scope).
        const likers = [...new Set([...voters, ...ALL_PUPILS])];
        const likeCount = likesFor(event);
        if (likeCount > 0) {
          await tx.eventLike.createMany({
            data: likers
              .slice(0, likeCount)
              .map((userId) => ({ eventId: id, userId, createdAt })),
          });
        }
      }
    });

    const [users, events, votes, likes] = await Promise.all([
      prisma.user.count({
        where: {
          OR: [
            { schoolsById: { startsWith: 'seed-' } },
            { id: { in: ADMINS.map((a) => a.id) } },
          ],
        },
      }),
      prisma.event.groupBy({
        by: ['status'],
        where: { initiator: { schoolsById: { startsWith: 'seed-' } } },
        _count: true,
      }),
      prisma.eventVote.count({
        where: { voter: { schoolsById: { startsWith: 'seed-' } } },
      }),
      prisma.eventLike.count({
        where: { user: { schoolsById: { startsWith: 'seed-' } } },
      }),
    ]);
    console.log(
      `Seeded ${users} users, ${votes} votes, ${likes} likes, events by status:`,
    );
    for (const row of events)
      console.log(`  ${row.status.padEnd(20)} ${row._count}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
