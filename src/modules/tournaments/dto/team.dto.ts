import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class TeamNameDto {
  @ApiProperty({ example: 'Совы' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}

export class AddMemberDto {
  @ApiProperty({
    description:
      'Pupil to add. A pupil joining by themselves passes their own id.',
  })
  @IsUUID()
  userId!: string;
}

export class TransferCreatorDto {
  @ApiProperty({ description: 'A current member of the team (pupil)' })
  @IsUUID()
  userId!: string;
}

export class TeamMemberResponseDto {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() surname!: string;
  @ApiPropertyOptional({ nullable: true }) class!: string | null;
  @ApiProperty() joinedAt!: Date;
}

export class TeamResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() tournamentId!: string;
  @ApiProperty() schoolId!: string;
  @ApiProperty() schoolName!: string;
  @ApiPropertyOptional({ nullable: true }) creatorId!: string | null;
  @ApiProperty({ description: 'members >= MIN_TEAM_SIZE' }) isFull!: boolean;
  @ApiProperty({
    description: 'Roster is locked once the school stage has started',
  })
  isLocked!: boolean;
  @ApiProperty({ type: [TeamMemberResponseDto] })
  members!: TeamMemberResponseDto[];
}
