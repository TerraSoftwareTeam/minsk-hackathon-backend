import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BracketStatus,
  GameSlot,
  GameStatus,
  StageStatus,
  TournamentGame,
  User,
} from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GameResultDto } from './dto/game.dto';
import { StageEngineService } from './stage-engine.service';
import { canRecordResult } from './tournament-access';
import { LONG_TX, lockTournament, Tx } from './tournament-locks';

/**
 * Recording and correcting game results. Each call is one transaction:
 *   1. save score, winner and status (conditional updateMany: protects from double submit);
 *   2. put the winner into the next game's slot;
 *   3. mark the next game READY when both slots are filled;
 *   4. for a bracket final: finish the bracket, and if it was the last one,
 *      finish the stage and build the next stage right away.
 *
 * The tournament row is locked FOR UPDATE, so concurrent results of one tournament
 * are serialized and "last bracket of the stage" is decided exactly once.
 */
@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: StageEngineService,
  ) {}

  async findOne(gameId: string): Promise<TournamentGame> {
    const game = await this.prisma.tournamentGame.findUnique({
      where: { id: gameId },
    });
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  /** First result of a READY game. A second submission gets 409. */
  async recordResult(
    actor: User,
    gameId: string,
    dto: GameResultDto,
    now = new Date(),
  ): Promise<TournamentGame> {
    return this.withGame(actor, gameId, dto, async (tx, game, winnerTeamId) => {
      const saved = await tx.tournamentGame.updateMany({
        where: { id: game.id, status: GameStatus.READY },
        data: {
          status: GameStatus.FINISHED,
          scoreA: dto.scoreA,
          scoreB: dto.scoreB,
          winnerTeamId,
          resultById: actor.id,
          finishedAt: now,
        },
      });
      if (saved.count === 0) {
        throw new ConflictException(
          game.status === GameStatus.FINISHED
            ? 'The result has already been recorded; use the correction endpoint'
            : `Game is ${game.status}, a result can only be recorded for a READY game`,
        );
      }
      await this.engine.advanceWinner(tx, game, winnerTeamId, now);
    });
  }

  /**
   * Correction of a FINISHED game while its stage is in progress. If the winner
   * changes and the old winner has already played the next game, it is refused;
   * otherwise the new winner replaces the old one in the next game (or as bracket winner).
   */
  async correctResult(
    actor: User,
    gameId: string,
    dto: GameResultDto,
    now = new Date(),
  ): Promise<TournamentGame> {
    return this.withGame(actor, gameId, dto, async (tx, game, winnerTeamId) => {
      if (game.status !== GameStatus.FINISHED) {
        throw new ConflictException('Only a finished game can be corrected');
      }
      const winnerChanged = game.winnerTeamId !== winnerTeamId;

      if (winnerChanged && game.nextGameId) {
        const next = await tx.tournamentGame.findUniqueOrThrow({
          where: { id: game.nextGameId },
        });
        if (next.status === GameStatus.FINISHED) {
          throw new ConflictException(
            'The winner has already played the next game; the result cannot be changed',
          );
        }
      }

      const saved = await tx.tournamentGame.updateMany({
        where: {
          id: game.id,
          status: GameStatus.FINISHED,
          updatedAt: game.updatedAt,
        },
        data: {
          scoreA: dto.scoreA,
          scoreB: dto.scoreB,
          winnerTeamId,
          resultById: actor.id,
          finishedAt: now,
        },
      });
      if (saved.count === 0)
        throw new ConflictException('The game was changed concurrently, retry');
      if (!winnerChanged) return;

      if (game.nextGameId) {
        await tx.tournamentGame.update({
          where: { id: game.nextGameId },
          data:
            game.nextSlot === GameSlot.A
              ? { teamAId: winnerTeamId }
              : { teamBId: winnerTeamId },
        });
      } else {
        // Bracket final; the stage is still running (checked in withGame), only the bracket winner changes.
        await tx.tournamentBracket.update({
          where: { id: game.bracketId },
          data: {
            winnerTeamId,
            status: BracketStatus.FINISHED,
            finishedAt: now,
          },
        });
      }
    });
  }

  private async withGame(
    actor: User,
    gameId: string,
    dto: GameResultDto,
    work: (tx: Tx, game: TournamentGame, winnerTeamId: string) => Promise<void>,
  ): Promise<TournamentGame> {
    if (dto.scoreA === dto.scoreB) {
      throw new BadRequestException('Draws are not allowed in playoffs');
    }
    const existing = await this.findOne(gameId);

    await this.prisma.$transaction(async (tx) => {
      await lockTournament(tx, existing.tournamentId, 'update');
      const game = await tx.tournamentGame.findUniqueOrThrow({
        where: { id: gameId },
        include: {
          stage: true,
          bracket: { include: { school: { select: { name: true } } } },
        },
      });

      if (
        !canRecordResult(
          actor,
          game.stage.type,
          game.bracket.school?.name ?? null,
        )
      ) {
        throw new ForbiddenException('You cannot record results of this game');
      }
      if (game.stage.status !== StageStatus.IN_PROGRESS) {
        throw new ConflictException(
          'The stage is finished; its results are final',
        );
      }
      if (game.status === GameStatus.BYE) {
        throw new ConflictException('A BYE has no result');
      }
      if (!game.teamAId || !game.teamBId) {
        throw new ConflictException('Both teams of the game are not known yet');
      }

      const winnerTeamId =
        dto.scoreA > dto.scoreB ? game.teamAId : game.teamBId;
      await work(tx, game, winnerTeamId);
    }, LONG_TX);

    return this.findOne(gameId);
  }
}
