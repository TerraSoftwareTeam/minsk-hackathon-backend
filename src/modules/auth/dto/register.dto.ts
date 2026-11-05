import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { UserRoles } from '../../../../prisma/generated/prisma/client';
import { UserResponseDto } from '../../users/dto/user-response.dto';

// Self-registration can only create pupils and teachers.
// Organizators are created by an existing organizator via the users module.
const SELF_REGISTRABLE_ROLES = [UserRoles.PUPIL, UserRoles.TEACHER] as const;

export class RegisterDto {
  @ApiProperty({
    example: 'school-user-123',
    description: 'User ID in the school system (unique)',
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

  @ApiProperty({ example: 'Petrovich', description: "Father's name" })
  @IsString()
  @IsNotEmpty()
  fathersName!: string;

  @ApiProperty({
    enum: SELF_REGISTRABLE_ROLES,
    example: UserRoles.PUPIL,
    description: 'User role (PUPIL or TEACHER)',
  })
  @IsIn(SELF_REGISTRABLE_ROLES)
  role!: UserRoles;

  @ApiProperty({ example: '10A', description: 'Class name' })
  @IsString()
  @IsNotEmpty()
  class!: string;

  @ApiProperty({
    example: 'School #1',
    description: 'Name of an existing school (must exist in the database)',
  })
  @IsString()
  @IsNotEmpty()
  schoolName!: string;
}

export class LoginDto {
  @ApiProperty({
    example: 'school-user-123',
    description: 'User ID in the school system (must belong to an existing user)',
  })
  @IsString()
  @IsNotEmpty()
  schoolsById!: string;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken!: string;

  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}
