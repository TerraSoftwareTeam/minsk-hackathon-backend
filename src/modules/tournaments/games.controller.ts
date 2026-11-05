import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TournamentGame, User } from '../../../prisma/generated/prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { GameResultDto } from './dto/game.dto';
import { GamesService } from './games.service';

const WHO =
  'Organizator; a teacher of the school for school-stage games; any teacher for district and city games. Pupils cannot.';

@ApiTags('Games')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' })
@ApiBadRequestResponse({ description: 'Equal scores (no draws in playoffs)' })
@ApiForbiddenResponse({ description: WHO })
@UseGuards(JwtAuthGuard)
@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TournamentGame> {
    return this.games.findOne(id);
  }

  @Post(':id/result')
  @ApiOperation({
    summary: 'Record the result of a READY game',
    description: `${WHO} The winner advances automatically; the last final of a stage starts the next stage.`,
  })
  @ApiConflictResponse({
    description: 'Game not READY or result already recorded, or stage finished',
  })
  record(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GameResultDto,
  ): Promise<TournamentGame> {
    return this.games.recordResult(actor, id, dto);
  }

  @Put(':id/result')
  @ApiOperation({
    summary: 'Correct the result of a finished game',
    description: `${WHO} Allowed while the stage is in progress and, if the winner changes, only if the old winner has not played the next game.`,
  })
  @ApiConflictResponse({
    description: 'Next game already played, or stage finished',
  })
  correct(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GameResultDto,
  ): Promise<TournamentGame> {
    return this.games.correctResult(actor, id, dto);
  }
}
