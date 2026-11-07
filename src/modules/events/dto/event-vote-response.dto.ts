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
    description: 'Minimum votes the event needs by the time voting closes',
  })
  voteThreshold!: number;

  @ApiProperty({
    type: 'integer',
    example: 30,
    nullable: true,
    description: 'Maximum participants: the vote that reaches it closes voting at once. null = unlimited',
  })
  maxParticipants!: number | null;

  @ApiProperty({
    enum: EventStatuses,
    example: EventStatuses.ON_VOTE,
    description:
      'Status after this vote: ON_VOTE until maxParticipants is reached; the vote that reaches it moves the event to ' +
      'ON_ADMIN_MODERATION (FINALIZED for an admin event)',
  })
  status!: EventStatuses;
}
