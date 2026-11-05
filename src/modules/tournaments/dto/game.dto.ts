import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class GameResultDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  scoreA!: number;

  @ApiProperty({
    example: 1,
    description: 'Must differ from scoreA: there are no draws in playoffs',
  })
  @IsInt()
  @Min(0)
  @Max(10_000)
  scoreB!: number;
}
