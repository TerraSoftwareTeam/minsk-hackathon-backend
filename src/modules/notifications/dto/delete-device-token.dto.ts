import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeleteDeviceTokenDto {
  @ApiProperty({
    example: 'fcm-registration-token-from-firebase-messaging-getToken',
    maxLength: 4096,
    description: 'FCM registration token to stop sending pushes to',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;
}
