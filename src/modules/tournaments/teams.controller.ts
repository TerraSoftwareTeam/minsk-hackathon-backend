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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from '../../../prisma/generated/prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import {
  AddMemberDto,
  TeamNameDto,
  TeamResponseDto,
  TransferCreatorDto,
} from './dto/team.dto';
import { TeamsService } from './teams.service';

const MANAGERS =
  'Team creator, a teacher of the team school, or an organizator.';
const LOCKED = 'Rosters are locked once the school stage has started';

@ApiTags('Teams')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' })
@ApiConflictResponse({ description: LOCKED })
@UseGuards(JwtAuthGuard)
@Controller()
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('tournaments/:tournamentId/teams')
  @ApiQuery({ name: 'schoolId', required: false })
  @ApiOkResponse({ type: [TeamResponseDto] })
  list(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Query('schoolId') schoolId?: string,
  ): Promise<TeamResponseDto[]> {
    return this.teams.list(tournamentId, schoolId);
  }

  @Post('tournaments/:tournamentId/teams')
  @ApiOperation({
    summary: 'Create a team',
    description: 'Pupils only. The creator becomes the first member.',
  })
  @ApiOkResponse({ type: TeamResponseDto })
  @ApiForbiddenResponse({ description: 'Not a pupil' })
  create(
    @CurrentUser() actor: User,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: TeamNameDto,
  ): Promise<TeamResponseDto> {
    return this.teams.create(actor, tournamentId, dto.name);
  }

  @Get('teams/:id')
  @ApiOkResponse({ type: TeamResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TeamResponseDto> {
    return this.teams.findOne(id);
  }

  @Patch('teams/:id')
  @ApiOperation({ summary: 'Rename a team', description: MANAGERS })
  @ApiOkResponse({ type: TeamResponseDto })
  rename(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TeamNameDto,
  ): Promise<TeamResponseDto> {
    return this.teams.rename(actor, id, dto.name);
  }

  @Delete('teams/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a team', description: MANAGERS })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.teams.remove(actor, id);
  }

  @Post('teams/:id/members')
  @ApiOperation({
    summary: 'Add a member',
    description: `A pupil may join any team of their own school by passing their own id. Otherwise: ${MANAGERS}`,
  })
  @ApiOkResponse({ type: TeamResponseDto })
  @ApiConflictResponse({
    description: `Team full, pupil already in a team, or: ${LOCKED}`,
  })
  addMember(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
  ): Promise<TeamResponseDto> {
    return this.teams.addMember(actor, id, dto.userId);
  }

  @Delete('teams/:id/members/:userId')
  @ApiOperation({
    summary: 'Leave or remove a member',
    description: `Anyone may remove themselves. Removing others: ${MANAGERS} The creator must transfer rights first unless they are the only member, in which case leaving deletes the team (response body is null).`,
  })
  @ApiOkResponse({ type: TeamResponseDto })
  removeMember(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TeamResponseDto | null> {
    return this.teams.removeMember(actor, id, userId);
  }

  @Post('teams/:id/creator')
  @ApiOperation({
    summary: 'Transfer creator rights to another member',
    description: MANAGERS,
  })
  @ApiOkResponse({ type: TeamResponseDto })
  transferCreator(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferCreatorDto,
  ): Promise<TeamResponseDto> {
    return this.teams.transferCreator(actor, id, dto.userId);
  }
}
