import { ApiProperty } from '@nestjs/swagger';
import { UserRoles } from '../../../../prisma/generated/prisma/client';

export class UserResponseDto {
  @ApiProperty({ example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90' })
  id!: string;

  @ApiProperty({ example: 'school-user-123', nullable: true, type: String })
  schoolsById!: string | null;

  @ApiProperty({ example: 'Ivan' })
  name!: string;

  @ApiProperty({ example: 'Ivanov' })
  surname!: string;

  @ApiProperty({ example: 'Petrovich' })
  fathersName!: string;

  @ApiProperty({ example: '10A', nullable: true, type: String })
  class!: string | null;

  @ApiProperty({ enum: UserRoles, example: UserRoles.PUPIL })
  role!: UserRoles;
}
