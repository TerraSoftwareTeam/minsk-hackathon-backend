import { Injectable } from '@nestjs/common';
import { User } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DeleteDeviceTokenDto } from './dto/delete-device-token.dto';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

/** FCM tokens of the users' devices. A user may have several devices, each with its own token. */
@Injectable()
export class DeviceTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Saves the token for the caller, called on login and on app start.
   * A token already stored for another user moves to the caller: the device
   * belongs to whoever logged in on it last, so the previous user gets no pushes there.
   */
  async register(actor: User, dto: RegisterDeviceTokenDto): Promise<void> {
    const platform = dto.platform ?? null;
    const deviceId = dto.deviceId ?? null;
    await this.prisma.$transaction(async (tx) => {
      if (deviceId) {
        // The device got a new token: the old one is no longer valid.
        await tx.deviceToken.deleteMany({
          where: { userId: actor.id, deviceId, token: { not: dto.token } },
        });
      }
      await tx.deviceToken.upsert({
        where: { token: dto.token },
        create: { token: dto.token, userId: actor.id, platform, deviceId },
        update: { userId: actor.id, platform, deviceId },
      });
    });
  }

  /** Forgets the caller's token, called on logout. Idempotent: an unknown token is not an error. */
  async remove(actor: User, dto: DeleteDeviceTokenDto): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { token: dto.token, userId: actor.id } });
  }
}
