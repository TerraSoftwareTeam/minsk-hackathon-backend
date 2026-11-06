import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
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

/**
 * Register-or-login by schoolsById. If a user with this schoolsById exists, they are
 * logged in and the other fields are ignored; otherwise name, surname, role and class
 * are required and a new user is created.
 */
export class RegisterDto {
  @ApiProperty({
    example: 'school-user-123',
    description: 'User ID in the school system (unique)',
  })
  @IsString()
  @IsNotEmpty()
  schoolsById!: string;

  @ApiPropertyOptional({ example: 'Ivan', description: 'First name. Required for a new user' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'Ivanov', description: 'Last name. Required for a new user' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  surname?: string;

  @ApiPropertyOptional({
    enum: SELF_REGISTRABLE_ROLES,
    example: UserRoles.PUPIL,
    description: 'User role (PUPIL or TEACHER). Required for a new user',
  })
  @IsOptional()
  @IsIn(SELF_REGISTRABLE_ROLES)
  role?: UserRoles;

  @ApiPropertyOptional({
    example: '10A',
    description:
      'Class name; surrounding spaces are trimmed, must not be blank. Required for a new user',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  class?: string;
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
    format: 'uuid',
    description: 'User id (UUID). Required for ADMIN',
  })
  @ValidateIf((o: LoginDto) => o.role === UserRoles.ADMIN)
  @IsUUID()
  id?: string;
}

export class AuthResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZjJjIn0.signature',
    description: 'JWT access token: send it as "Authorization: Bearer <token>"',
  })
  accessToken!: string;

  @ApiProperty({ type: UserResponseDto, description: 'The logged-in user' })
  user!: UserResponseDto;
}
