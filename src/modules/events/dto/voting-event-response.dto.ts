import { ApiProperty } from '@nestjs/swagger';
import { EventResponseDto } from './event-response.dto';

export class VotingEventResponseDto extends EventResponseDto {
  @ApiProperty({
    example: false,
    description: 'Whether the caller has already voted',
  })
  hasVoted!: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether the caller has liked the event (+1 in likesCount)',
  })
  likedByMe!: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether the caller has disliked the event (it counts -1 in likesCount)',
  })
  dislikedByMe!: boolean;
}
