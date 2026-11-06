import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Scopes } from '../../../../prisma/generated/prisma/client';

export class CreateEventDto {
  @ApiProperty({ example: 'Class trip to the museum', description: 'Event name (unique)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Saturday, 10:00, meeting at school' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ enum: Scopes, default: Scopes.CLASS, description: 'Who the event is for' })
  @IsOptional()
  @IsEnum(Scopes)
  scope?: Scopes;

  @ApiProperty({
    example: 15,
    minimum: 1,
    maximum: 10000,
    description: 'Votes needed during ON_VOTE to send the event to admin moderation',
  })
  @IsInt()
  @Min(1)
  @Max(10000)
  voteThreshold!: number;
}
