/**
 * Timezone utilities using Luxon.
 * Handles timezone conversions and formatting for calendar operations.
 */

import { DateTime, Duration, Interval, Zone, IANAZone, Settings } from 'luxon';

/**
 * Convert a date from one timezone to another.
 */
export function convertTimezone(date: Date, fromTz: string, toTz: string): Date {
  const dt = DateTime.fromJSDate(date, { zone: fromTz });
  return dt.setZone(toTz).toJSDate();
}

/**
 * Convert a date to UTC.
 */
export function toUTC(date: Date, fromTz: string = 'local'): Date {
  const dt = DateTime.fromJSDate(date, { zone: fromTz });
  return dt.toUTC().toJSDate();
}

/**
 * Convert a UTC date to a specific timezone.
 */
export function fromUTC(date: Date, toTz: string): Date {
  const dt = DateTime.fromJSDate(date, { zone: 'UTC' });
  return dt.setZone(toTz).toJSDate();
}

/**
 * Parse an ISO 8601 string with timezone.
 */
export function parseISO(isoString: string, defaultTz: string = 'UTC'): Date {
  const dt = DateTime.fromISO(isoString, { zone: defaultTz });
  if (!dt.isValid) {
    throw new Error(`Invalid ISO date: ${isoString}`);
  }
  return dt.toJSDate();
}

/**
 * Format a date to ISO 8601 string in a specific timezone.
 */
export function formatISO(date: Date, tz: string = 'UTC'): string {
  const dt = DateTime.fromJSDate(date).setZone(tz);
  return dt.toISO() || '';
}

/**
 * Format a date for display in a specific timezone.
 */
export function formatDisplay(
  date: Date,
  tz: string = 'local',
  format: string = 'yyyy-MM-dd HH:mm'
): string {
  const dt = DateTime.fromJSDate(date).setZone(tz);
  return dt.toFormat(format);
}

/**
 * Format a date for a calendar event (with timezone label).
 */
export function formatEventTime(date: Date, tz: string, isAllDay: boolean = false): string {
  const dt = DateTime.fromJSDate(date).setZone(tz);

  if (isAllDay) {
    return dt.toFormat('EEEE, MMMM d, yyyy');
  }

  return `${dt.toFormat('EEEE, MMMM d, yyyy h:mm a')} (${dt.offsetNameShort})`;
}

/**
 * Get the start of day in a specific timezone.
 */
export function startOfDay(date: Date, tz: string): Date {
  const dt = DateTime.fromJSDate(date).setZone(tz);
  return dt.startOf('day').toJSDate();
}

/**
 * Get the end of day in a specific timezone.
 */
export function endOfDay(date: Date, tz: string): Date {
  const dt = DateTime.fromJSDate(date).setZone(tz);
  return dt.endOf('day').toJSDate();
}

/**
 * Get the start of week in a specific timezone.
 */
export function startOfWeek(date: Date, tz: string): Date {
  const dt = DateTime.fromJSDate(date).setZone(tz);
  return dt.startOf('week').toJSDate();
}

/**
 * Get the end of week in a specific timezone.
 */
export function endOfWeek(date: Date, tz: string): Date {
  const dt = DateTime.fromJSDate(date).setZone(tz);
  return dt.endOf('week').toJSDate();
}

/**
 * Check if a timezone is valid.
 */
export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

/**
 * Get the UTC offset for a timezone at a specific time.
 */
export function getUTCOffset(tz: string, at: Date = new Date()): string {
  const dt = DateTime.fromJSDate(at).setZone(tz);
  return dt.toFormat('ZZ');
}

/**
 * Get the timezone abbreviation (e.g., PST, EST).
 */
export function getTimezoneAbbreviation(tz: string, at: Date = new Date()): string {
  const dt = DateTime.fromJSDate(at).setZone(tz);
  return dt.offsetNameShort || '';
}

/**
 * Calculate the duration between two dates.
 */
export function getDuration(start: Date, end: Date): {
  days: number;
  hours: number;
  minutes: number;
  totalMinutes: number;
} {
  const duration = Duration.fromMillis(end.getTime() - start.getTime());
  return {
    days: Math.floor(duration.as('days')),
    hours: Math.floor(duration.as('hours') % 24),
    minutes: Math.floor(duration.as('minutes') % 60),
    totalMinutes: Math.floor(duration.as('minutes')),
  };
}

/**
 * Add duration to a date.
 */
export function addDuration(
  date: Date,
  duration: { days?: number; hours?: number; minutes?: number }
): Date {
  const dt = DateTime.fromJSDate(date);
  return dt.plus(duration).toJSDate();
}

/**
 * Subtract duration from a date.
 */
export function subtractDuration(
  date: Date,
  duration: { days?: number; hours?: number; minutes?: number }
): Date {
  const dt = DateTime.fromJSDate(date);
  return dt.minus(duration).toJSDate();
}

/**
 * Check if two date ranges overlap.
 */
export function doIntervalsOverlap(
  start1: Date,
  end1: Date,
  start2: Date,
  end2: Date
): boolean {
  const interval1 = Interval.fromDateTimes(
    DateTime.fromJSDate(start1),
    DateTime.fromJSDate(end1)
  );
  const interval2 = Interval.fromDateTimes(
    DateTime.fromJSDate(start2),
    DateTime.fromJSDate(end2)
  );
  return interval1.overlaps(interval2);
}

/**
 * Get the overlap between two date ranges.
 */
export function getIntervalOverlap(
  start1: Date,
  end1: Date,
  start2: Date,
  end2: Date
): { start: Date; end: Date } | null {
  const interval1 = Interval.fromDateTimes(
    DateTime.fromJSDate(start1),
    DateTime.fromJSDate(end1)
  );
  const interval2 = Interval.fromDateTimes(
    DateTime.fromJSDate(start2),
    DateTime.fromJSDate(end2)
  );

  const overlap = interval1.intersection(interval2);
  if (!overlap) return null;

  return {
    start: overlap.start?.toJSDate() ?? start1,
    end: overlap.end?.toJSDate() ?? end1,
  };
}

/**
 * Get common timezone identifiers grouped by region.
 */
export function getCommonTimezones(): Record<string, string[]> {
  return {
    'Americas': [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Toronto',
      'America/Vancouver',
      'America/Mexico_City',
      'America/Sao_Paulo',
    ],
    'Europe': [
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Amsterdam',
      'Europe/Madrid',
      'Europe/Rome',
      'Europe/Moscow',
    ],
    'Asia': [
      'Asia/Dubai',
      'Asia/Kolkata',
      'Asia/Singapore',
      'Asia/Shanghai',
      'Asia/Tokyo',
      'Asia/Seoul',
      'Asia/Hong_Kong',
    ],
    'Pacific': [
      'Pacific/Auckland',
      'Pacific/Fiji',
      'Pacific/Honolulu',
      'Australia/Sydney',
      'Australia/Melbourne',
    ],
  };
}
