import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRoles } from '../../../prisma/generated/prisma/client';
import { AuthService } from './auth.service';
import {
  AuthResponseDto,
  LoginDto,
  RegisterDto,
} from './dto/register.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register or log in (PUPIL / TEACHER)',
    description:
      'If a user with this schoolsById exists, logs them in and ignores the other fields. ' +
      'Otherwise creates a new user from name, surname, role and class (all required then). ' +
      'Returns a JWT access token either way. Public endpoint, no auth required.',
  })
  @ApiBody({
    type: RegisterDto,
    examples: {
      existing: {
        summary: 'Existing user (log in)',
        value: { schoolsById: 'school-user-123' },
      },
      pupil: {
        summary: 'New pupil',
        value: {
          schoolsById: 'school-user-123',
          name: 'Ivan',
          surname: 'Ivanov',
          role: UserRoles.PUPIL,
          class: '10A',
        },
      },
      teacher: {
        summary: 'New teacher',
        value: {
          schoolsById: 'school-user-456',
          name: 'Maria',
          surname: 'Sidorova',
          role: UserRoles.TEACHER,
          class: '10A',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'User logged in or created; JWT and user returned',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed (invalid fields, blank class, unknown fields), a new user is missing name/surname/role/class, or a new PUPIL registers into a class that has no teacher',
  })
  @ApiForbiddenResponse({ description: 'Existing PUPIL or TEACHER has no class assigned' })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in',
    description:
      'PUPIL and TEACHER log in by schoolsById; ADMIN logs in by id. Admins cannot register, only log in. Public endpoint, no auth required.',
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      pupil: {
        summary: 'Pupil or teacher',
        value: { role: UserRoles.PUPIL, schoolsById: 'school-user-123' },
      },
      admin: {
        summary: 'Admin',
        value: { role: UserRoles.ADMIN, id: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90' },
      },
    },
  })
  @ApiOkResponse({
    description: 'JWT and user returned',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed (missing schoolsById or id for the role)' })
  @ApiUnauthorizedResponse({ description: 'No user with this role and identifier' })
  @ApiForbiddenResponse({ description: 'PUPIL or TEACHER has no class assigned' })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }
}
