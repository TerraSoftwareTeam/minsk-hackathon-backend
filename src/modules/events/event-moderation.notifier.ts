import { Injectable, Logger } from '@nestjs/common';
import { EventStatuses, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notifications/push.service';
import { PARTICIPANT_EXP } from './event-exp';

export const MODERATION_PUSH_TYPES = {
  TEACHER: 'EVENT_TEACHER_MODERATION',
  ADMIN: 'EVENT_ADMIN_MODERATION',
  DECISION: 'EVENT_DECISION',
  SENT_TO_ADMIN: 'EVENT_SENT_TO_ADMIN',
  FINALIZED_BY_VOTES: 'EVENT_FINALIZED_BY_VOTES',
  /** To the participants (voters) of an event that takes place. */
  FINALIZED: 'EVENT_FINALIZED',
} as const;

export type DecisionStatus = 'ON_VOTE' | 'DECLINED' | 'FINALIZED' | 'DECLINED_BY_ADMIN';

const DECISION_TEXTS: Record<DecisionStatus, { title: string; body: (name: string) => string }> = {
  [EventStatuses.ON_VOTE]: {
    title: 'Учитель одобрил мероприятие',
    body: (name) => `«${name}» вышло на голосование`,
  },
  [EventStatuses.DECLINED]: {
    title: 'Учитель отклонил мероприятие',
    body: (name) => `«${name}»`,
  },
  [EventStatuses.FINALIZED]: {
    title: 'Мероприятие одобрено',
    body: (name) => `Администрация одобрила «${name}»`,
  },
  [EventStatuses.DECLINED_BY_ADMIN]: {
    title: 'Администрация отклонила мероприятие',
    body: (name) => `«${name}»`,
  },
};

const MAX_REASON_IN_PUSH = 200;

/** Event dates are shown in the school's local time. */
const STARTS_AT_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Minsk',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

type NotifiedEvent = {
  id: string;
  name: string;
  initiator: { name: string; surname: string; class: string | null };
};

@Injectable()
export class EventModerationNotifier {
  private readonly logger = new Logger(EventModerationNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  awaitsTeachers(event: NotifiedEvent): void {
    const { name, surname, class: className } = event.initiator;
    if (!className) {
      return;
    }
    this.run(async () => {
      const teachers = await this.prisma.user.findMany({
        where: { role: UserRoles.TEACHER, class: className },
        select: { id: true },
      });
      if (teachers.length === 0) {
        return;
      }
      await this.push.sendToUsers(
        teachers.map((teacher) => teacher.id),
        {
          title: 'Новое мероприятие на модерации',
          body: `«${event.name}» — ${surname} ${name}, ${className}`,
          data: {
            type: MODERATION_PUSH_TYPES.TEACHER,
            eventId: event.id,
            status: EventStatuses.ON_MODERATION,
          },
        },
      );
    });
  }

  awaitsAdmin(eventId: string): void {
    this.run(async () => {
      const [event, admins] = await Promise.all([
        this.prisma.event.findUnique({
          where: { id: eventId },
          select: { name: true, initiatorId: true, createdByRole: true },
        }),
        this.adminIds(),
      ]);
      if (!event) {
        return;
      }
      const status = EventStatuses.ON_ADMIN_MODERATION;
      await Promise.all([
        this.push.sendToUsers(admins, {
          title: 'Мероприятие ждёт вашего решения',
          body: `«${event.name}» набрало нужное число голосов`,
          data: { type: MODERATION_PUSH_TYPES.ADMIN, eventId, status },
        }),
        event.createdByRole === UserRoles.TEACHER
          ? this.push.sendToUsers([event.initiatorId], {
              title: 'Мероприятие передано администрации',
              body: `«${event.name}» набрало нужное число голосов и ждёт решения администрации`,
              data: { type: MODERATION_PUSH_TYPES.SENT_TO_ADMIN, eventId, status },
            })
          : Promise.resolve(),
      ]);
    });
  }

  finalizedByVotes(eventId: string, participantIds: string[]): void {
    this.run(async () => {
      const [event, admins] = await Promise.all([
        this.prisma.event.findUnique({
          where: { id: eventId },
          select: { name: true, startsAt: true },
        }),
        this.adminIds(),
      ]);
      if (!event) {
        return;
      }
      await Promise.all([
        this.push.sendToUsers(admins, {
          title: 'Школьное мероприятие состоится',
          body: `«${event.name}» набрало нужное число голосов`,
          data: {
            type: MODERATION_PUSH_TYPES.FINALIZED_BY_VOTES,
            eventId,
            status: EventStatuses.FINALIZED,
          },
        }),
        event.startsAt
          ? this.sendToParticipants({ id: eventId, name: event.name, startsAt: event.startsAt }, participantIds)
          : Promise.resolve(),
      ]);
    });
  }

  /** The event takes place: every participant learns the date and the exp they got. */
  participantsFinalized(event: { id: string; name: string; startsAt: Date }, participantIds: string[]): void {
    this.run(() => this.sendToParticipants(event, participantIds));
  }

  private sendToParticipants(
    event: { id: string; name: string; startsAt: Date },
    participantIds: string[],
  ): Promise<void> {
    return this.push.sendToUsers(participantIds, {
      title: 'Мероприятие состоится',
      body: `«${event.name}» пройдёт ${STARTS_AT_FORMAT.format(event.startsAt)}. ${expCaption(PARTICIPANT_EXP, 'участие')}`,
      data: {
        type: MODERATION_PUSH_TYPES.FINALIZED,
        eventId: event.id,
        status: EventStatuses.FINALIZED,
        exp: String(PARTICIPANT_EXP),
      },
    });
  }

  decisionMade(
    event: { id: string; name: string; initiatorId: string },
    status: DecisionStatus,
    declineReason: string | null = null,
    /** Exp the initiator got for organizing (FINALIZED); 0 = no exp caption. */
    exp = 0,
  ): void {
    const text = DECISION_TEXTS[status];
    let body = text.body(event.name);
    if (declineReason) {
      body += `. Причина: ${truncate(declineReason, MAX_REASON_IN_PUSH)}`;
    }
    const data: Record<string, string> = { type: MODERATION_PUSH_TYPES.DECISION, eventId: event.id, status };
    if (exp > 0) {
      body += `. ${expCaption(exp, 'организацию')}`;
      data.exp = String(exp);
    }
    this.run(() =>
      this.push.sendToUsers([event.initiatorId], { title: text.title, body, data }),
    );
  }

  private async adminIds(): Promise<string[]> {
    const admins = await this.prisma.user.findMany({
      where: { role: UserRoles.ADMIN },
      select: { id: true },
    });
    return admins.map((admin) => admin.id);
  }

  private run(task: () => Promise<void>): void {
    task().catch((error: unknown) =>
      this.logger.error('Failed to notify moderators', error instanceof Error ? error.stack : error),
    );
  }
}

function expCaption(exp: number, forWhat: string): string {
  return `+${exp} exp за ${forWhat}`;
}

function truncate(text: string, maxLength: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= maxLength ? chars.join('') : `${chars.slice(0, maxLength - 1).join('')}…`;
}
