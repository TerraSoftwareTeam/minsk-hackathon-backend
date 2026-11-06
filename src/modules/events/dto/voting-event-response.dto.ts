import { ApiProperty } from '@nestjs/swagger';
import { EventResponseDto } from './event-response.dto';

/** An event in the pupil's voting feed or own list: the event plus whether the caller voted and liked it. */
export class VotingEventResponseDto extends EventResponseDto {
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
