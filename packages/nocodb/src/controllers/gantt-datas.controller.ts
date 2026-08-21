import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { NcContext, NcRequest } from '~/interface/config';
import { GlobalGuard } from '~/guards/global/global.guard';
import { DataApiLimiterGuard } from '~/guards/data-api-limiter.guard';
import { GanttDatasService } from '~/services/gantt-datas.service';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { TenantContext } from '~/decorators/tenant-context.decorator';

@Controller()
@UseGuards(DataApiLimiterGuard, GlobalGuard)
export class GanttDatasController {
  constructor(private readonly ganttDatasService: GanttDatasService) {}

  @Get(['/api/v1/db/gantt-data/:viewId', '/api/v2/gantts/:viewId/records'])
  @Acl('dataList')
  async dataList(
    @TenantContext() context: NcContext,
    @Req() req: NcRequest,
    @Param('viewId') viewId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string,
  ) {
    return await this.ganttDatasService.dataList(context, {
      viewId,
      query: req.query,
      from,
      to,
      limit,
      offset,
    });
  }
}
