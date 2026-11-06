import { ApiProperty } from '@nestjs/swagger';
import { EventResponseDto } from './event-response.dto';

/** An event in the pupil's rating feed: the event plus the caller's own rating. */
export class RatingEventResponseDto extends EventResponseDto {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 5,
    example: null,
    description: "The caller's stars; null when the caller has not rated the event yet",
  })
  myRating!: number | null;
}
