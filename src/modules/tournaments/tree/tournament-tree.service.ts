import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StageType } from '../../../../prisma/generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  TournamentTreeDto,
  TournamentTreeQueryDto,
} from './tournament-tree.dto';
import { buildTournamentTree } from './tournament-tree.mapper';

const TEAM = {
  select: {
    id: true,
    name: true,
    school: { select: { id: true, name: true, district: true } },
  },
};

@Injectable()
export class TournamentTreeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The whole tournament as a renderable tree. Filters narrow it down:
   * ?stage=SCHOOL&schoolId=... gives one school bracket, ?stage=DISTRICT&district=... one district.
   */
  async getTree(
    tournamentId: string,
    query: TournamentTreeQueryDto,
  ): Promise<TournamentTreeDto> {
    if (query.schoolId && query.stage && query.stage !== StageType.SCHOOL) {
      throw new BadRequestException(
        'schoolId filter applies to the SCHOOL stage only',
      );
    }
    if (query.district && query.stage && query.stage !== StageType.DISTRICT) {
      throw new BadRequestException(
        'district filter applies to the DISTRICT stage only',
      );
    }

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { winnerTeam: TEAM },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    // A filter on one stage's brackets leaves other stages' brackets untouched.
    const bracketWhere: Prisma.TournamentBracketWhereInput = {
      AND: [
        query.schoolId
          ? {
              OR: [
                { stage: { type: { not: StageType.SCHOOL } } },
                { schoolId: query.schoolId },
              ],
            }
          : {},
        query.district
          ? {
              OR: [
                { stage: { type: { not: StageType.DISTRICT } } },
                { district: query.district },
              ],
            }
          : {},
      ],
    };

    const [stages, districtResults] = await Promise.all([
      this.prisma.tournamentStage.findMany({
        where: { tournamentId, ...(query.stage ? { type: query.stage } : {}) },
        include: {
          brackets: {
            where: bracketWhere,
            orderBy: [{ district: 'asc' }, { school: { name: 'asc' } }],
            include: {
              school: { select: { id: true, name: true, district: true } },
              winnerTeam: TEAM,
              games: {
                orderBy: [{ round: 'asc' }, { position: 'asc' }],
                include: { teamA: TEAM, teamB: TEAM },
              },
            },
          },
        },
      }),
      !query.stage || query.stage === StageType.CITY
        ? this.prisma.tournamentBracket.findMany({
            where: { stage: { tournamentId, type: StageType.DISTRICT } },
            select: { district: true, status: true, winnerTeam: TEAM },
          })
        : Promise.resolve([]),
    ]);

    return buildTournamentTree(tournament, stages, {
      onlyStage: query.stage,
      districtResults,
    });
  }
}
