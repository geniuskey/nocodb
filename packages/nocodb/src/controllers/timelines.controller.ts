import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TimelineUpdateReqType, ViewCreateReqType } from 'nocodb-sdk';
import { GlobalGuard } from '~/guards/global/global.guard';
import { TimelinesService } from '~/services/timelines.service';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { MetaApiLimiterGuard } from '~/guards/meta-api-limiter.guard';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import { NcContext, NcRequest } from '~/interface/config';

@Controller()
@UseGuards(MetaApiLimiterGuard, GlobalGuard)
export class TimelinesController {
  constructor(private readonly timelinesService: TimelinesService) {}

  @Get(['/api/v1/db/meta/timelines/:viewId', '/api/v2/meta/timelines/:viewId'])
  @Acl('timelineViewGet')
  async timelineViewGet(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
  ) {
    return await this.timelinesService.timelineViewGet(context, {
      timelineViewId: viewId,
    });
  }

  @Post([
    '/api/v1/db/meta/tables/:tableId/timelines',
    '/api/v2/meta/tables/:tableId/timelines',
  ])
  @HttpCode(200)
  @Acl('timelineViewCreate')
  async timelineViewCreate(
    @TenantContext() context: NcContext,
    @Param('tableId') tableId: string,
    @Body() body: ViewCreateReqType,
    @Req() req: NcRequest,
  ) {
    return await this.timelinesService.timelineViewCreate(context, {
      timeline: body,
      tableId,
      req,
    });
  }

  @Patch([
    '/api/v1/db/meta/timelines/:viewId',
    '/api/v2/meta/timelines/:viewId',
  ])
  @Acl('timelineViewUpdate')
  async timelineViewUpdate(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
    @Body() body: TimelineUpdateReqType,
    @Req() req: NcRequest,
  ) {
    return await this.timelinesService.timelineViewUpdate(context, {
      viewId,
      timeline: body,
      req,
    });
  }
}
