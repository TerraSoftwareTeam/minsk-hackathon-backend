import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  District,
  StageType,
} from '../../../../prisma/generated/prisma/client';

export class TournamentTreeQueryDto {
  @ApiPropertyOptional({ enum: StageType, description: 'Only this stage' })
  @IsOptional()
  @IsEnum(StageType)
  stage?: StageType;

  @ApiPropertyOptional({
    description: 'Only the school-stage bracket of this school',
  })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @ApiPropertyOptional({
    enum: District,
    description: 'Only the district-stage bracket of this district',
  })
  @IsOptional()
  @IsEnum(District)
  district?: District;
}

export class TreeSchoolDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: District }) district!: District;
}

export class TreeTeamDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: TreeSchoolDto }) school!: TreeSchoolDto;
}

export class TreeSlotDto {
  @ApiPropertyOptional({
    type: TreeTeamDto,
    nullable: true,
    description: 'Null while unknown, or for the empty side of a BYE',
  })
  team!: TreeTeamDto | null;

  @ApiPropertyOptional({ nullable: true }) score!: number | null;

  @ApiProperty({ description: 'This side won the match (or advanced by BYE)' })
  isWinner!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Match whose winner fills this slot; null in round 1',
  })
  sourceMatchId!: string | null;

  @ApiProperty({
    example: 'Победитель 1/4 финала, матч 2',
    description:
      'Ready-to-show text: team name, "BYE", or where the team will come from',
  })
  label!: string;
}

export class TreeLayoutDto {
  @ApiProperty({ description: '0-based column (= round - 1)' }) column!: number;
  @ApiProperty({
    description:
      '0-based start row in units of a first-round match. Use CSS grid: grid-row: rowStart + 1 / span rowSpan',
  })
  rowStart!: number;
  @ApiProperty({
    description: '2^(round-1): how many first-round rows this match spans',
  })
  rowSpan!: number;
}

export class TreeMatchDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: '1-based' }) round!: number;
  @ApiProperty({ description: '0-based, top to bottom' }) position!: number;
  @ApiProperty({
    example: 'Матч 1',
    description: '1-based number within the round',
  })
  label!: string;
  @ApiProperty({ enum: ['PENDING', 'READY', 'FINISHED', 'BYE'] })
  status!: string;
  @ApiProperty() isBye!: boolean;
  @ApiProperty() isFinal!: boolean;
  @ApiProperty({ type: TreeSlotDto }) teamA!: TreeSlotDto;
  @ApiProperty({ type: TreeSlotDto }) teamB!: TreeSlotDto;
  @ApiPropertyOptional({ nullable: true }) winnerTeamId!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Where the winner goes; null for the final',
  })
  nextMatchId!: string | null;
  @ApiPropertyOptional({ enum: ['A', 'B'], nullable: true }) nextSlot!:
    'A' | 'B' | null;
  @ApiProperty({ type: TreeLayoutDto }) layout!: TreeLayoutDto;
  @ApiPropertyOptional({ nullable: true }) finishedAt!: Date | null;
}

export class TreeRoundDto {
  @ApiProperty({ description: '1-based' }) round!: number;
  @ApiProperty({ example: 'Полуфинал' }) name!: string;
  @ApiProperty({
    type: [TreeMatchDto],
    description: 'Ordered by position (top to bottom)',
  })
  matches!: TreeMatchDto[];
}

export class TreeBracketDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: StageType }) stage!: StageType;
  @ApiProperty({
    example: 'Школа №1',
    description: 'School name, district name or "Город"',
  })
  title!: string;
  @ApiPropertyOptional({ type: TreeSchoolDto, nullable: true })
  school!: TreeSchoolDto | null;
  @ApiPropertyOptional({ enum: District, nullable: true })
  district!: District | null;
  @ApiProperty({ enum: ['IN_PROGRESS', 'FINISHED'] }) status!: string;
  @ApiProperty() participantsCount!: number;
  @ApiProperty({ description: 'Power of two, 0 if no participants' })
  size!: number;
  @ApiProperty({ description: 'Number of rounds (columns); 0 when N <= 1' })
  roundsCount!: number;
  @ApiProperty({ description: 'Grid height in first-round rows = size / 2' })
  gridRows!: number;
  @ApiPropertyOptional({ type: TreeTeamDto, nullable: true })
  winner!: TreeTeamDto | null;
  @ApiProperty({
    enum: ['PLAYING', 'WINNER', 'WALKOVER', 'NO_PARTICIPANTS'],
    description:
      'WALKOVER: one participant, won without games. NO_PARTICIPANTS: N = 0, no winner',
  })
  outcome!: 'PLAYING' | 'WINNER' | 'WALKOVER' | 'NO_PARTICIPANTS';
  @ApiProperty({ type: [TreeRoundDto] }) rounds!: TreeRoundDto[];
}

export class TreeDistrictDto {
  @ApiProperty({ enum: District }) district!: District;
  @ApiProperty({ example: 'Центральный' }) name!: string;
  @ApiProperty({ enum: ['QUALIFIED', 'NO_WINNER', 'PENDING'] }) status!:
    'QUALIFIED' | 'NO_WINNER' | 'PENDING';
  @ApiPropertyOptional({ type: TreeTeamDto, nullable: true })
  team!: TreeTeamDto | null;
}

export class TreeStageDto {
  @ApiProperty({ enum: StageType }) type!: StageType;
  @ApiProperty({ example: 'Школьный этап' }) name!: string;
  @ApiProperty({ enum: ['PENDING', 'IN_PROGRESS', 'FINISHED'] })
  status!: string;
  @ApiPropertyOptional({ nullable: true }) startedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) finishedAt!: Date | null;
  @ApiProperty({
    type: [TreeBracketDto],
    description: 'Empty while the stage is PENDING',
  })
  brackets!: TreeBracketDto[];
  @ApiPropertyOptional({
    type: [TreeDistrictDto],
    description:
      'CITY only: all 9 districts, so missing ones (NO_WINNER) can be shown',
  })
  districts?: TreeDistrictDto[];
}

export class TournamentTreeDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['REGISTRATION', 'IN_PROGRESS', 'FINISHED'] })
  status!: string;
  @ApiPropertyOptional({ enum: StageType, nullable: true })
  currentStage!: StageType | null;
  @ApiProperty({ description: 'UTC' }) schoolStageStartAt!: Date;
  @ApiProperty({ example: 'Europe/Minsk' }) timeZone!: string;
  @ApiPropertyOptional({ type: TreeTeamDto, nullable: true })
  winner!: TreeTeamDto | null;
  @ApiProperty({
    type: [TreeStageDto],
    description: 'Always in order SCHOOL, DISTRICT, CITY (filtered by ?stage)',
  })
  stages!: TreeStageDto[];
}
