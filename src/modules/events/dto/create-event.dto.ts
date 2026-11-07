import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsInt,
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
      "Who may vote, relative to the author's class: CLASS - same class, GRADE - same grade (first number of the class name), SCHOOL - any pupil. " +
      'Pupil and teacher: any, CLASS by default. Admin: SCHOOL only, and by default (an admin has no class)',
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
    description:
      'Minimum participants (votes) by the time voting closes: then a pupil or teacher event goes to admin moderation, ' +
      'an admin event becomes FINALIZED; with fewer the event becomes EXPIRED. ' +
      "A pupil's own vote is cast on creation (the organizer is a participant) and counts, so a pupil event needs at least 2",
  })
  @IsInt()
  @Min(1)
  @Max(10000)
  voteThreshold!: number;

  @ApiPropertyOptional({
    type: 'integer',
    example: 30,
    minimum: 1,
    maximum: 10000,
    description:
      'Any role. Maximum participants (votes; the pupil organizer counts), at least voteThreshold; omitted = unlimited. ' +
      'Voting stays open past voteThreshold until this many pupils joined (the event then moves on at once) ' +
      'or until voting closes, 5 days before startsAt',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxParticipants?: number;

  @ApiProperty({
    example: '2026-12-05T12:00:00+03:00',
    format: 'date-time',
    description:
      'Required for every role: when the event takes place, ISO 8601 date-time with a timezone (Z or ±hh:mm), in the future. ' +
      'Never changed afterwards, not even by a moderator (who can only approve or decline). ' +
      'Teacher moderation and voting end 5 days before it, admin moderation 3 days before it',
  })
  @IsISO8601({ strict: true })
  @Matches(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, {
    message:
      'startsAt must be a date-time with a timezone, e.g. 2026-12-05T12:00:00+03:00',
  })
  startsAt!: string;
}
