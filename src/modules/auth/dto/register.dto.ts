import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserRoles } from '../../../../prisma/generated/prisma/client';
import { trimString } from '../../../common/auth/class-invariant';
import { UserResponseDto } from './user-response.dto';

/**
 * Register-or-login by schoolsById. If a user with this schoolsById exists (any role,
 * ADMIN included), they are logged in and the other fields are ignored; otherwise
 * a new user is created: name, surname and role are required, class is required for
 * PUPIL/TEACHER and forbidden for ADMIN.
 */
export class RegisterDto {
  @ApiProperty({
    example: 'school-user-123',
    description: 'User ID in the school system (unique)',
  })
  @IsString()
  @IsNotEmpty()
  schoolsById!: string;

  @ApiPropertyOptional({
    example: 'Ivan',
    description: 'First name. Required for a new user',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    example: 'Ivanov',
    description: 'Last name. Required for a new user',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  surname?: string;

  @ApiPropertyOptional({
    enum: UserRoles,
    example: UserRoles.PUPIL,
    description: 'User role (PUPIL, TEACHER or ADMIN). Required for a new user',
  })
  @IsOptional()
  @IsEnum(UserRoles)
  role?: UserRoles;

  @ApiPropertyOptional({
    example: '10A',
    description:
      'Class name; surrounding spaces are trimmed, must not be blank. Required for a new PUPIL/TEACHER, forbidden for ADMIN',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  class?: string;
}

/**
 * Every role logs in by schoolsById. Admins cannot register; they only log in.
 */
export class LoginDto {
  @ApiProperty({
    enum: UserRoles,
    example: UserRoles.PUPIL,
    description: 'Role of the user logging in',
  })
  @IsEnum(UserRoles)
  role!: UserRoles;

  @ApiProperty({
    example: 'school-user-123',
    description: 'User ID in the school system',
  })
  @IsString()
  @IsNotEmpty()
  schoolsById!: string;
}

export class AuthResponseDto {
  @ApiProperty({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZjJjIn0.signature',
    description: 'JWT access token: send it as "Authorization: Bearer <token>"',
  })
  accessToken!: string;

  @ApiProperty({ type: UserResponseDto, description: 'The logged-in user' })
  user!: UserResponseDto;
}
