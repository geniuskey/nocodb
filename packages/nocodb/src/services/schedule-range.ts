import dayjs from 'dayjs';
import type { FilterType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import { NcError } from '~/helpers/catchError';
import { Filter } from '~/models';

export const SCHEDULE_RANGE_DEFAULT_LIMIT = 500;
export const SCHEDULE_RANGE_MAX_LIMIT = 1000;
export const SCHEDULE_RANGE_MAX_DAYS = 366;

export function validateScheduleRange(
  context: NcContext,
  label: string,
  from: string,
  to: string,
) {
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    NcError.get(context).badRequest(
      `${label} from and to must use YYYY-MM-DD format`,
    );
  }

  const fromDate = dayjs(from);
  const toDate = dayjs(to);
  const rangeDays = toDate.diff(fromDate, 'day');
  if (rangeDays <= 0) {
    NcError.get(context).badRequest(`${label} to must be later than from`);
  }
  if (rangeDays > SCHEDULE_RANGE_MAX_DAYS) {
    NcError.get(context).badRequest(
      `${label} range must not exceed ${SCHEDULE_RANGE_MAX_DAYS} days`,
    );
  }

  return { from, to };
}

export function parseScheduleInteger(
  context: NcContext,
  label: string,
  name: string,
  value: string,
  options: { defaultValue: number; min: number; max?: number },
) {
  if (value === undefined) return options.defaultValue;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    NcError.get(context).badRequest(`${label} ${name} must be an integer`);
  }

  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < options.min ||
    (options.max !== undefined && parsed > options.max)
  ) {
    const range =
      options.max === undefined
        ? `at least ${options.min}`
        : `between ${options.min} and ${options.max}`;
    NcError.get(context).badRequest(`${label} ${name} must be ${range}`);
  }
  return parsed;
}

export function buildScheduleRangeConditions(param: {
  startColumnId: string;
  endColumnId?: string;
  from: string;
  to: string;
}): Filter[] {
  const startBeforeRangeEnd: FilterType = {
    fk_column_id: param.startColumnId,
    comparison_op: 'lt',
    comparison_sub_op: 'exactDate',
    value: param.to,
  };
  const startInsideRange: FilterType = {
    fk_column_id: param.startColumnId,
    comparison_op: 'gte',
    comparison_sub_op: 'exactDate',
    value: param.from,
  };

  if (!param.endColumnId) {
    return [new Filter(startInsideRange), new Filter(startBeforeRangeEnd)];
  }

  return [
    new Filter(startBeforeRangeEnd),
    new Filter({
      is_group: true,
      children: [
        {
          fk_column_id: param.endColumnId,
          comparison_op: 'gte',
          comparison_sub_op: 'exactDate',
          value: param.from,
        },
        {
          is_group: true,
          logical_op: 'or',
          children: [
            {
              fk_column_id: param.endColumnId,
              comparison_op: 'blank',
            },
            { ...startInsideRange, logical_op: 'and' },
          ],
        },
      ],
    }),
  ];
}

function isCalendarDate(value: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = dayjs(value);
  return parsed.isValid() && parsed.format('YYYY-MM-DD') === value;
}
