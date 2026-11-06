import { DevicePlatforms, User, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DeviceTokensService } from './device-tokens.service';

const teacher: User = {
  id: 'teacher-1',
  schoolsById: 't1',
  name: 'N',
  surname: 'S',
  fathersName: 'F',
  class: '10A',
  role: UserRoles.TEACHER,
};

describe('DeviceTokensService', () => {
  let tx: { deviceToken: { deleteMany: jest.Mock; upsert: jest.Mock } };
  let prisma: { deviceToken: { deleteMany: jest.Mock }; $transaction: jest.Mock };
  let service: DeviceTokensService;

  beforeEach(() => {
    tx = { deviceToken: { deleteMany: jest.fn(), upsert: jest.fn() } };
    prisma = {
      deviceToken: { deleteMany: jest.fn() },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    service = new DeviceTokensService(prisma as unknown as PrismaService);
  });

  it('upserts the token for the caller, taking it over from another user', async () => {
    await service.register(teacher, { token: 'tok', platform: DevicePlatforms.ANDROID });

    expect(tx.deviceToken.deleteMany).not.toHaveBeenCalled();
    expect(tx.deviceToken.upsert).toHaveBeenCalledWith({
      where: { token: 'tok' },
      create: { token: 'tok', userId: teacher.id, platform: DevicePlatforms.ANDROID, deviceId: null },
      update: { userId: teacher.id, platform: DevicePlatforms.ANDROID, deviceId: null },
    });
  });

  it('with deviceId, replaces the previous token of the same device', async () => {
    await service.register(teacher, { token: 'new', deviceId: 'dev-1' });

    expect(tx.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: teacher.id, deviceId: 'dev-1', token: { not: 'new' } },
    });
    expect(tx.deviceToken.upsert).toHaveBeenCalled();
  });

  it("deletes only the caller's own token", async () => {
    await service.remove(teacher, { token: 'tok' });

    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { token: 'tok', userId: teacher.id },
    });
  });
});
