import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  ganttDurationDays,
  normalizeGanttWorkingCalendar,
  shiftGanttDate,
  shiftGanttTimestamp,
} from '~/helpers/ganttWorkingCalendar';

dayjs.extend(utc);
dayjs.extend(timezone);

describe('Gantt working calendar', () => {
  const calendar = normalizeGanttWorkingCalendar({
    enabled: true,
    weekdays: [1, 2, 3, 4, 5],
    holidays: ['2026-01-12'],
    timezone: 'UTC',
  });

  it('normalizes deterministic calendar metadata and rejects invalid input', () => {
    expect(
      normalizeGanttWorkingCalendar({
        enabled: true,
        weekdays: [5, 1, 3],
        holidays: ['2026-12-25', '2026-12-25'],
        timezone: 'Asia/Seoul',
      }),
    ).toEqual({
      enabled: true,
      weekdays: [1, 3, 5],
      holidays: ['2026-12-25'],
      timezone: 'Asia/Seoul',
    });
    expect(() =>
      normalizeGanttWorkingCalendar({
        enabled: true,
        weekdays: [1, 1],
        holidays: [],
        timezone: 'UTC',
      }),
    ).toThrow(/unique ISO weekdays/);
    expect(() =>
      normalizeGanttWorkingCalendar({
        enabled: true,
        weekdays: [1],
        holidays: ['2026-02-30'],
        timezone: 'UTC',
      }),
    ).toThrow(/valid YYYY-MM-DD/);
    expect(() =>
      normalizeGanttWorkingCalendar({
        enabled: true,
        weekdays: [1],
        holidays: [],
        timezone: 'Not/A_Zone',
      }),
    ).toThrow(/IANA timezone/);
  });

  it('skips weekends and project holidays in both directions', () => {
    expect(shiftGanttDate('2026-01-09', 1, calendar)).toBe('2026-01-13');
    expect(shiftGanttDate('2026-01-13', -1, calendar)).toBe('2026-01-09');
  });

  it('preserves local wall-clock time across daylight-saving transitions', () => {
    const newYork = normalizeGanttWorkingCalendar({
      enabled: true,
      weekdays: [1, 2, 3, 4, 5],
      holidays: [],
      timezone: 'America/New_York',
    });
    const friday = dayjs.tz('2026-03-06 09:30:00', newYork.timezone);
    const monday = dayjs(shiftGanttTimestamp(friday.valueOf(), 1, newYork)).tz(
      newYork.timezone,
    );
    expect(monday.format('YYYY-MM-DD HH:mm Z')).toBe('2026-03-09 09:30 -04:00');
  });

  it('counts only configured working dates as critical-path duration', () => {
    const start = dayjs.utc('2026-01-09T00:00:00Z').valueOf();
    const finish = dayjs.utc('2026-01-14T00:00:00Z').valueOf();
    expect(ganttDurationDays(start, finish, calendar)).toBe(2);
  });
});
