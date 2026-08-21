import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  GanttScheduleApplyReqType,
  GanttSchedulePreviewReqType,
} from 'nocodb-sdk';
import { NcContext, NcRequest } from '~/interface/config';
import { GlobalGuard } from '~/guards/global/global.guard';
import { DataApiLimiterGuard } from '~/guards/data-api-limiter.guard';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import { GanttSchedulesService } from '~/services/gantt-schedules.service';

@Controller()
@UseGuards(DataApiLimiterGuard, GlobalGuard)
export class GanttSchedulesController {
  constructor(private readonly ganttSchedulesService: GanttSchedulesService) {}

  @Post([
    '/api/v1/db/meta/gantts/:viewId/schedule/preview',
    '/api/v2/meta/gantts/:viewId/schedule/preview',
  ])
  @Acl('dataList')
  async preview(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
    @Body() body: GanttSchedulePreviewReqType,
  ) {
    return await this.ganttSchedulesService.preview(context, viewId, body);
  }

  @Post([
    '/api/v1/db/meta/gantts/:viewId/schedule/apply',
    '/api/v2/meta/gantts/:viewId/schedule/apply',
  ])
  @Acl('dataUpdate')
  async apply(
    @TenantContext() context: NcContext,
    @Req() req: NcRequest,
    @Param('viewId') viewId: string,
    @Body() body: GanttScheduleApplyReqType,
  ) {
    return await this.ganttSchedulesService.apply(context, viewId, body, req);
  }
}
