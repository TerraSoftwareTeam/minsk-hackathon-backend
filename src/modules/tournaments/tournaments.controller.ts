import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { StageType, User } from '../../../prisma/generated/prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import {
  CreateTournamentDto,
  TournamentResponseDto,
  UpdateTournamentDto,
} from './dto/tournament.dto';
import { StageView, TournamentsService } from './tournaments.service';

@ApiTags('Tournaments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' })
@UseGuards(JwtAuthGuard)
@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create (launch) a tournament',
    description:
      'Organizator only. Only one unfinished tournament may exist. The school stage starts automatically at schoolStageStartAt (Europe/Minsk if no offset is given).',
  })
  @ApiOkResponse({ type: TournamentResponseDto })
  @ApiForbiddenResponse({ description: 'Not an organizator' })
  @ApiConflictResponse({
    description: 'Another tournament is not finished yet',
  })
  create(
    @CurrentUser() actor: User,
    @Body() dto: CreateTournamentDto,
  ): Promise<TournamentResponseDto> {
    return this.tournaments.create(actor, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List tournaments' })
  @ApiOkResponse({ type: [TournamentResponseDto] })
  findAll(): Promise<TournamentResponseDto[]> {
    return this.tournaments.findAll();
  }

  @Get('current')
  @ApiOperation({ summary: 'The unfinished tournament, if any' })
  @ApiOkResponse({ type: TournamentResponseDto })
  @ApiNotFoundResponse({ description: 'No active tournament' })
  findCurrent(): Promise<TournamentResponseDto> {
    return this.tournaments.findCurrent();
  }

  @Get(':id')
  @ApiOkResponse({ type: TournamentResponseDto })
  @ApiNotFoundResponse({ description: 'Tournament not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TournamentResponseDto> {
    return this.tournaments.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change name, team sizes or school-stage start',
    description:
      'Organizator only, before the school stage starts. Afterwards (brackets built) returns 409.',
  })
  @ApiOkResponse({ type: TournamentResponseDto })
  @ApiConflictResponse({
    description:
      'School stage already started, or maxTeamSize below an existing team',
  })
  update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTournamentDto,
  ): Promise<TournamentResponseDto> {
    return this.tournaments.update(actor, id, dto);
  }

  @Get(':id/stages/:type')
  @ApiOperation({
    summary: 'Stage brackets and games',
    description:
      'SCHOOL: one bracket per school; DISTRICT: one per district; CITY: one bracket plus `districts` — all 9 districts with QUALIFIED / NO_WINNER, so the organizator sees which districts are missing.',
  })
  @ApiParam({ name: 'type', enum: StageType })
  @ApiNotFoundResponse({
    description: 'Tournament not found or school stage not started',
  })
  getStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('type', new ParseEnumPipe(StageType)) type: StageType,
  ): Promise<StageView> {
    return this.tournaments.getStage(id, type);
  }
}
