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
import { GanttUpdateReqType, ViewCreateReqType } from 'nocodb-sdk';
import { GlobalGuard } from '~/guards/global/global.guard';
import { GanttsService } from '~/services/gantts.service';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { MetaApiLimiterGuard } from '~/guards/meta-api-limiter.guard';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import { NcContext, NcRequest } from '~/interface/config';

@Controller()
@UseGuards(MetaApiLimiterGuard, GlobalGuard)
export class GanttsController {
  constructor(private readonly ganttsService: GanttsService) {}

  @Get(['/api/v1/db/meta/gantts/:viewId', '/api/v2/meta/gantts/:viewId'])
  @Acl('ganttViewGet')
  async ganttViewGet(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
  ) {
    return await this.ganttsService.ganttViewGet(context, {
      ganttViewId: viewId,
    });
  }

  @Post([
    '/api/v1/db/meta/tables/:tableId/gantts',
    '/api/v2/meta/tables/:tableId/gantts',
  ])
  @HttpCode(200)
  @Acl('ganttViewCreate')
  async ganttViewCreate(
    @TenantContext() context: NcContext,
    @Param('tableId') tableId: string,
    @Body() body: ViewCreateReqType,
    @Req() req: NcRequest,
  ) {
    return await this.ganttsService.ganttViewCreate(context, {
      gantt: body,
      tableId,
      req,
    });
  }

  @Patch(['/api/v1/db/meta/gantts/:viewId', '/api/v2/meta/gantts/:viewId'])
  @Acl('ganttViewUpdate')
  async ganttViewUpdate(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
    @Body() body: GanttUpdateReqType,
    @Req() req: NcRequest,
  ) {
    return await this.ganttsService.ganttViewUpdate(context, {
      viewId,
      gantt: body,
      req,
    });
  }
}
