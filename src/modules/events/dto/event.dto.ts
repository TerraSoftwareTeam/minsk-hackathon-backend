import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EventAccess } from '../../../../prisma/generated/prisma/client';

export class CreateEventDto {
  @ApiProperty({ example: 'Экскурсия в планетарий' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'Сбор у главного входа школы.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @ApiProperty({
    example: '2026-12-01T15:00',
    description:
      'Event start, ISO 8601. Without an offset it is read as Europe/Minsk local time. Stored in UTC. Must be in the future. Sign-up closes at this moment.',
  })
  @IsString()
  @IsNotEmpty()
  startsAt!: string;

  @ApiProperty({
    enum: EventAccess,
    description:
      'SCHOOL: only pupils of one school; ALL: every pupil of the city.',
  })
  @IsEnum(EventAccess)
  access!: EventAccess;

  @ApiPropertyOptional({
    description:
      'For access = SCHOOL. A teacher may omit it (their own school is used); an organizator must pass it. Ignored for ALL.',
  })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 30,
    description: 'Maximum number of participants. Omit or null: unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxParticipants?: number | null;
}

/**
 * Allowed only while the event is active (before startsAt).
 * maxParticipants: null removes the limit; omitted keeps it.
 */
export class UpdateEventDto extends PartialType(CreateEventDto) {}

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListEventsQueryDto {
  @ApiPropertyOptional({
    description:
      'true: only events still open for sign-up; false: only past (inactive) events',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'true: only events the current user signed up for',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  registered?: boolean;

  @ApiPropertyOptional({
    description: 'true: only events created by the current user',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mine?: boolean;
}

export class EventResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ description: 'UTC' }) startsAt!: Date;
  @ApiProperty({ example: 'Europe/Minsk' }) timeZone!: string;
  @ApiProperty({ enum: EventAccess }) access!: EventAccess;
  @ApiPropertyOptional({ nullable: true }) schoolId!: string | null;
  @ApiPropertyOptional({ nullable: true }) schoolName!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'null: unlimited' })
  maxParticipants!: number | null;
  @ApiProperty() participantsCount!: number;
  @ApiProperty({
    description: 'Sign-up is open: startsAt has not passed yet',
  })
  isActive!: boolean;
  @ApiProperty({ description: 'No free spots left' }) isFull!: boolean;
  @ApiProperty({ description: 'The current user is signed up' })
  isRegistered!: boolean;
  @ApiProperty({
    description: 'The current user may edit the event',
  })
  canManage!: boolean;
  @ApiPropertyOptional({ nullable: true }) creatorId!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Иванова Мария' })
  creatorName!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class EventParticipantDto {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() surname!: string;
  @ApiProperty() fathersName!: string;
  @ApiPropertyOptional({ nullable: true }) class!: string | null;
  @ApiPropertyOptional({ nullable: true }) schoolName!: string | null;
  @ApiProperty() registeredAt!: Date;
}
