import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  RecordTrashCreateReqType,
  RecordTrashIdsReqType,
} from 'nocodb-sdk';
import type { NcContext, NcRequest } from '~/interface/config';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import { DataApiLimiterGuard } from '~/guards/data-api-limiter.guard';
import { GlobalGuard } from '~/guards/global/global.guard';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { RecordTrashService } from '~/services/record-trash.service';

@Controller()
@UseGuards(DataApiLimiterGuard, GlobalGuard)
export class RecordTrashController {
  constructor(private readonly recordTrashService: RecordTrashService) {}

  @Get('/api/v2/tables/:modelId/trash')
  @Acl('dataList')
  async list(
    @TenantContext() context: NcContext,
    @Param('modelId') modelId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return await this.recordTrashService.list(context, {
      modelId,
      limit,
      offset,
    });
  }

  @Post('/api/v2/tables/:modelId/trash')
  @Acl('dataDelete')
  async trash(
    @TenantContext() context: NcContext,
    @Param('modelId') modelId: string,
    @Body() body: RecordTrashCreateReqType,
    @Req() req: NcRequest,
  ) {
    return await this.recordTrashService.trash(context, {
      modelId,
      body,
      req,
    });
  }

  @Post('/api/v2/tables/:modelId/trash/restore')
  @Acl('dataInsert')
  async restore(
    @TenantContext() context: NcContext,
    @Param('modelId') modelId: string,
    @Body() body: RecordTrashIdsReqType,
    @Req() req: NcRequest,
  ) {
    return await this.recordTrashService.restore(context, {
      modelId,
      body,
      req,
    });
  }

  @Delete('/api/v2/tables/:modelId/trash')
  @Acl('dataDelete')
  async permanentlyDelete(
    @TenantContext() context: NcContext,
    @Param('modelId') modelId: string,
    @Body() body: RecordTrashIdsReqType,
  ) {
    return await this.recordTrashService.permanentlyDelete(context, {
      modelId,
      body,
    });
  }
}
