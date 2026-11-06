import { ApiProperty } from '@nestjs/swagger';

/**
 * A user as shown inside an event: name and surname only. In particular no
 * schoolsById: it is all one needs to log in, and events are seen by other pupils.
 */
export class EventUserResponseDto {
  @ApiProperty({ example: 'Ivan', description: 'First name' })
  name!: string;

  @ApiProperty({ example: 'Ivanov', description: 'Last name' })
  surname!: string;
}
