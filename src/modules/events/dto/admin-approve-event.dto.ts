import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, Matches } from 'class-validator';

export class AdminApproveEventDto {
  @ApiPropertyOptional({
    example: '2026-12-05T12:00:00+03:00',
    format: 'date-time',
    description:
      'Teacher events only, and required for them: when the event takes place, ISO 8601 date-time with a timezone ' +
      '(Z or ±hh:mm), in the future. Set once, on approval: nobody can change it afterwards. ' +
      'Must not be sent for a pupil event: the pupil chose its date on creation and it cannot be changed',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, {
    message:
      'startsAt must be a date-time with a timezone, e.g. 2026-12-05T12:00:00+03:00',
  })
  startsAt?: string;
}
