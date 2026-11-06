import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsISO8601, Matches } from 'class-validator';
import { EventCategories } from '../../../../prisma/generated/prisma/client';

export class ProbabilityQueryDto {
  @ApiProperty({
    enum: EventCategories,
    example: EventCategories.SPORTS,
    description: 'Kind of event',
  })
  @IsEnum(EventCategories)
  category!: EventCategories;

  @ApiProperty({
    example: '2026-12-05T12:00:00+03:00',
    format: 'date-time',
    description:
      'Planned start: ISO 8601 date-time with a timezone (Z or ±hh:mm). In a URL encode "+" as %2B, e.g. 2026-12-05T12:00:00%2B03:00',
  })
  @IsISO8601({ strict: true })
  // Without an explicit offset the moment would depend on the server timezone.
  @Matches(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, {
    message:
      'startsAt must be a date-time with a timezone, e.g. 2026-12-05T12:00:00+03:00',
  })
  startsAt!: string;
}
