import { ApiProperty } from '@nestjs/swagger';
import { UserRoles } from '../../../../prisma/generated/prisma/client';

export class UserResponseDto {
  @ApiProperty({
    example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    example: 'school-user-123',
    description: 'User ID in the school system (unique)',
  })
  schoolsById!: string;

  @ApiProperty({ example: 'Ivan', description: 'First name' })
  name!: string;

  @ApiProperty({ example: 'Ivanov', description: 'Last name' })
  surname!: string;

  @ApiProperty({
    example: '10A',
    nullable: true,
    type: String,
    description: 'Class; always set for PUPIL and TEACHER, null for ADMIN',
  })
  class!: string | null;

  @ApiProperty({
    enum: UserRoles,
    example: UserRoles.PUPIL,
    description: 'User role',
  })
  role!: UserRoles;

  @ApiProperty({
    example: 120,
    minimum: 0,
    description:
      "Pupil's personal progress: experience points (like in Minecraft). Starts at 0",
  })
  exp!: number;
}
