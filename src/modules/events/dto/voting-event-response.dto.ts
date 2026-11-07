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
    description: 'Whether the caller has liked the event (the count is likesCount)',
  })
  likedByMe!: boolean;
}
