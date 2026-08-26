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
import type { ListUpdateReqType, ViewCreateReqType } from 'nocodb-sdk';
import { GlobalGuard } from '~/guards/global/global.guard';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { MetaApiLimiterGuard } from '~/guards/meta-api-limiter.guard';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import type { NcContext, NcRequest } from '~/interface/config';
import { ListsService } from '~/services/lists.service';

@Controller()
@UseGuards(MetaApiLimiterGuard, GlobalGuard)
export class ListsController {
  constructor(private readonly listsService: ListsService) {}

  @Get(['/api/v1/db/meta/lists/:viewId', '/api/v2/meta/lists/:viewId'])
  @Acl('listViewGet')
  async listViewGet(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
  ) {
    return await this.listsService.listViewGet(context, {
      listViewId: viewId,
    });
  }

  @Post([
    '/api/v1/db/meta/tables/:tableId/lists',
    '/api/v2/meta/tables/:tableId/lists',
  ])
  @HttpCode(200)
  @Acl('listViewCreate')
  async listViewCreate(
    @TenantContext() context: NcContext,
    @Param('tableId') tableId: string,
    @Body() body: ViewCreateReqType,
    @Req() req: NcRequest,
  ) {
    return await this.listsService.listViewCreate(context, {
      tableId,
      list: body,
      req,
    });
  }

  @Patch([
    '/api/v1/db/meta/lists/:viewId',
    '/api/v2/meta/lists/:viewId',
  ])
  @Acl('listViewUpdate')
  async listViewUpdate(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
    @Body() body: ListUpdateReqType,
    @Req() req: NcRequest,
  ) {
    return await this.listsService.listViewUpdate(context, {
      listViewId: viewId,
      list: body,
      req,
    });
  }
}
