import { ApiProperty } from '@nestjs/swagger';

/** Whether the caller likes the event now, and the event's like count after the call. */
export class EventLikeResponseDto {
  @ApiProperty({ example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90', format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: true, description: 'true after PUT (like), false after DELETE (unlike)' })
  liked!: boolean;

  @ApiProperty({ type: 'integer', example: 12, description: 'Number of likes of the event' })
  likesCount!: number;
}
