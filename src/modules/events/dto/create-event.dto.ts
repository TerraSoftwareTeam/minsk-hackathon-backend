import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EventCategories, Scopes } from '../../../../prisma/generated/prisma/client';

export class CreateEventDto {
  @ApiProperty({
    example: 'Class trip to the museum',
    maxLength: 200,
    description: 'Event name (unique)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    example: 'Saturday, 10:00, meeting at school',
    maxLength: 5000,
    description: 'Free-form details',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    enum: Scopes,
    default: Scopes.CLASS,
    description:
      "Who may vote, relative to the author's class: CLASS - same class, GRADE - same grade (first number of the class name), SCHOOL - any pupil",
  })
  @IsOptional()
  @IsEnum(Scopes)
  scope?: Scopes;

  @ApiProperty({
    enum: EventCategories,
    example: EventCategories.SPORTS,
    description:
      'Kind of event: SPORTS - competitions, tournaments; INTELLECTUAL - olympiads, quizzes, debates; ' +
      'CULTURAL - theatre, museum, cinema; CREATIVE - concerts, contests, exhibitions; ' +
      'EDUCATIONAL - lectures, workshops; VOLUNTEER - charity, social help; ' +
      'ENVIRONMENTAL - clean-ups, tree planting; TOURISM - hikes, excursions, trips; ' +
      'ENTERTAINMENT - celebrations, discos, quests; OTHER - anything else',
  })
  @IsEnum(EventCategories)
  category!: EventCategories;

  @ApiProperty({
    type: 'integer',
    example: 15,
    minimum: 1,
    maximum: 10000,
    description: 'Votes needed during ON_VOTE to send the event to admin moderation',
  })
  @IsInt()
  @Min(1)
  @Max(10000)
  voteThreshold!: number;

  @ApiProperty({
    example: '2026-12-01T10:00:00+03:00',
    format: 'date-time',
    description:
      'When the event starts: ISO 8601 date-time with a timezone (Z or ±hh:mm), more than 2 days ahead. ' +
      'Voting closes 2 days before it: an event not approved and voted by then becomes EXPIRED. ' +
      'The admin may decide on a voted event until it starts',
  })
  @IsISO8601({ strict: true })
  // Without an explicit offset the moment would depend on the server timezone.
  @Matches(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, {
    message: 'startsAt must be a date-time with a timezone, e.g. 2026-12-01T10:00:00+03:00',
  })
  startsAt!: string;
}
