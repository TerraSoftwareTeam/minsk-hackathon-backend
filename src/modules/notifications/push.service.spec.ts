import { Messaging } from 'firebase-admin/messaging';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from './push.service';

const notification = { title: 'T', body: 'B', data: { eventId: 'e1' } };

const ok = () => ({ success: true, messageId: 'm' });
const failed = (code: string, message = code) => ({ success: false, error: { code, message } });
const BAD_TOKEN = 'The registration token is not a valid FCM registration token';

describe('PushService', () => {
  let prisma: { deviceToken: { findMany: jest.Mock; deleteMany: jest.Mock } };
  let messaging: { sendEachForMulticast: jest.Mock };
  let service: PushService;

  const stored = (...tokens: string[]) =>
    prisma.deviceToken.findMany.mockResolvedValue(tokens.map((token) => ({ token })));
  const replies = (...responses: object[]) =>
    messaging.sendEachForMulticast.mockResolvedValueOnce({ responses });

  beforeEach(() => {
    prisma = {
      deviceToken: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    messaging = { sendEachForMulticast: jest.fn() };
    service = new PushService(
      prisma as unknown as PrismaService,
      messaging as unknown as Messaging,
    );
  });

  it('sends to all devices of the users', async () => {
    stored('t1', 't2');
    replies(ok(), ok());

    await service.sendToUsers(['u1', 'u2', 'u1'], notification);

    expect(prisma.deviceToken.findMany).toHaveBeenCalledWith({
      where: { userId: { in: ['u1', 'u2'] } },
      select: { token: true },
    });
    expect(messaging.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['t1', 't2'],
        notification: { title: 'T', body: 'B' },
        data: { eventId: 'e1' },
      }),
    );
    expect(prisma.deviceToken.deleteMany).not.toHaveBeenCalled();
  });

  it('does not call FCM when the users have no devices', async () => {
    await service.sendToUsers(['u1'], notification);
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('deletes UNREGISTERED and INVALID_ARGUMENT tokens, keeps the others', async () => {
    stored('alive', 'unregistered', 'malformed', 'invalid', 'unavailable');
    replies(
      ok(),
      failed('messaging/registration-token-not-registered'),
      failed('messaging/invalid-argument', BAD_TOKEN),
      failed('messaging/invalid-registration-token'),
      failed('messaging/server-unavailable'),
    );

    await service.sendToUsers(['u1'], notification);

    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['unregistered', 'malformed', 'invalid'] } },
    });
  });

  it('deletes the tokens even when every one of them is malformed', async () => {
    stored('t1', 't2');
    replies(failed('messaging/invalid-argument', BAD_TOKEN), failed('messaging/invalid-argument', BAD_TOKEN));

    await service.sendToUsers(['u1'], notification);

    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { token: { in: ['t1', 't2'] } } });
  });

  it('keeps the tokens when INVALID_ARGUMENT is about the message, not the token', async () => {
    stored('t1');
    replies(failed('messaging/invalid-argument', "Invalid value at 'message.data[0].value'"));

    await service.sendToUsers(['u1'], notification);

    expect(prisma.deviceToken.deleteMany).not.toHaveBeenCalled();
  });

  it('sends in batches of 500 tokens', async () => {
    const tokens = Array.from({ length: 501 }, (_, i) => `t${i}`);
    stored(...tokens);
    replies(...tokens.slice(0, 500).map(ok));
    replies(ok());

    await service.sendToUsers(['u1'], notification);

    expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(messaging.sendEachForMulticast.mock.calls[1][0].tokens).toEqual(['t500']);
  });

  it('never throws: a failure is only logged', async () => {
    stored('t1');
    messaging.sendEachForMulticast.mockRejectedValue(new Error('network'));
    await expect(service.sendToUsers(['u1'], notification)).resolves.toBeUndefined();
  });

  it('does nothing when Firebase is not configured', async () => {
    service = new PushService(prisma as unknown as PrismaService, null);
    await service.sendToUsers(['u1'], notification);
    expect(prisma.deviceToken.findMany).not.toHaveBeenCalled();
  });
});
