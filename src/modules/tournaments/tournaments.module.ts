import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { StageEngineService } from './stage-engine.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { TournamentScheduler } from './tournament.scheduler';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TournamentsController, TeamsController, GamesController],
  providers: [
    TournamentsService,
    TeamsService,
    GamesService,
    StageEngineService,
    TournamentScheduler,
  ],
})
export class TournamentsModule {}
