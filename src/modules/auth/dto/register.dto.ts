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

export class AuthTokenResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken!: string;
}
