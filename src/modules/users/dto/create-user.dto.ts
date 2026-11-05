import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserRoles } from '../../../../prisma/generated/prisma/client';

/**
 * Role-dependent fields (schoolsById, class, schoolName) are optional here:
 * PUPIL/TEACHER must provide them, ORGANIZATOR must not.
 * UsersService enforces this and returns 400 with a clear message.
 */
export class CreateUserDto {
  @ApiPropertyOptional({
    example: 'school-user-123',
    description: 'School-system ID (unique). Required for PUPIL/TEACHER, forbidden for ORGANIZATOR',
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

  @ApiProperty({ enum: UserRoles, example: UserRoles.PUPIL })
  @IsEnum(UserRoles)
  role!: UserRoles;

  @ApiPropertyOptional({
    example: '10A',
    description: 'Class. Required for PUPIL/TEACHER, forbidden for ORGANIZATOR',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  class?: string;

  @ApiPropertyOptional({
    example: 'School #1',
    description: 'Existing school. Required for PUPIL/TEACHER, forbidden for ORGANIZATOR',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  schoolName?: string;
}
