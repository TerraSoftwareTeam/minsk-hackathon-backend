import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { DeviceTokensController } from './device-tokens.controller';
import { DeviceTokensService } from './device-tokens.service';
import { FirebaseMessagingProvider } from './firebase.provider';
import { PushService } from './push.service';

/**
 * Push notifications through Firebase Cloud Messaging: stores the devices'
 * FCM tokens (/device-token) and sends pushes to users (PushService).
 */
@Module({
  // AuthModule provides JwtService for JwtAuthGuard.
  imports: [PrismaModule, AuthModule],
  controllers: [DeviceTokensController],
  providers: [DeviceTokensService, PushService, FirebaseMessagingProvider],
  exports: [PushService],
})
export class NotificationsModule {}
