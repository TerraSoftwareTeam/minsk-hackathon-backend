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
      'ON_VOTE lasts until maxParticipants (voteThreshold when it is null) joined or until votingClosesAt; then with at least voteThreshold votes it moves on ' +
      '(admin event: straight to FINALIZED), otherwise EXPIRED. ' +
      'DECLINED / DECLINED_BY_ADMIN: rejected by the teacher / admin. EXPIRED: not decided before its deadline (see deadline)',
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
    type: 'integer',
    example: 30,
    nullable: true,
    description:
      'Maximum participants (votes; the pupil organizer counts), >= voteThreshold. null = unlimited: then voteThreshold acts as the target. ' +
      'Voting stays open until it is reached or until votingClosesAt',
  })
  maxParticipants!: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Date,
    description:
      'When the event starts (UTC). Chosen by the author on creation (any role) and never changed. ' +
      'Present in every status; only old events rejected before authors chose dates may have none',
  })
  startsAt!: Date | null;

  @ApiProperty({
    example: '2026-12-06T10:00:00.000Z',
    description:
      'Computed: startsAt - 3 days, for every role. Teacher moderation and voting end then: ' +
      'ON_MODERATION -> EXPIRED; ON_VOTE -> moves on with at least voteThreshold votes, otherwise EXPIRED',
  })
  votingClosesAt!: Date;

  @ApiProperty({
    example: '2026-12-02T10:00:00.000Z',
    nullable: true,
    type: Date,
    description:
      'Computed: when the current pending stage ends. ON_MODERATION, ON_VOTE: votingClosesAt (startsAt - 3 days); ' +
      'ON_ADMIN_MODERATION: startsAt, the admin must decide before the event starts, otherwise EXPIRED. null once decided',
  })
  deadline!: Date | null;

  @ApiProperty({
    example: 0.66,
    minimum: 0,
    maximum: 1,
    description:
      'Computed: probability (0..1) that the event takes place, from other FINALIZED events of the same category (also not yet started ones), ' +
      "weighted by how close their start time of day (Minsk time) is to this event's; for an old event without a date, the time is not compared. " +
      '0.9 with at least 5 such events (at the same time); 0.5 without history',
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
    description: 'Likes minus dislikes (a like is +1, a dislike is -1). Any pupil may react to an event from ON_VOTE on, once, switch it or take it back',
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
