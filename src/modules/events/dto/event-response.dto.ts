import { ApiProperty } from '@nestjs/swagger';
import {
  EventCategories,
  EventStatuses,
  Scopes,
  UserRoles,
} from '../../../../prisma/generated/prisma/client';
import { EventUserResponseDto } from './event-user-response.dto';

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
      'Pupil event: ON_MODERATION (teacher) -> ON_VOTE (pupils) -> ON_ADMIN_MODERATION (admin) -> FINALIZED. ' +
      'Teacher event: starts ON_VOTE, then the same (never ON_MODERATION or DECLINED). ' +
      'Admin event: ON_VOTE -> FINALIZED when the votes reach voteThreshold, otherwise EXPIRED at startsAt. ' +
      'DECLINED / DECLINED_BY_ADMIN: rejected by the teacher / admin. EXPIRED: not decided before its deadline (votingClosesAt)',
  })
  status!: EventStatuses;

  @ApiProperty({
    enum: UserRoles,
    example: UserRoles.PUPIL,
    description:
      'Role of the initiator when the event was created, it picks the flow (see status). ' +
      'TEACHER and ADMIN events are school events created by the staff',
  })
  createdByRole!: UserRoles;

  @ApiProperty({ example: null, nullable: true, type: String, description: 'Set when declined (by the teacher or an admin) with a reason' })
  declineReason!: string | null;

  @ApiProperty({
    type: 'integer',
    example: 15,
    description:
      'Votes needed to leave ON_VOTE: to ON_ADMIN_MODERATION (pupil and teacher events), to FINALIZED (admin events)',
  })
  voteThreshold!: number;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Date,
    description:
      'When the event starts (UTC). Pupil and teacher events: set by the admin on approval, null in every status except FINALIZED. ' +
      'Admin events: set on creation, present in every status',
  })
  startsAt!: Date | null;

  @ApiProperty({
    example: '2026-12-06T10:00:00.000Z',
    description:
      'Computed. Pupil and teacher events: createdAt + 1 month (30 days), teacher moderation, voting and the admin decision must finish by then. ' +
      'Admin events: startsAt, the votes must reach voteThreshold by then. Otherwise the event becomes EXPIRED',
  })
  votingClosesAt!: Date;

  @ApiProperty({
    example: 0.66,
    minimum: 0,
    maximum: 1,
    description:
      'Computed: probability (0..1) that the event takes place, from other FINALIZED events of the same category (also not yet started ones), ' +
      'the only ones with a date. For a FINALIZED event, weighted by how close their start time of day (Minsk time) is; ' +
      'before the date is set, the time is not compared. 0.9 with at least 5 such events (at the same time); 0.5 without history',
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
    type: 'integer',
    example: 12,
    description: 'Number of likes. Any pupil may like an event from ON_VOTE on, once, and take the like back',
  })
  likesCount!: number;

  @ApiProperty({ type: EventUserResponseDto, description: 'Who created the event: a pupil, a teacher or an admin (see createdByRole)' })
  initiator!: EventUserResponseDto;

  @ApiProperty({
    type: [EventUserResponseDto],
    description:
      "Who may decide on the event now. ON_MODERATION: every teacher of the author's class (empty while the class has none: " +
      'a teacher who registers into it moderates the event at once). ON_ADMIN_MODERATION: every admin. Empty in every other status (admin events are never moderated)',
  })
  moderators!: EventUserResponseDto[];

  @ApiProperty({
    type: [EventUserResponseDto],
    description: 'Pupils who voted for (signed up to) the event, in the order they voted',
  })
  voters!: EventUserResponseDto[];

  @ApiProperty({ type: 'integer', example: 4, description: 'Votes cast so far: the length of voters' })
  votesCount!: number;

  @ApiProperty({ example: '2026-11-06T10:00:00.000Z', description: 'When the request was created (UTC)' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-11-06T10:00:00.000Z', description: 'Last change (UTC)' })
  updatedAt!: Date;
}
