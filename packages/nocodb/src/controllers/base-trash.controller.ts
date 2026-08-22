import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NcContext, NcRequest } from '~/interface/config';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import { GlobalGuard } from '~/guards/global/global.guard';
import { MetaApiLimiterGuard } from '~/guards/meta-api-limiter.guard';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { RecordTrashService } from '~/services/record-trash.service';

@Controller()
@UseGuards(MetaApiLimiterGuard, GlobalGuard)
export class BaseTrashController {
  constructor(private readonly recordTrashService: RecordTrashService) {}

  @Get('/api/v2/meta/bases/:baseId/trash')
  @Acl('baseTrashList')
  async list(
    @TenantContext() context: NcContext,
    @Param('baseId') _baseId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.recordTrashService.listBaseTrash(context, { limit, offset });
  }

  @Post('/api/v2/meta/bases/:baseId/trash/:trashEntryId/restore')
  @Acl('baseTrashRestore')
  async restore(
    @TenantContext() context: NcContext,
    @Param('baseId') _baseId: string,
    @Param('trashEntryId') trashEntryId: string,
    @Req() req: NcRequest,
  ) {
    return this.recordTrashService.restoreBaseTrashEntry(context, {
      trashEntryId,
      req,
    });
  }

  @Delete('/api/v2/meta/bases/:baseId/trash')
  @Acl('baseTrashEmpty')
  async empty(
    @TenantContext() context: NcContext,
    @Param('baseId') _baseId: string,
  ) {
    return this.recordTrashService.emptyBaseTrash(context);
  }
}
