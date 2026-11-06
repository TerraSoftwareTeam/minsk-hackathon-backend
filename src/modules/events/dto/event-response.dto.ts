import { ApiProperty } from '@nestjs/swagger';
import { EventStatuses, Scopes } from '../../../../prisma/generated/prisma/client';
import { UserResponseDto } from '../../auth/dto/user-response.dto';

export class EventResponseDto {
  @ApiProperty({ example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90' })
  id!: string;

  @ApiProperty({ example: 'Class trip to the museum' })
  name!: string;

  @ApiProperty({ example: 'Saturday, 10:00, meeting at school', nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ enum: Scopes, example: Scopes.CLASS })
  scope!: Scopes;

  @ApiProperty({ enum: EventStatuses, example: EventStatuses.ON_MODERATION })
  status!: EventStatuses;

  @ApiProperty({ example: null, nullable: true, type: String, description: 'Set when declined (by the teacher or an admin) with a reason' })
  declineReason!: string | null;

  @ApiProperty({ example: 15, description: 'Votes needed to move from ON_VOTE to ON_ADMIN_MODERATION' })
  voteThreshold!: number;

  @ApiProperty({ example: '2026-12-01T07:00:00.000Z', description: 'When the event starts (UTC)' })
  startsAt!: Date;

  @ApiProperty({
    example: '2026-11-29T07:00:00.000Z',
    description:
      'Computed: 2 days before startsAt. Voting and teacher moderation must finish by then, otherwise the event becomes EXPIRED',
  })
  votingClosesAt!: Date;

  @ApiProperty({ type: UserResponseDto, description: 'Pupil who created the event' })
  initiator!: UserResponseDto;

  @ApiProperty({ type: UserResponseDto, description: 'Teacher who moderates the event' })
  teacher!: UserResponseDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
