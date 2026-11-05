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
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from '../../../prisma/generated/prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

const ROLE_HINT =
  'Organizator: any user. Teacher: pupils and self. Pupil: self only.';

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
    description: 'Organizator only. PUPIL/TEACHER need schoolsById, class and schoolName; ORGANIZATOR must not have them.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiForbiddenResponse({ description: 'Actor is not an organizator' })
  create(@CurrentUser() actor: User, @Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersService.create(actor, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List users visible to the caller', description: ROLE_HINT })
  @ApiOkResponse({ type: [UserResponseDto] })
  findAll(@CurrentUser() actor: User): Promise<UserResponseDto[]> {
    return this.usersService.findAll(actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id', description: ROLE_HINT })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiForbiddenResponse({ description: 'Caller may not read this user' })
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
    description:
      'Organizator: any field of any user (school fields only for PUPIL/TEACHER). Pupil and teacher: own name, surname, fathersName, class only.',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiForbiddenResponse({ description: 'Caller may not change this user or these fields' })
  @ApiNotFoundResponse({ description: 'User not found' })
  update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.usersService.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a user',
    description: 'Organizator: any user. Pupil: self only. Teacher: not allowed.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ description: 'Caller may not delete this user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  remove(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.usersService.remove(actor, id);
  }
}
