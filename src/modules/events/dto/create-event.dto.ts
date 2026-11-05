import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
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
}
