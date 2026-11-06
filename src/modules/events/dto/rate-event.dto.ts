import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class RateEventDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 5, description: 'Stars, 1 to 5' })
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;
}
