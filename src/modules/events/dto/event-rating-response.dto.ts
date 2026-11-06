import { ApiProperty } from '@nestjs/swagger';

/** The caller's rating and the event's rating after it. */
export class EventRatingResponseDto {
  @ApiProperty({ example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90', format: 'uuid' })
  eventId!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 5, description: "The caller's stars" })
  stars!: number;

  @ApiProperty({
    example: 4.33,
    minimum: 1,
    maximum: 5,
    description: 'Average stars of all ratings of the event, 2 decimals',
  })
  ratingAverage!: number;

  @ApiProperty({ type: 'integer', example: 3, description: 'Number of ratings of the event' })
  ratingsCount!: number;
}
