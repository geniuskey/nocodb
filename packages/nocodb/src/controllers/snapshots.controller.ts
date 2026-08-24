import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import { GlobalGuard } from '~/guards/global/global.guard';
import { MetaApiLimiterGuard } from '~/guards/meta-api-limiter.guard';
import type { NcContext, NcRequest } from '~/interface/config';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { SnapshotsService } from '~/services/snapshots.service';

@UseGuards(MetaApiLimiterGuard, GlobalGuard)
@Controller()
export class SnapshotsController {
  constructor(protected readonly snapshotsService: SnapshotsService) {}

  @Acl('manageSnapshot')
  @Get('/api/v2/meta/bases/:baseId/snapshots')
  list(
    @TenantContext() context: NcContext,
    @Query() query: { limit?: number; offset?: number },
  ) {
    return this.snapshotsService.list(context, query);
  }

  @Acl('manageSnapshot')
  @Post('/api/v2/meta/bases/:baseId/snapshots')
  @HttpCode(200)
  create(
    @TenantContext() context: NcContext,
    @Body() body: { title?: string },
    @Req() req: NcRequest,
  ) {
    return this.snapshotsService.create(context, { title: body?.title, req });
  }

  @Acl('manageSnapshot')
  @Post('/api/v2/meta/bases/:baseId/snapshots/:snapshotId/restore')
  @HttpCode(200)
  restore(
    @TenantContext() context: NcContext,
    @Param('snapshotId') snapshotId: string,
    @Body() body: { title?: string; target_workspace_id?: string },
    @Req() req: NcRequest,
  ) {
    return this.snapshotsService.restore(context, {
      snapshotId,
      title: body?.title,
      targetWorkspaceId: body?.target_workspace_id,
      req,
    });
  }

  @Acl('manageSnapshot')
  @Delete('/api/v2/meta/bases/:baseId/snapshots/:snapshotId')
  delete(
    @TenantContext() context: NcContext,
    @Param('snapshotId') snapshotId: string,
  ) {
    return this.snapshotsService.delete(context, snapshotId);
  }
}
