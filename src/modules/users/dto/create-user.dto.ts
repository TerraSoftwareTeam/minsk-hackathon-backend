import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserRoles } from '../../../../prisma/generated/prisma/client';
import { trimString } from '../../../common/auth/class-invariant';

/**
 * School fields (schoolsById, class) are optional here because they depend
 * on the role: PUPIL/TEACHER must have them, ADMIN must not.
 * A teacher may omit class: the pupil inherits the teacher's.
 * UsersService enforces all of this.
 */
export class CreateUserDto {
  @ApiPropertyOptional({
    example: 'school-user-123',
    description: 'School-system ID (unique). Required for PUPIL/TEACHER, forbidden for ADMIN',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  schoolsById?: string;

  @ApiProperty({ example: 'Ivan' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Ivanov' })
  @IsString()
  @IsNotEmpty()
  surname!: string;

  @ApiProperty({ example: 'Petrovich' })
  @IsString()
  @IsNotEmpty()
  fathersName!: string;

  @ApiProperty({
    enum: UserRoles,
    example: UserRoles.PUPIL,
    description: 'A teacher can only create PUPIL',
  })
  @IsEnum(UserRoles)
  role!: UserRoles;

  @ApiPropertyOptional({
    example: '10A',
    description: "Class. Required for PUPIL/TEACHER, forbidden for ADMIN. Defaults to the teacher's class",
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  class?: string;
}
