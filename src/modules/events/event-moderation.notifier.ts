import { Injectable, Logger } from '@nestjs/common';
import { EventStatuses, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notifications/push.service';

/** `data.type` of the push, the app uses it to open the right screen. */
export const MODERATION_PUSH_TYPES = {
  /** To the teacher: an event awaits their moderation. */
  TEACHER: 'EVENT_TEACHER_MODERATION',
  /** To the admins: an event collected its votes and awaits their decision. */
  ADMIN: 'EVENT_ADMIN_MODERATION',
  /** To the author: the teacher or an admin approved or declined their event, `data.status` says which. */
  DECISION: 'EVENT_DECISION',
} as const;

/** A moderation decision and the status it moves the event to. */
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

/**
 * The reason is up to 2000 characters, FCM limits the whole message to 4 KB:
 * the push shows the beginning, the app shows the full reason in the event.
 */
const MAX_REASON_IN_PUSH = 200;

type NotifiedEvent = {
  id: string;
  name: string;
  teacherId: string;
  initiator: { name: string; surname: string; class: string | null };
};

/**
 * Pushes to whoever has to moderate an event:
 * - the assigned teacher, when a pupil creates it (ON_MODERATION);
 * - every admin, when it collects its votes (ON_ADMIN_MODERATION);
 * and to its author, when the teacher or an admin approves or declines it.
 * Fire-and-forget: the methods return at once and never throw, a failed push
 * does not affect the request that triggered it.
 */
@Injectable()
export class EventModerationNotifier {
  private readonly logger = new Logger(EventModerationNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  awaitsTeacher(event: NotifiedEvent): void {
    const { name, surname, class: className } = event.initiator;
    this.run(() =>
      this.push.sendToUsers([event.teacherId], {
        title: 'Новое мероприятие на модерации',
        body: `«${event.name}» — ${surname} ${name}${className ? `, ${className}` : ''}`,
        data: {
          type: MODERATION_PUSH_TYPES.TEACHER,
          eventId: event.id,
          status: EventStatuses.ON_MODERATION,
        },
      }),
    );
  }

  awaitsAdmin(eventId: string): void {
    this.run(async () => {
      const [event, admins] = await Promise.all([
        this.prisma.event.findUnique({ where: { id: eventId }, select: { name: true } }),
        this.prisma.user.findMany({ where: { role: UserRoles.ADMIN }, select: { id: true } }),
      ]);
      if (!event) {
        return;
      }
      await this.push.sendToUsers(
        admins.map((admin) => admin.id),
        {
          title: 'Мероприятие ждёт вашего решения',
          body: `«${event.name}» набрало нужное число голосов`,
          data: {
            type: MODERATION_PUSH_TYPES.ADMIN,
            eventId,
            status: EventStatuses.ON_ADMIN_MODERATION,
          },
        },
      );
    });
  }

  decisionMade(
    event: { id: string; name: string; initiatorId: string },
    status: DecisionStatus,
    declineReason: string | null = null,
  ): void {
    const text = DECISION_TEXTS[status];
    let body = text.body(event.name);
    if (declineReason) {
      body += `. Причина: ${truncate(declineReason, MAX_REASON_IN_PUSH)}`;
    }
    this.run(() =>
      this.push.sendToUsers([event.initiatorId], {
        title: text.title,
        body,
        data: { type: MODERATION_PUSH_TYPES.DECISION, eventId: event.id, status },
      }),
    );
  }

  private run(task: () => Promise<void>): void {
    task().catch((error: unknown) =>
      this.logger.error('Failed to notify moderators', error instanceof Error ? error.stack : error),
    );
  }
}

function truncate(text: string, maxLength: number): string {
  // Array.from splits by code points, so an emoji is not cut in half.
  const chars = Array.from(text.trim());
  return chars.length <= maxLength ? chars.join('') : `${chars.slice(0, maxLength - 1).join('')}…`;
}
