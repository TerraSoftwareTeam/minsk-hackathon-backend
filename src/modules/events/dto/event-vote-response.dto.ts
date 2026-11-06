import { ApiProperty } from '@nestjs/swagger';

export class EventVoteResponseDto {
  @ApiProperty({ example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90' })
  eventId!: string;

  @ApiProperty({ example: 12, description: 'Total number of votes for the event after this vote' })
  votesCount!: number;
}
