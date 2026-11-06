import { ApiProperty } from '@nestjs/swagger';

export class ProbabilityResponseDto {
  @ApiProperty({
    example: 0.66,
    minimum: 0,
    maximum: 1,
    description:
      'Probability (0..1) that such an event takes place, same rule as EventResponseDto.successProbability',
  })
  successProbability!: number;
}
