import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { ViewTypes } from 'nocodb-sdk';
import type { FilterType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import { Filter, Model, TimelineView, View } from '~/models';
import { NcError } from '~/helpers/catchError';
import { DatasService } from '~/services/datas.service';

export const TIMELINE_RANGE_DEFAULT_LIMIT = 500;
export const TIMELINE_RANGE_MAX_LIMIT = 1000;
export const TIMELINE_RANGE_MAX_DAYS = 366;

@Injectable()
export class TimelineDatasService {
  constructor(protected readonly datasService: DatasService) {}

  async dataList(
    context: NcContext,
    param: {
      viewId: string;
      query: Record<string, any>;
      from: string;
      to: string;
      limit?: string;
      offset?: string;
    },
  ) {
    const view = await View.get(context, param.viewId);
    if (!view || view.type !== ViewTypes.TIMELINE) {
      NcError.get(context).badRequest('View is not a timeline view');
    }

    const timeline = await TimelineView.get(context, view.id);
    if (!timeline?.fk_start_column_id) {
      NcError.get(context).badRequest(
        'Timeline start field must be configured before loading records',
      );
    }

    const { from, to } = this.validateRange(context, param.from, param.to);
    const limit = this.parseInteger(context, 'limit', param.limit, {
      defaultValue: TIMELINE_RANGE_DEFAULT_LIMIT,
      min: 1,
      max: TIMELINE_RANGE_MAX_LIMIT,
    });
    const offset = this.parseInteger(context, 'offset', param.offset, {
      defaultValue: 0,
      min: 0,
    });

    const model = await Model.getByIdOrName(context, {
      id: view.fk_model_id,
    });
    if (!model) NcError.get(context).tableNotFound(view.fk_model_id);

    const query = { ...param.query, limit, offset };
    for (const key of ['from', 'to', 'l', 'o', 'page']) delete query[key];

    return await this.datasService.getDataList(context, {
      model,
      view,
      query,
      customConditions: this.buildRangeConditions({
        startColumnId: timeline.fk_start_column_id,
        endColumnId: timeline.fk_end_column_id,
        from,
        to,
      }),
      limitOverride: limit,
      throwErrorIfInvalidParams: true,
    });
  }

  private validateRange(context: NcContext, from: string, to: string) {
    if (!this.isCalendarDate(from) || !this.isCalendarDate(to)) {
      NcError.get(context).badRequest(
        'Timeline from and to must use YYYY-MM-DD format',
      );
    }

    const fromDate = dayjs(from);
    const toDate = dayjs(to);
    const rangeDays = toDate.diff(fromDate, 'day');
    if (rangeDays <= 0) {
      NcError.get(context).badRequest('Timeline to must be later than from');
    }
    if (rangeDays > TIMELINE_RANGE_MAX_DAYS) {
      NcError.get(context).badRequest(
        `Timeline range must not exceed ${TIMELINE_RANGE_MAX_DAYS} days`,
      );
    }

    return { from, to };
  }

  private isCalendarDate(value: string) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const parsed = dayjs(value);
    return parsed.isValid() && parsed.format('YYYY-MM-DD') === value;
  }

  private parseInteger(
    context: NcContext,
    name: string,
    value: string,
    options: { defaultValue: number; min: number; max?: number },
  ) {
    if (value === undefined) return options.defaultValue;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      NcError.get(context).badRequest(`Timeline ${name} must be an integer`);
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
      NcError.get(context).badRequest(`Timeline ${name} must be ${range}`);
    }
    return parsed;
  }

  private buildRangeConditions(param: {
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
}
