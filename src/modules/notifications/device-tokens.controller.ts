import { Body, Controller, Delete, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from '../../../prisma/generated/prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { DeviceTokensService } from './device-tokens.service';
import { DeleteDeviceTokenDto } from './dto/delete-device-token.dto';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

@ApiTags('Push notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' })
@UseGuards(JwtAuthGuard)
@Controller('device-token')
export class DeviceTokensController {
  constructor(private readonly deviceTokens: DeviceTokensService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Save or refresh the FCM token of this device',
    description:
      'Call on login and on every app start. Any role. A token registered by another user moves to the caller. ' +
      'With deviceId, a previous token of the same device is replaced.',
  })
  @ApiBody({ type: RegisterDeviceTokenDto })
  @ApiNoContentResponse({ description: 'Saved' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  register(@CurrentUser() actor: User, @Body() dto: RegisterDeviceTokenDto): Promise<void> {
    return this.deviceTokens.register(actor, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete the FCM token of this device',
    description:
      "Call on logout, before dropping the JWT, so the device stops getting this user's pushes. " +
      'The token is sent in the JSON body. Idempotent.',
  })
  @ApiBody({ type: DeleteDeviceTokenDto })
  @ApiNoContentResponse({ description: 'Deleted, or there was no such token of the caller' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  remove(@CurrentUser() actor: User, @Body() dto: DeleteDeviceTokenDto): Promise<void> {
    return this.deviceTokens.remove(actor, dto);
  }
}
