import { BadRequestException } from '@nestjs/common';

/**
 * Tournaments are configured in Europe/Minsk local time. Minsk has been fixed at
 * UTC+03:00 with no DST since 2011, so a constant offset is exact.
 * Values are always stored in UTC; clients convert for display.
 */
export const TOURNAMENT_TIME_ZONE = 'Europe/Minsk';
const MINSK_OFFSET = '+03:00';
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?/;

/**
 * Parses an ISO 8601 date-time. Without an explicit offset it is read as Minsk
 * local time ("2026-12-01T09:00" -> 2026-12-01T06:00:00Z).
 */
export function parseMinskDateTime(value: string): Date {
  if (!ISO_LOCAL.test(value)) {
    throw new BadRequestException(
      'Expected ISO 8601 date-time, e.g. 2026-12-01T09:00',
    );
  }
  const date = new Date(
    HAS_OFFSET.test(value) ? value : `${value}${MINSK_OFFSET}`,
  );
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Invalid date-time');
  }
  return date;
}
