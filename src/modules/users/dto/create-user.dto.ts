import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserRoles } from '../../../../prisma/generated/prisma/client';
import { trimString } from '../../../common/auth/class-invariant';

/**
 * schoolsById is required for every role. class depends on the role:
 * PUPIL/TEACHER must have it, ADMIN must not; a teacher may omit it, the pupil
 * inherits the teacher's. UsersService enforces the class rules.
 */
export class CreateUserDto {
  @ApiProperty({
    example: 'school-user-123',
    description: 'School-system ID (unique)',
  })
  @IsString()
  @IsNotEmpty()
  schoolsById!: string;

  @ApiProperty({ example: 'Ivan', description: 'First name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Ivanov', description: 'Last name' })
  @IsString()
  @IsNotEmpty()
  surname!: string;

  @ApiProperty({
    enum: UserRoles,
    example: UserRoles.PUPIL,
    description: 'A teacher can only create PUPIL',
  })
  @IsEnum(UserRoles)
  role!: UserRoles;

  @ApiPropertyOptional({
    example: '10A',
    description:
      "Class. Required for PUPIL/TEACHER, forbidden for ADMIN. Defaults to the teacher's class. Surrounding spaces are trimmed, must not be blank",
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  class?: string;
}
