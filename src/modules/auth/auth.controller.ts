import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRoles } from '../../../prisma/generated/prisma/client';
import { AuthService } from './auth.service';
import { AuthTokenResponseDto, RegisterDto } from './dto/register.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a user linked to an existing school and returns a JWT access token. Public endpoint, no auth required.',
  })
  @ApiBody({
    type: RegisterDto,
    examples: {
      pupil: {
        summary: 'Pupil',
        value: {
          schoolsById: 'school-user-123',
          name: 'Ivan',
          surname: 'Ivanov',
          fathersName: 'Petrovich',
          role: UserRoles.PUPIL,
          class: '10A',
          schoolName: 'School #1',
        },
      },
      teacher: {
        summary: 'Teacher',
        value: {
          schoolsById: 'school-user-456',
          name: 'Maria',
          surname: 'Sidorova',
          fathersName: 'Ivanovna',
          role: UserRoles.TEACHER,
          class: '10A',
          schoolName: 'School #1',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'User created; JWT returned',
    type: AuthTokenResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed (missing/invalid fields) or school does not exist',
  })
  @ApiConflictResponse({ description: 'User with this schoolsById already exists' })
  register(@Body() dto: RegisterDto): Promise<AuthTokenResponseDto> {
    return this.authService.register(dto);
  }
}
