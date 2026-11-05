import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { UserRoles } from '../../../../prisma/generated/prisma/client';

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

  @ApiProperty({ enum: UserRoles, example: UserRoles.PUPIL, description: 'User role' })
  @IsEnum(UserRoles)
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

export class UserResponseDto {
  @ApiProperty({ example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90' })
  id!: string;

  @ApiProperty({ example: 'school-user-123' })
  schoolsById!: string;

  @ApiProperty({ example: 'Ivan' })
  name!: string;

  @ApiProperty({ example: 'Ivanov' })
  surname!: string;

  @ApiProperty({ example: 'Petrovich' })
  fathersName!: string;

  @ApiProperty({ example: '10A' })
  class!: string;

  @ApiProperty({ enum: UserRoles, example: UserRoles.PUPIL })
  role!: UserRoles;

  @ApiProperty({ example: 'School #1' })
  schoolName!: string;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken!: string;

  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}
