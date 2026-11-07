import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';

export class AdminApproveEventDto {
  @ApiProperty({
    example: '2026-12-05T12:00:00+03:00',
    format: 'date-time',
    description:
      'When the event takes place: ISO 8601 date-time with a timezone (Z or ±hh:mm), in the future. ' +
      'Set once, on approval: nobody can change it afterwards',
  })
  @IsISO8601({ strict: true })
  @Matches(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, {
    message:
      'startsAt must be a date-time with a timezone, e.g. 2026-12-05T12:00:00+03:00',
  })
  startsAt!: string;
}
