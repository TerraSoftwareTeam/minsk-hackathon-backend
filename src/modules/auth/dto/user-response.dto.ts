import { ApiProperty } from '@nestjs/swagger';
import { UserRoles } from '../../../../prisma/generated/prisma/client';

export class UserResponseDto {
  @ApiProperty({ example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90', format: 'uuid' })
  id!: string;

  @ApiProperty({
    example: 'school-user-123',
    nullable: true,
    type: String,
    description: 'User ID in the school system; null for ADMIN',
  })
  schoolsById!: string | null;

  @ApiProperty({ example: 'Ivan', description: 'First name' })
  name!: string;

  @ApiProperty({ example: 'Ivanov', description: 'Last name' })
  surname!: string;

  @ApiProperty({ example: 'Petrovich', description: "Father's name" })
  fathersName!: string;

  @ApiProperty({
    example: '10A',
    nullable: true,
    type: String,
    description: 'Class; always set for PUPIL and TEACHER, null for ADMIN',
  })
  class!: string | null;

  @ApiProperty({ enum: UserRoles, example: UserRoles.PUPIL, description: 'User role' })
  role!: UserRoles;
}
