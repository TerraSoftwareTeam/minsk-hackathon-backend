import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventStatuses,
  Prisma,
  User,
  UserRoles,
} from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { DeclineEventDto } from './dto/decline-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { EventWithUsers, toEventResponse } from './event.mapper';

const WITH_USERS = { initiator: true, teacher: true } as const;

/**
 * Event moderation flow:
 * 1. A PUPIL creates an event. It gets status ON_MODERATION and is assigned
 *    to a teacher of the pupil's class (teacher.class === pupil.class).
 * 2. That teacher sees it in their moderation list and either approves it
 *    (ON_VOTE) or declines it (DECLINED, optional reason).
 *
 * Who may read an event: its initiator, its assigned teacher, any admin.
 */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actor: User, dto: CreateEventDto): Promise<EventResponseDto> {
    if (actor.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('Only a pupil can create an event');
    }
    if (!actor.class) {
      throw new BadRequestException('Pupil has no class assigned');
    }
    const teacher = await this.findClassTeacher(actor.class);

    const event = await this.withPrismaErrors(() =>
      this.prisma.event.create({
        data: {
          name: dto.name,
          description: dto.description,
          scope: dto.scope,
          status: EventStatuses.ON_MODERATION,
          initiatorId: actor.id,
          teacherId: teacher.id,
        },
        include: WITH_USERS,
      }),
    );
    return toEventResponse(event);
  }

  /** The teacher's queue: events assigned to them that still await a decision. */
  async findForModeration(actor: User): Promise<EventResponseDto[]> {
    if (actor.role !== UserRoles.TEACHER) {
      throw new ForbiddenException('Only a teacher has a moderation list');
    }
    const events = await this.prisma.event.findMany({
      where: { teacherId: actor.id, status: EventStatuses.ON_MODERATION },
      include: WITH_USERS,
      orderBy: { createdAt: 'asc' },
    });
    return events.map(toEventResponse);
  }

  async findOne(actor: User, id: string): Promise<EventResponseDto> {
    const event = await this.findEventOrThrow(id);
    if (!this.canRead(actor, event)) {
      throw new ForbiddenException('You cannot access this event');
    }
    return toEventResponse(event);
  }

  approve(actor: User, id: string): Promise<EventResponseDto> {
    return this.moderate(actor, id, { status: EventStatuses.ON_VOTE });
  }

  decline(actor: User, id: string, dto: DeclineEventDto): Promise<EventResponseDto> {
    return this.moderate(actor, id, {
      status: EventStatuses.DECLINED,
      declineReason: dto.reason ?? null,
    });
  }

  // ---- internals ----

  private canRead(actor: User, event: EventWithUsers): boolean {
    return (
      actor.role === UserRoles.ADMIN ||
      actor.id === event.initiatorId ||
      actor.id === event.teacherId
    );
  }

  /** Only the assigned teacher may decide, and only while the event is ON_MODERATION. */
  private async moderate(
    actor: User,
    id: string,
    data: Prisma.EventUpdateManyMutationInput,
  ): Promise<EventResponseDto> {
    const event = await this.findEventOrThrow(id);
    if (actor.id !== event.teacherId) {
      throw new ForbiddenException('Only the assigned teacher can moderate this event');
    }
    if (event.status !== EventStatuses.ON_MODERATION) {
      throw new ConflictException(`Event is already ${event.status}`);
    }

    // The status condition makes the transition atomic: if two requests race,
    // only the first one changes the row, the second gets 409.
    const { count } = await this.prisma.event.updateMany({
      where: { id, teacherId: actor.id, status: EventStatuses.ON_MODERATION },
      data,
    });
    if (count === 0) {
      throw new ConflictException('Event has already been moderated');
    }
    return toEventResponse(await this.findEventOrThrow(id));
  }

  /**
   * Picks the teacher of the class. If a class has several teachers, the one
   * with the smallest id is chosen, so the choice is stable.
   */
  private async findClassTeacher(className: string): Promise<User> {
    const teacher = await this.prisma.user.findFirst({
      where: { role: UserRoles.TEACHER, class: className },
      orderBy: { id: 'asc' },
    });
    if (!teacher) {
      throw new BadRequestException(`Class "${className}" has no teacher to moderate the event`);
    }
    return teacher;
  }

  private async findEventOrThrow(id: string): Promise<EventWithUsers> {
    const event = await this.prisma.event.findUnique({ where: { id }, include: WITH_USERS });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private async withPrismaErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Event with this name already exists');
      }
      throw error;
    }
  }
}
