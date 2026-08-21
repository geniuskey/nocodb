import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface GanttWorkingCalendarConfig {
  enabled: boolean;
  weekdays: number[];
  holidays: string[];
  timezone: string;
}

export const DEFAULT_GANTT_WORKING_CALENDAR: GanttWorkingCalendarConfig = {
  enabled: false,
  weekdays: [1, 2, 3, 4, 5],
  holidays: [],
  timezone: 'UTC',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CALENDAR_SEARCH_DAYS = 36_600;

function dateOrdinal(value: string) {
  const [year, month, date] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / 86_400_000);
}

function ordinalDate(value: number) {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

function isRealDate(value: string) {
  return DATE_PATTERN.test(value) && ordinalDate(dateOrdinal(value)) === value;
}

export function normalizeGanttWorkingCalendar(
  value: unknown,
): GanttWorkingCalendarConfig {
  if (value === undefined || value === null) {
    return {
      ...DEFAULT_GANTT_WORKING_CALENDAR,
      weekdays: [...DEFAULT_GANTT_WORKING_CALENDAR.weekdays],
      holidays: [],
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Gantt working calendar must be an object');
  }

  const input = value as Record<string, unknown>;
  const enabled = input.enabled ?? false;
  const weekdays = input.weekdays ?? DEFAULT_GANTT_WORKING_CALENDAR.weekdays;
  const holidays = input.holidays ?? [];
  const timezoneName = input.timezone ?? 'UTC';
  if (typeof enabled !== 'boolean') {
    throw new Error('Gantt working calendar enabled must be a boolean');
  }
  if (
    !Array.isArray(weekdays) ||
    !weekdays.length ||
    weekdays.length > 7 ||
    weekdays.some(
      (day) => !Number.isInteger(day) || Number(day) < 1 || Number(day) > 7,
    ) ||
    new Set(weekdays).size !== weekdays.length
  ) {
    throw new Error(
      'Gantt working calendar weekdays must contain unique ISO weekdays 1 through 7',
    );
  }
  if (
    !Array.isArray(holidays) ||
    holidays.length > 366 ||
    holidays.some((date) => typeof date !== 'string' || !isRealDate(date))
  ) {
    throw new Error(
      'Gantt working calendar holidays must contain at most 366 valid YYYY-MM-DD dates',
    );
  }
  if (typeof timezoneName !== 'string' || !timezoneName.length) {
    throw new Error('Gantt working calendar timezone must be an IANA timezone');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezoneName }).format();
  } catch {
    throw new Error('Gantt working calendar timezone must be an IANA timezone');
  }

  return {
    enabled,
    weekdays: [...weekdays].map(Number).sort((left, right) => left - right),
    holidays: [...new Set(holidays as string[])].sort(),
    timezone: timezoneName,
  };
}

export function isGanttWorkingDate(
  date: string,
  calendar: GanttWorkingCalendarConfig,
) {
  if (!calendar.enabled) return true;
  const weekday = new Date(dateOrdinal(date) * 86_400_000).getUTCDay() || 7;
  return (
    calendar.weekdays.includes(weekday) && !calendar.holidays.includes(date)
  );
}

export function shiftGanttDate(
  date: string,
  days: number,
  calendar: GanttWorkingCalendarConfig,
) {
  if (!calendar.enabled) return ordinalDate(dateOrdinal(date) + days);
  if (!days) return date;
  const direction = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  let cursor = dateOrdinal(date);
  let searched = 0;
  while (remaining) {
    cursor += direction;
    searched += 1;
    if (searched > MAX_CALENDAR_SEARCH_DAYS) {
      throw new Error('Gantt working calendar shift exceeds 100 years');
    }
    if (isGanttWorkingDate(ordinalDate(cursor), calendar)) remaining -= 1;
  }
  return ordinalDate(cursor);
}

export function localGanttDate(
  timestamp: number,
  calendar: GanttWorkingCalendarConfig,
) {
  return dayjs(timestamp).tz(calendar.timezone).format('YYYY-MM-DD');
}

export function shiftGanttTimestamp(
  timestamp: number,
  days: number,
  calendar: GanttWorkingCalendarConfig,
) {
  if (!calendar.enabled) return timestamp + days * 86_400_000;
  if (!days) return timestamp;
  const local = dayjs(timestamp).tz(calendar.timezone);
  const targetDate = shiftGanttDate(local.format('YYYY-MM-DD'), days, calendar);
  return dayjs
    .tz(`${targetDate} ${local.format('HH:mm:ss.SSS')}`, calendar.timezone)
    .valueOf();
}

/** Shifts an exclusive midnight boundary that represents an inclusive Date. */
export function shiftGanttDateFinishTimestamp(
  finish: number,
  days: number,
  calendar: GanttWorkingCalendarConfig,
) {
  if (!calendar.enabled) return finish + days * 86_400_000;
  const finishDate = localGanttDate(finish, calendar);
  const inclusiveEnd = ordinalDate(dateOrdinal(finishDate) - 1);
  const shiftedEnd = shiftGanttDate(inclusiveEnd, days, calendar);
  const nextDate = ordinalDate(dateOrdinal(shiftedEnd) + 1);
  return dayjs.tz(`${nextDate} 00:00:00.000`, calendar.timezone).valueOf();
}

/** Returns the smallest forward working-day shift satisfying the instant. */
export function ganttWorkingShiftForConstraint(
  anchor: number,
  taskStart: number,
  minimum: number,
  calendar: GanttWorkingCalendarConfig,
) {
  if (!calendar.enabled) {
    return Math.max(0, Math.ceil((minimum - anchor) / 86_400_000));
  }
  if (
    anchor >= minimum &&
    isGanttWorkingDate(localGanttDate(taskStart, calendar), calendar)
  ) {
    return 0;
  }
  let shiftedAnchor = anchor;
  for (let days = 1; days <= MAX_CALENDAR_SEARCH_DAYS; days += 1) {
    shiftedAnchor = shiftGanttTimestamp(shiftedAnchor, 1, calendar);
    if (shiftedAnchor >= minimum) return days;
  }
  throw new Error('Gantt working calendar constraint exceeds 100 years');
}

export function ganttDurationDays(
  start: number,
  finish: number,
  calendar: GanttWorkingCalendarConfig,
) {
  if (!calendar.enabled) return (finish - start) / 86_400_000;
  if (finish <= start) return 0;

  let cursor = start;
  let duration = 0;
  let searched = 0;
  while (cursor < finish) {
    const local = dayjs(cursor).tz(calendar.timezone);
    const date = local.format('YYYY-MM-DD');
    const nextDate = ordinalDate(dateOrdinal(date) + 1);
    const next = Math.min(
      finish,
      dayjs.tz(`${nextDate} 00:00:00.000`, calendar.timezone).valueOf(),
    );
    if (isGanttWorkingDate(date, calendar)) {
      const dayStart = dayjs.tz(`${date} 00:00:00.000`, calendar.timezone);
      const dayEnd = dayjs.tz(`${nextDate} 00:00:00.000`, calendar.timezone);
      duration += (next - cursor) / (dayEnd.valueOf() - dayStart.valueOf());
    }
    cursor = next;
    searched += 1;
    if (searched > MAX_CALENDAR_SEARCH_DAYS) {
      throw new Error('Gantt working calendar duration exceeds 100 years');
    }
  }
  return duration;
}
