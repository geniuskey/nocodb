import {
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ListUpdateReqType, ViewCreateReqType } from 'nocodb-sdk';
import { GlobalGuard } from '~/guards/global/global.guard';
import { ListsService } from '~/services/lists.service';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { MetaApiLimiterGuard } from '~/guards/meta-api-limiter.guard';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import { NcContext, NcRequest } from '~/interface/config';

@Controller()
@UseGuards(MetaApiLimiterGuard, GlobalGuard)
export class ListsController {
  constructor(private readonly listsService: ListsService) {}

  @Post([
    '/api/v1/db/meta/tables/:tableId/lists/',
    '/api/v2/meta/tables/:tableId/lists/',
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
      list: body,
      tableId,
      req,
    });
  }

  @Patch(['/api/v1/db/meta/lists/:viewId', '/api/v2/meta/lists/:viewId'])
  @Acl('listViewUpdate')
  async listViewUpdate(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
    @Body() body: ListUpdateReqType,
    @Req() req: NcRequest,
  ) {
    return await this.listsService.listViewUpdate(context, {
      viewId,
      list: body,
      req,
    });
  }
}
