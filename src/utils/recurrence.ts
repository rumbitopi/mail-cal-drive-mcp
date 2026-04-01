/**
 * Recurrence utilities using RRule.
 * Handles parsing and generation of recurring event patterns.
 */

import rruleLib from 'rrule';
const { RRule, RRuleSet, rrulestr } = rruleLib;
type Frequency = number;
type Weekday = typeof RRule.MO;
type Options = ConstructorParameters<typeof RRule>[0];

/**
 * Recurrence rule definition matching calendar event types.
 */
export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  count?: number;
  until?: string; // ISO date
  byDay?: string[]; // MO, TU, WE, TH, FR, SA, SU
  byMonth?: number[]; // 1-12
  byMonthDay?: number[]; // 1-31
}

/**
 * Map frequency string to RRule constant.
 */
function mapFrequency(freq: string): Frequency {
  switch (freq.toLowerCase()) {
    case 'daily':
      return RRule.DAILY;
    case 'weekly':
      return RRule.WEEKLY;
    case 'monthly':
      return RRule.MONTHLY;
    case 'yearly':
      return RRule.YEARLY;
    default:
      return RRule.DAILY;
  }
}

/**
 * Map day string to RRule weekday.
 */
function mapWeekday(day: string): Weekday {
  switch (day.toUpperCase()) {
    case 'MO':
      return RRule.MO;
    case 'TU':
      return RRule.TU;
    case 'WE':
      return RRule.WE;
    case 'TH':
      return RRule.TH;
    case 'FR':
      return RRule.FR;
    case 'SA':
      return RRule.SA;
    case 'SU':
      return RRule.SU;
    default:
      return RRule.MO;
  }
}

/**
 * Create an RRule from our recurrence rule definition.
 */
export function createRRule(startDate: Date, rule: RecurrenceRule): InstanceType<typeof RRule> {
  const options: Partial<Options> = {
    freq: mapFrequency(rule.frequency),
    dtstart: startDate,
  };

  if (rule.interval) {
    options.interval = rule.interval;
  }

  if (rule.count) {
    options.count = rule.count;
  }

  if (rule.until) {
    options.until = new Date(rule.until);
  }

  if (rule.byDay && rule.byDay.length > 0) {
    options.byweekday = rule.byDay.map(mapWeekday);
  }

  if (rule.byMonth && rule.byMonth.length > 0) {
    options.bymonth = rule.byMonth;
  }

  if (rule.byMonthDay && rule.byMonthDay.length > 0) {
    options.bymonthday = rule.byMonthDay;
  }

  return new RRule(options as Options);
}

/**
 * Parse an RRULE string to our recurrence rule definition.
 */
export function parseRRule(rruleString: string): RecurrenceRule | null {
  try {
    const rule = rrulestr(rruleString);

    const result: RecurrenceRule = {
      frequency: getFrequencyString(rule.options.freq as Frequency),
    };

    if (rule.options.interval && rule.options.interval !== 1) {
      result.interval = rule.options.interval;
    }

    if (rule.options.count) {
      result.count = rule.options.count;
    }

    if (rule.options.until) {
      result.until = rule.options.until.toISOString();
    }

    if (rule.options.byweekday && rule.options.byweekday.length > 0) {
      result.byDay = rule.options.byweekday.map((wd: Weekday | number) => {
        if (typeof wd === 'number') {
          return ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][wd] || 'MO';
        }
        return wd.toString();
      });
    }

    if (rule.options.bymonth && rule.options.bymonth.length > 0) {
      result.byMonth = rule.options.bymonth as number[];
    }

    if (rule.options.bymonthday && rule.options.bymonthday.length > 0) {
      result.byMonthDay = rule.options.bymonthday as number[];
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Convert frequency constant to string.
 */
function getFrequencyString(freq: Frequency): 'daily' | 'weekly' | 'monthly' | 'yearly' {
  switch (freq) {
    case RRule.DAILY:
      return 'daily';
    case RRule.WEEKLY:
      return 'weekly';
    case RRule.MONTHLY:
      return 'monthly';
    case RRule.YEARLY:
      return 'yearly';
    default:
      return 'daily';
  }
}

/**
 * Generate occurrence dates for a recurrence rule.
 */
export function getOccurrences(
  startDate: Date,
  rule: RecurrenceRule,
  options: {
    after?: Date;
    before?: Date;
    count?: number;
  } = {}
): Date[] {
  const rrule = createRRule(startDate, rule);

  if (options.after && options.before) {
    return rrule.between(options.after, options.before, true);
  }

  if (options.after) {
    const next = rrule.after(options.after, true);
    return next ? [next] : [];
  }

  if (options.count) {
    return rrule.all((_date: Date, i: number) => i < options.count!);
  }

  // Default: return first 100 occurrences
  return rrule.all((_date: Date, i: number) => i < 100);
}

/**
 * Get the next occurrence after a given date.
 */
export function getNextOccurrence(
  startDate: Date,
  rule: RecurrenceRule,
  after: Date = new Date()
): Date | null {
  const rrule = createRRule(startDate, rule);
  return rrule.after(after, true);
}

/**
 * Check if a date is an occurrence of the recurrence rule.
 */
export function isOccurrence(startDate: Date, rule: RecurrenceRule, date: Date): boolean {
  const occurrences = getOccurrences(startDate, rule, {
    after: new Date(date.getTime() - 1000),
    before: new Date(date.getTime() + 1000),
  });

  return occurrences.some(
    (occ) => Math.abs(occ.getTime() - date.getTime()) < 1000
  );
}

/**
 * Convert our recurrence rule to RRULE string.
 */
export function toRRuleString(startDate: Date, rule: RecurrenceRule): string {
  const rrule = createRRule(startDate, rule);
  return rrule.toString();
}

/**
 * Get a human-readable description of the recurrence rule.
 */
export function describeRecurrence(rule: RecurrenceRule): string {
  const rrule = createRRule(new Date(), rule);
  return rrule.toText();
}

/**
 * Common recurrence presets.
 */
export const RecurrencePresets = {
  daily: (): RecurrenceRule => ({
    frequency: 'daily',
    interval: 1,
  }),

  weekdays: (): RecurrenceRule => ({
    frequency: 'weekly',
    byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
  }),

  weekly: (dayOfWeek?: string): RecurrenceRule => ({
    frequency: 'weekly',
    interval: 1,
    ...(dayOfWeek ? { byDay: [dayOfWeek] } : {}),
  }),

  biweekly: (dayOfWeek?: string): RecurrenceRule => ({
    frequency: 'weekly',
    interval: 2,
    ...(dayOfWeek ? { byDay: [dayOfWeek] } : {}),
  }),

  monthly: (dayOfMonth?: number): RecurrenceRule => ({
    frequency: 'monthly',
    interval: 1,
    ...(dayOfMonth ? { byMonthDay: [dayOfMonth] } : {}),
  }),

  yearly: (month?: number, day?: number): RecurrenceRule => ({
    frequency: 'yearly',
    interval: 1,
    ...(month ? { byMonth: [month] } : {}),
    ...(day ? { byMonthDay: [day] } : {}),
  }),

  firstWeekday: (dayOfWeek: string): RecurrenceRule => ({
    frequency: 'monthly',
    byDay: [`1${dayOfWeek}`],
  }),

  lastWeekday: (dayOfWeek: string): RecurrenceRule => ({
    frequency: 'monthly',
    byDay: [`-1${dayOfWeek}`],
  }),
};
