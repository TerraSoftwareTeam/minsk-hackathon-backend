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
      'Votes needed during ON_VOTE: they send a pupil or teacher event to admin moderation, and make an admin event FINALIZED',
  })
  @IsInt()
  @Min(1)
  @Max(10000)
  voteThreshold!: number;

  @ApiPropertyOptional({
    example: '2026-12-05T12:00:00+03:00',
    format: 'date-time',
    description:
      'Admin only, and required for an admin: when the school event takes place, ISO 8601 date-time with a timezone ' +
      '(Z or ±hh:mm), in the future. It is also the voting deadline: without enough votes by then the event becomes EXPIRED. ' +
      'Never changed afterwards. A pupil or teacher must not send it: their date is set by the admin on approval',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, {
    message:
      'startsAt must be a date-time with a timezone, e.g. 2026-12-05T12:00:00+03:00',
  })
  startsAt?: string;
}
