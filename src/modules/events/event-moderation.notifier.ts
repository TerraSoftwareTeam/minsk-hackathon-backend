import { Injectable, Logger } from '@nestjs/common';
import { EventStatuses, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notifications/push.service';

export const MODERATION_PUSH_TYPES = {
  TEACHER: 'EVENT_TEACHER_MODERATION',
  ADMIN: 'EVENT_ADMIN_MODERATION',
  DECISION: 'EVENT_DECISION',
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
  const chars = Array.from(text.trim());
  return chars.length <= maxLength ? chars.join('') : `${chars.slice(0, maxLength - 1).join('')}…`;
}
