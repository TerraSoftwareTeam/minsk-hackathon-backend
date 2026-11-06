import { Injectable, Logger } from '@nestjs/common';
import { EventStatuses, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notifications/push.service';

/** `data.type` of the push, the app uses it to open the right moderation queue. */
export const MODERATION_PUSH_TYPES = {
  TEACHER: 'EVENT_TEACHER_MODERATION',
  ADMIN: 'EVENT_ADMIN_MODERATION',
} as const;

type NotifiedEvent = {
  id: string;
  name: string;
  teacherId: string;
  initiator: { name: string; surname: string; class: string | null };
};

/**
 * Pushes to whoever has to moderate an event:
 * - the assigned teacher, when a pupil creates it (ON_MODERATION);
 * - every admin, when it collects its votes (ON_ADMIN_MODERATION).
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

  private run(task: () => Promise<void>): void {
    task().catch((error: unknown) =>
      this.logger.error('Failed to notify moderators', error instanceof Error ? error.stack : error),
    );
  }
}
