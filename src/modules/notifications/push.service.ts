import { Inject, Injectable, Logger } from '@nestjs/common';
import { Messaging, MulticastMessage } from 'firebase-admin/messaging';
import { PrismaService } from '../../prisma/prisma.service';
import { FIREBASE_MESSAGING } from './firebase.provider';

export type PushNotification = {
  title: string;
  body: string;
  /** Delivered to the app as is, e.g. to open the right screen. FCM accepts only string values. */
  data: Record<string, string>;
};

/** FCM accepts at most 500 tokens per multicast request. */
const MAX_TOKENS_PER_REQUEST = 500;

/**
 * The token will never work again: the app was uninstalled, its data cleared,
 * or the token is malformed.
 * INVALID_ARGUMENT (400) is also returned for a bad message (e.g. a wrong data
 * field), then the tokens are fine: it counts only when it is about the token.
 */
function isDeadToken(error: { code: string; message: string }): boolean {
  switch (error.code) {
    case 'messaging/registration-token-not-registered': // UNREGISTERED (404)
    case 'messaging/invalid-registration-token':
      return true;
    case 'messaging/invalid-argument': // HTTP v1: "The registration token is not a valid FCM registration token"
      return /registration token/i.test(error.message);
    default:
      return false;
  }
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FIREBASE_MESSAGING) private readonly messaging: Messaging | null,
  ) {}

  /**
   * Sends the notification to every device of the users. Dead tokens are
   * deleted. Never throws: a push is a side effect, its failure is only logged.
   */
  async sendToUsers(userIds: string[], notification: PushNotification): Promise<void> {
    if (!this.messaging || userIds.length === 0) {
      return;
    }
    try {
      const rows = await this.prisma.deviceToken.findMany({
        where: { userId: { in: [...new Set(userIds)] } },
        select: { token: true },
      });
      const tokens = rows.map((row) => row.token);
      for (let i = 0; i < tokens.length; i += MAX_TOKENS_PER_REQUEST) {
        await this.sendBatch(tokens.slice(i, i + MAX_TOKENS_PER_REQUEST), notification);
      }
    } catch (error) {
      this.logger.error('Failed to send push notifications', error instanceof Error ? error.stack : error);
    }
  }

  private async sendBatch(tokens: string[], { title, body, data }: PushNotification): Promise<void> {
    const message: MulticastMessage = {
      tokens,
      notification: { title, body },
      data,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    };
    const response = await this.messaging!.sendEachForMulticast(message);

    const dead: string[] = [];
    response.responses.forEach(({ error }, index) => {
      if (!error) {
        return;
      }
      if (isDeadToken(error)) {
        dead.push(tokens[index]);
      } else {
        this.logger.warn(`Push to a device failed: ${error.code} ${error.message}`);
      }
    });
    if (dead.length > 0) {
      await this.prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
      this.logger.log(`Removed ${dead.length} dead device token(s)`);
    }
  }
}
