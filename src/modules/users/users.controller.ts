import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User, UserRoles } from '../../../prisma/generated/prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { ApiUuidParam } from '../../common/swagger/api-uuid-param.decorator';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

const ROLE_HINT =
  'Admin: any user. Teacher: self and pupils of own class (same class). Pupil: self only.';

@ApiTags('Users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' })
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a user',
    description:
      "Admin: any role (PUPIL/TEACHER need schoolsById and class; ADMIN must not have them). Teacher: PUPIL only, class is taken from the teacher. Pupil: forbidden.",
  })
  @ApiBody({
    type: CreateUserDto,
    examples: {
      teacherCreatesPupil: {
        summary: 'Teacher creates a pupil of own class',
        value: {
          schoolsById: 'school-user-789',
          name: 'Petr',
          surname: 'Petrov',
          role: UserRoles.PUPIL,
        },
      },
      adminCreatesAdmin: {
        summary: 'Admin creates an admin',
        value: { name: 'Anna', surname: 'Admin', role: UserRoles.ADMIN },
      },
    },
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed or school fields do not match the role' })
  @ApiForbiddenResponse({ description: 'Caller may not create this user' })
  @ApiConflictResponse({ description: 'User with this schoolsById already exists' })
  create(@CurrentUser() actor: User, @Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersService.create(actor, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List users the caller can manage', description: ROLE_HINT })
  @ApiOkResponse({ type: [UserResponseDto] })
  findAll(@CurrentUser() actor: User): Promise<UserResponseDto[]> {
    return this.usersService.findAll(actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id', description: ROLE_HINT })
  @ApiUuidParam()
  @ApiOkResponse({ type: UserResponseDto })
  @ApiForbiddenResponse({ description: 'Caller may not manage this user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  findOne(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDto> {
    return this.usersService.findOne(actor, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a user',
    description: `${ROLE_HINT} Only an admin can change role, class, schoolsById; others change name and surname.`,
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUuidParam('validation failed, or school fields do not match the role')
  @ApiForbiddenResponse({ description: 'Caller may not change this user or these fields' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiConflictResponse({ description: 'User with this schoolsById already exists' })
  update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.usersService.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user', description: ROLE_HINT })
  @ApiUuidParam()
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ description: 'Caller may not manage this user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiConflictResponse({
    description: 'User is referenced by other records (e.g. created or moderates events)',
  })
  remove(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.usersService.remove(actor, id);
  }
}
