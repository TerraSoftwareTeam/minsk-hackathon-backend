import { ApiProperty } from '@nestjs/swagger';
import {
  EventCategories,
  EventStatuses,
  Scopes,
} from '../../../../prisma/generated/prisma/client';
import { UserResponseDto } from '../../auth/dto/user-response.dto';

export class EventResponseDto {
  @ApiProperty({ example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Class trip to the museum', description: 'Event name (unique)' })
  name!: string;

  @ApiProperty({
    example: 'Saturday, 10:00, meeting at school',
    nullable: true,
    type: String,
    description: 'Free-form details',
  })
  description!: string | null;

  @ApiProperty({
    enum: Scopes,
    example: Scopes.CLASS,
    description: "Who may vote, relative to the author's class: CLASS, GRADE or SCHOOL",
  })
  scope!: Scopes;

  @ApiProperty({ enum: EventCategories, example: EventCategories.SPORTS, description: 'Kind of event' })
  category!: EventCategories;

  @ApiProperty({
    enum: EventStatuses,
    example: EventStatuses.ON_MODERATION,
    description:
      'ON_MODERATION (teacher) -> ON_VOTE (pupils) -> ON_ADMIN_MODERATION (admin) -> FINALIZED. ' +
      'DECLINED / DECLINED_BY_ADMIN: rejected by the teacher / admin. EXPIRED: not decided before its deadline',
  })
  status!: EventStatuses;

  @ApiProperty({ example: null, nullable: true, type: String, description: 'Set when declined (by the teacher or an admin) with a reason' })
  declineReason!: string | null;

  @ApiProperty({
    type: 'integer',
    example: 15,
    description: 'Votes needed to move from ON_VOTE to ON_ADMIN_MODERATION',
  })
  voteThreshold!: number;

  @ApiProperty({ example: '2026-12-01T07:00:00.000Z', description: 'When the event starts (UTC)' })
  startsAt!: Date;

  @ApiProperty({
    example: '2026-11-29T07:00:00.000Z',
    description:
      'Computed: 2 days before startsAt. Voting and teacher moderation must finish by then, otherwise the event becomes EXPIRED',
  })
  votingClosesAt!: Date;

  @ApiProperty({
    example: 0.66,
    minimum: 0,
    maximum: 1,
    description:
      'Computed: probability (0..1) that the event takes place, from other events of the same category with a known outcome (also not yet started ones): ' +
      'how close their start time of day (Minsk time) is and whether they were FINALIZED or EXPIRED. ' +
      'Declined and pending events are not counted. 0.9 when at least 5 such events all started at the same time and all took place; 0.5 without history',
  })
  successProbability!: number;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/minsk_hackathon_images/3f2c9a4e.jpg',
    nullable: true,
    type: String,
    description: 'Event image URL; null when the event has none. At most one image per event',
  })
  imageUrl!: string | null;

  @ApiProperty({
    example: 4.33,
    nullable: true,
    type: Number,
    minimum: 1,
    maximum: 5,
    description: 'Average stars (1..5, 2 decimals) of the pupils who rated the event; null until the first rating',
  })
  ratingAverage!: number | null;

  @ApiProperty({
    type: 'integer',
    example: 3,
    description: 'Number of ratings. Any pupil may rate an event from ON_VOTE on',
  })
  ratingsCount!: number;

  @ApiProperty({ type: UserResponseDto, description: 'Pupil who created the event' })
  initiator!: UserResponseDto;

  @ApiProperty({ type: UserResponseDto, description: 'Teacher who moderates the event' })
  teacher!: UserResponseDto;

  @ApiProperty({ example: '2026-11-06T10:00:00.000Z', description: 'When the request was created (UTC)' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-11-06T10:00:00.000Z', description: 'Last change (UTC)' })
  updatedAt!: Date;
}
