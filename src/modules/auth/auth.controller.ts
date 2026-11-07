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
import { AuthResponseDto, LoginDto, RegisterDto } from './dto/register.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register or log in (PUPIL / TEACHER / ADMIN)',
    description:
      'If a user with this schoolsById exists (ADMIN included), logs them in and ignores the other fields. ' +
      'Otherwise creates a new user from name, surname and role (required then); class is required for PUPIL/TEACHER ' +
      'and must be omitted for ADMIN. ' +
      'A pupil may register into a class that has no teacher yet; their events wait for one, ' +
      'and every teacher of the class (also one who registers later) moderates them. ' +
      'Returns a JWT access token either way. Public endpoint, no auth required.',
  })
  @ApiBody({
    type: RegisterDto,
    examples: {
      existing: {
        summary: 'Existing user of any role, ADMIN included (log in)',
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
      admin: {
        summary: 'New admin',
        value: {
          schoolsById: 'admin-001',
          name: 'Olga',
          surname: 'Kovaleva',
          role: UserRoles.ADMIN,
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
      'Validation failed (invalid fields, blank class, unknown fields), a new user is missing name/surname/role/class, or a new ADMIN was given a class',
  })
  @ApiForbiddenResponse({
    description: 'Existing PUPIL or TEACHER has no class assigned',
  })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in',
    description:
      'Every role logs in by schoolsById. Public endpoint, no auth required.',
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
        value: { role: UserRoles.ADMIN, schoolsById: 'admin-001' },
      },
    },
  })
  @ApiOkResponse({
    description: 'JWT and user returned',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed (missing schoolsById or unknown role)',
  })
  @ApiUnauthorizedResponse({
    description: 'No user with this role and identifier',
  })
  @ApiForbiddenResponse({
    description: 'PUPIL or TEACHER has no class assigned',
  })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }
}
