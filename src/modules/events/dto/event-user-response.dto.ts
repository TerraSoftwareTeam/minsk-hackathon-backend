import { ApiProperty } from '@nestjs/swagger';

export class EventUserResponseDto {
  @ApiProperty({ example: 'Ivan', description: 'First name' })
  name!: string;

  @ApiProperty({ example: 'Ivanov', description: 'Last name' })
  surname!: string;
}
