import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DevicePlatforms } from '../../../../prisma/generated/prisma/client';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    example: 'fcm-registration-token-from-firebase-messaging-getToken',
    maxLength: 4096,
    description: 'FCM registration token of this app install',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;

  @ApiPropertyOptional({ enum: DevicePlatforms, example: DevicePlatforms.ANDROID })
  @IsOptional()
  @IsEnum(DevicePlatforms)
  platform?: DevicePlatforms;

  @ApiPropertyOptional({
    example: '5f8a2c1e-device-install-id',
    maxLength: 255,
    description:
      'Stable id of the app install. When the token of this device is refreshed, the old one is replaced.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId?: string;
}
