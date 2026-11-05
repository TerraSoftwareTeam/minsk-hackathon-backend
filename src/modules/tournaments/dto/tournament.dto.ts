import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateTournamentDto {
  @ApiProperty({ example: 'Городской турнир 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    example: 3,
    description:
      'MIN_TEAM_SIZE: a team with fewer members is removed at school-stage start',
  })
  @IsInt()
  @Min(1)
  @Max(100)
  minTeamSize!: number;

  @ApiProperty({ example: 5, description: 'MAX_TEAM_SIZE, >= minTeamSize' })
  @IsInt()
  @Min(1)
  @Max(100)
  maxTeamSize!: number;

  @ApiProperty({
    example: '2026-12-01T09:00',
    description:
      'School-stage start, ISO 8601. Without an offset it is read as Europe/Minsk local time. Stored in UTC. Must be in the future.',
  })
  @IsString()
  @IsNotEmpty()
  schoolStageStartAt!: string;
}

/** Allowed only while the tournament is in REGISTRATION and the start time has not passed. */
export class UpdateTournamentDto extends PartialType(CreateTournamentDto) {}

export class TournamentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['REGISTRATION', 'IN_PROGRESS', 'FINISHED'] })
  status!: string;
  @ApiProperty() minTeamSize!: number;
  @ApiProperty() maxTeamSize!: number;
  @ApiProperty({ description: 'UTC' }) schoolStageStartAt!: Date;
  @ApiPropertyOptional({ enum: ['SCHOOL', 'DISTRICT', 'CITY'], nullable: true })
  currentStage!: string | null;
  @ApiPropertyOptional({ nullable: true }) winnerTeamId!: string | null;
  @ApiPropertyOptional({ nullable: true }) finishedAt!: Date | null;
  @ApiProperty({ example: 'Europe/Minsk' }) timeZone!: string;
}
