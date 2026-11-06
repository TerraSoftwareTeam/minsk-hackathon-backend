import { ApiProperty } from '@nestjs/swagger';
import { EventStatuses } from '../../../../prisma/generated/prisma/client';

export class EventVoteResponseDto {
  @ApiProperty({ example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90', format: 'uuid' })
  eventId!: string;

  @ApiProperty({
    type: 'integer',
    example: 12,
    description: 'Total number of votes for the event after this vote (or after it was taken back)',
  })
  votesCount!: number;

  @ApiProperty({
    type: 'integer',
    example: 15,
    description: 'Votes needed to move the event to ON_ADMIN_MODERATION',
  })
  voteThreshold!: number;

  @ApiProperty({
    enum: EventStatuses,
    example: EventStatuses.ON_VOTE,
    description: 'Status after this vote: ON_ADMIN_MODERATION once the threshold is reached',
  })
  status!: EventStatuses;
}
