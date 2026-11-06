import { ApiProperty } from '@nestjs/swagger';
import { EventResponseDto } from './event-response.dto';

/** An event in the pupil's voting feed or own list: the event plus its voting state and the caller's like. */
export class VotingEventResponseDto extends EventResponseDto {
  @ApiProperty({ type: 'integer', example: 4, description: 'Votes cast so far' })
  votesCount!: number;

  @ApiProperty({
    example: false,
    description: 'Whether the caller has already voted',
  })
  hasVoted!: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether the caller has liked the event (the count is likesCount)',
  })
  likedByMe!: boolean;
}
