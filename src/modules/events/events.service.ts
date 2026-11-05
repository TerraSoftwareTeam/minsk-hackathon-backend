import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventAccess,
  Prisma,
  User,
  UserRoles,
} from '../../../prisma/generated/prisma/client';
import {
  parseMinskDateTime,
  TOURNAMENT_TIME_ZONE,
} from '../../common/time/minsk-time';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateEventDto,
  EventParticipantDto,
  EventResponseDto,
  ListEventsQueryDto,
  UpdateEventDto,
} from './dto/event.dto';
import {
  assertCanManageEvent,
  canCreateEvents,
  canManageEvent,
  canViewEvent,
  canViewParticipants,
} from './event-access';

type Tx = Prisma.TransactionClient;

const eventInclude = (viewerId: string) =>
  ({
    school: { select: { id: true, name: true } },
    creator: { select: { name: true, surname: true } },
    _count: { select: { registrations: true } },
    registrations: { where: { userId: viewerId }, select: { userId: true } },
  }) satisfies Prisma.EventInclude;

type EventWithRelations = Prisma.EventGetPayload<{
  include: ReturnType<typeof eventInclude>;
}>;

const isActive = (event: { startsAt: Date }, now: Date) => event.startsAt > now;

const toEventResponse = (
  actor: User,
  e: EventWithRelations,
  now: Date,
): EventResponseDto => ({
  id: e.id,
  title: e.title,
  description: e.description,
  startsAt: e.startsAt,
  timeZone: TOURNAMENT_TIME_ZONE,
  access: e.access,
  schoolId: e.schoolId,
  schoolName: e.school?.name ?? null,
  maxParticipants: e.maxParticipants,
  participantsCount: e._count.registrations,
  isActive: isActive(e, now),
  isFull:
    e.maxParticipants !== null && e._count.registrations >= e.maxParticipants,
  isRegistered: e.registrations.length > 0,
  canManage: canManageEvent(actor, e),
  creatorId: e.creatorId,
  creatorName: e.creator ? `${e.creator.surname} ${e.creator.name}` : null,
  createdAt: e.createdAt,
});

/** Events the actor is allowed to see. Hidden events answer 404, not 403. */
const visibleWhere = (actor: User): Prisma.EventWhereInput => {
  if (actor.role === UserRoles.ORGANIZATOR) return {};
  const scopes: Prisma.EventWhereInput[] = [{ access: EventAccess.ALL }];
  if (actor.schoolName) scopes.push({ school: { name: actor.schoolName } });
  return { OR: scopes };
};

/**
 * One-time events. An event is active (open for sign-up) until startsAt; after that
 * it stays in the database as inactive and can be neither edited nor joined.
 *
 * Mutations of an event run in a transaction holding FOR UPDATE on the event row, so
 * the capacity check and the insert are atomic and an edit cannot interleave with
 * sign-ups (e.g. lowering maxParticipants below the current count).
 */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    actor: User,
    dto: CreateEventDto,
    now = new Date(),
  ): Promise<EventResponseDto> {
    if (!canCreateEvents(actor)) {
      throw new ForbiddenException(
        'Only a teacher or an organizator can create events',
      );
    }
    const startsAt = parseMinskDateTime(dto.startsAt);
    this.assertFuture(startsAt, now);
    const schoolId = await this.resolveSchool(
      this.prisma,
      actor,
      dto.access,
      dto.schoolId,
    );

    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        startsAt,
        access: dto.access,
        schoolId,
        maxParticipants: dto.maxParticipants ?? null,
        creatorId: actor.id,
      },
    });
    return this.findOne(actor, event.id, now);
  }

  async list(
    actor: User,
    query: ListEventsQueryDto,
    now = new Date(),
  ): Promise<EventResponseDto[]> {
    const filters: Prisma.EventWhereInput[] = [visibleWhere(actor)];
    if (query.active === true) filters.push({ startsAt: { gt: now } });
    if (query.active === false) filters.push({ startsAt: { lte: now } });
    if (query.registered === true)
      filters.push({ registrations: { some: { userId: actor.id } } });
    if (query.registered === false)
      filters.push({ registrations: { none: { userId: actor.id } } });
    if (query.mine === true) filters.push({ creatorId: actor.id });
    if (query.mine === false)
      filters.push({
        OR: [{ creatorId: null }, { creatorId: { not: actor.id } }],
      });

    const events = await this.prisma.event.findMany({
      where: { AND: filters },
      include: eventInclude(actor.id),
      // Upcoming events: soonest first. Past events: most recent first.
      orderBy: { startsAt: query.active === false ? 'desc' : 'asc' },
    });
    return events.map((e) => toEventResponse(actor, e, now));
  }

  async findOne(
    actor: User,
    id: string,
    now = new Date(),
  ): Promise<EventResponseDto> {
    return toEventResponse(
      actor,
      await this.findVisible(this.prisma, actor, id),
      now,
    );
  }

  async update(
    actor: User,
    id: string,
    dto: UpdateEventDto,
    now = new Date(),
  ): Promise<EventResponseDto> {
    const startsAt = dto.startsAt
      ? parseMinskDateTime(dto.startsAt)
      : undefined;
    if (startsAt) this.assertFuture(startsAt, now);

    await this.prisma.$transaction(async (tx) => {
      await this.lockEvent(tx, id);
      const event = await this.findVisible(tx, actor, id);
      assertCanManageEvent(actor, event);
      this.assertActive(event, now);

      const access = dto.access ?? event.access;
      const schoolId = await this.resolveSchool(
        tx,
        actor,
        access,
        dto.schoolId ?? event.schoolId ?? undefined,
      );
      if (schoolId !== null && schoolId !== event.schoolId) {
        const outsiders = await tx.eventRegistration.count({
          where: {
            eventId: id,
            NOT: { user: { school: { is: { id: schoolId } } } },
          },
        });
        if (outsiders > 0) {
          throw new ConflictException(
            'Pupils of other schools are already signed up; the event cannot be restricted to one school',
          );
        }
      }

      const count = event._count.registrations;
      if (
        dto.maxParticipants !== undefined &&
        dto.maxParticipants !== null &&
        dto.maxParticipants < count
      ) {
        throw new ConflictException(
          `${count} pupils are already signed up; maxParticipants cannot be lower`,
        );
      }

      await tx.event.update({
        where: { id },
        data: {
          title: dto.title ?? undefined,
          description: dto.description ?? undefined,
          startsAt,
          access,
          schoolId,
          maxParticipants: dto.maxParticipants,
        },
      });
    });
    return this.findOne(actor, id, now);
  }

  /** Pupils only, while the event is active and has free spots. */
  async register(
    actor: User,
    id: string,
    now = new Date(),
  ): Promise<EventResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can sign up for an event');
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockEvent(tx, id);
        const event = await this.findVisible(tx, actor, id);
        this.assertActive(event, now);
        if (event.registrations.length > 0) {
          throw new ConflictException('You are already signed up');
        }
        if (
          event.maxParticipants !== null &&
          event._count.registrations >= event.maxParticipants
        ) {
          throw new ConflictException('No free spots left');
        }
        await tx.eventRegistration.create({
          data: { eventId: id, userId: actor.id },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You are already signed up');
      }
      throw error;
    }
    return this.findOne(actor, id, now);
  }

  /** Cancels the actor's own sign-up while the event is active. */
  async unregister(
    actor: User,
    id: string,
    now = new Date(),
  ): Promise<EventResponseDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockEvent(tx, id);
      const event = await this.findVisible(tx, actor, id);
      this.assertActive(event, now);
      const { count } = await tx.eventRegistration.deleteMany({
        where: { eventId: id, userId: actor.id },
      });
      if (count === 0) {
        throw new NotFoundException('You are not signed up for this event');
      }
    });
    return this.findOne(actor, id, now);
  }

  /** Teachers and organizators who can see the event. Available after the event too. */
  async participants(actor: User, id: string): Promise<EventParticipantDto[]> {
    await this.findVisible(this.prisma, actor, id);
    if (!canViewParticipants(actor)) {
      throw new ForbiddenException(
        'Only teachers and organizators can see the participants',
      );
    }
    const rows = await this.prisma.eventRegistration.findMany({
      where: { eventId: id },
      orderBy: { registeredAt: 'asc' },
      include: {
        user: {
          select: {
            name: true,
            surname: true,
            fathersName: true,
            class: true,
            schoolName: true,
          },
        },
      },
    });
    return rows.map((r) => ({
      userId: r.userId,
      name: r.user.name,
      surname: r.user.surname,
      fathersName: r.user.fathersName,
      class: r.user.class,
      schoolName: r.user.schoolName,
      registeredAt: r.registeredAt,
    }));
  }

  private async findVisible(
    db: Tx | PrismaService,
    actor: User,
    id: string,
  ): Promise<EventWithRelations> {
    const event = await db.event.findUnique({
      where: { id },
      include: eventInclude(actor.id),
    });
    if (!event || !canViewEvent(actor, event)) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private async lockEvent(tx: Tx, id: string): Promise<void> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Event" WHERE id = ${id} FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('Event not found');
  }

  /**
   * School of a SCHOOL event: a teacher's own school (schoolId may be omitted),
   * any existing school for an organizator (schoolId required). Null for ALL.
   */
  private async resolveSchool(
    db: Tx | PrismaService,
    actor: User,
    access: EventAccess,
    schoolId: string | undefined,
  ): Promise<string | null> {
    if (access === EventAccess.ALL) return null;

    if (actor.role === UserRoles.TEACHER) {
      if (!actor.schoolName) {
        throw new BadRequestException('Teacher has no school');
      }
      const own = await db.school.findUniqueOrThrow({
        where: { name: actor.schoolName },
      });
      if (schoolId !== undefined && schoolId !== own.id) {
        throw new ForbiddenException(
          'A teacher can create school events only for their own school',
        );
      }
      return own.id;
    }

    if (!schoolId) {
      throw new BadRequestException('schoolId is required for a SCHOOL event');
    }
    const school = await db.school.findUnique({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('School not found');
    return school.id;
  }

  private assertActive(event: { startsAt: Date }, now: Date): void {
    if (!isActive(event, now)) {
      throw new ConflictException(
        'The event has already started and is no longer active',
      );
    }
  }

  private assertFuture(startsAt: Date, now: Date): void {
    if (startsAt <= now) {
      throw new BadRequestException('startsAt must be in the future');
    }
  }
}
