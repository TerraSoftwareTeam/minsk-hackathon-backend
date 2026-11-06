import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { UserRoles } from '../../../../prisma/generated/prisma/client';
import { trimString } from '../../../common/auth/class-invariant';
import { UserResponseDto } from './user-response.dto';

// Self-registration can only create pupils and teachers.
// Admins are not created through the API.
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
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  class!: string;
}

/**
 * PUPIL/TEACHER log in by schoolsById, ADMIN logs in by its id (UUID).
 * Admins cannot register; they only log in.
 */
export class LoginDto {
  @ApiProperty({ enum: UserRoles, example: UserRoles.PUPIL, description: 'Role of the user logging in' })
  @IsEnum(UserRoles)
  role!: UserRoles;

  @ApiPropertyOptional({
    example: 'school-user-123',
    description: 'School-system ID. Required for PUPIL and TEACHER',
  })
  @ValidateIf((o: LoginDto) => o.role !== UserRoles.ADMIN)
  @IsString()
  @IsNotEmpty()
  schoolsById?: string;

  @ApiPropertyOptional({
    example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90',
    description: 'User id (UUID). Required for ADMIN',
  })
  @ValidateIf((o: LoginDto) => o.role === UserRoles.ADMIN)
  @IsUUID()
  id?: string;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken!: string;

  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}
