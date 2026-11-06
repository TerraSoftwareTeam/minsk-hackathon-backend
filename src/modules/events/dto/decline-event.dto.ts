import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class DeclineEventDto {
  @ApiPropertyOptional({
    example: 'Please pick another date',
    minLength: 1,
    maxLength: 2000,
    description: 'Optional reason shown to the pupil',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason?: string;
}
