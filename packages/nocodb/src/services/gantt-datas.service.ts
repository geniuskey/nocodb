import { Injectable } from '@nestjs/common';
import { ViewTypes } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import { GanttView, Model, View } from '~/models';
import { NcError } from '~/helpers/catchError';
import { DatasService } from '~/services/datas.service';
import {
  buildScheduleRangeConditions,
  parseScheduleInteger,
  SCHEDULE_RANGE_DEFAULT_LIMIT,
  SCHEDULE_RANGE_MAX_LIMIT,
  validateScheduleRange,
} from '~/services/schedule-range';

@Injectable()
export class GanttDatasService {
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
    if (!view || view.type !== ViewTypes.GANTT) {
      NcError.get(context).badRequest('View is not a Gantt view');
    }

    const gantt = await GanttView.get(context, view.id);
    if (!gantt?.fk_start_column_id || !gantt?.fk_end_column_id) {
      NcError.get(context).badRequest(
        'Gantt start and end fields must be configured before loading tasks',
      );
    }

    const { from, to } = validateScheduleRange(
      context,
      'Gantt',
      param.from,
      param.to,
    );
    const limit = parseScheduleInteger(context, 'Gantt', 'limit', param.limit, {
      defaultValue: SCHEDULE_RANGE_DEFAULT_LIMIT,
      min: 1,
      max: SCHEDULE_RANGE_MAX_LIMIT,
    });
    const offset = parseScheduleInteger(
      context,
      'Gantt',
      'offset',
      param.offset,
      { defaultValue: 0, min: 0 },
    );

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
      customConditions: buildScheduleRangeConditions({
        startColumnId: gantt.fk_start_column_id,
        endColumnId: gantt.fk_end_column_id,
        from,
        to,
      }),
      limitOverride: limit,
      throwErrorIfInvalidParams: true,
    });
  }
}
