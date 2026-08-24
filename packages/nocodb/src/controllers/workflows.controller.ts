import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
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
import { WorkflowsService } from '~/services/workflows.service';

@UseGuards(MetaApiLimiterGuard, GlobalGuard)
@Controller()
export class WorkflowsController {
  constructor(protected readonly workflowsService: WorkflowsService) {}

  @Acl('manageWorkflow')
  @Get('/api/v2/meta/bases/:baseId/workflows')
  list(
    @TenantContext() context: NcContext,
    @Query() query: { limit?: number; offset?: number },
  ) {
    return this.workflowsService.list(context, query);
  }

  @Acl('manageWorkflow')
  @Post('/api/v2/meta/bases/:baseId/workflows')
  create(
    @TenantContext() context: NcContext,
    @Body() body: Record<string, any>,
    @Req() req: NcRequest,
  ) {
    return this.workflowsService.create(context, { body, req });
  }

  @Acl('manageWorkflow')
  @Get('/api/v2/meta/bases/:baseId/workflows/:workflowId')
  get(
    @TenantContext() context: NcContext,
    @Param('workflowId') workflowId: string,
  ) {
    return this.workflowsService.get(context, workflowId);
  }

  @Acl('manageWorkflow')
  @Patch('/api/v2/meta/bases/:baseId/workflows/:workflowId')
  update(
    @TenantContext() context: NcContext,
    @Param('workflowId') workflowId: string,
    @Body() body: Record<string, any>,
    @Req() req: NcRequest,
  ) {
    return this.workflowsService.update(context, workflowId, { body, req });
  }

  @Acl('manageWorkflow')
  @Delete('/api/v2/meta/bases/:baseId/workflows/:workflowId')
  delete(
    @TenantContext() context: NcContext,
    @Param('workflowId') workflowId: string,
  ) {
    return this.workflowsService.delete(context, workflowId);
  }

  @Acl('manageWorkflow')
  @Post('/api/v2/meta/bases/:baseId/workflows/:workflowId/trigger')
  trigger(
    @TenantContext() context: NcContext,
    @Param('workflowId') workflowId: string,
    @Body() body: { inputs?: unknown; idempotency_key?: string },
    @Headers('idempotency-key') idempotencyHeader: string,
    @Req() req: NcRequest,
  ) {
    return this.workflowsService.trigger(context, workflowId, {
      inputs: body?.inputs,
      idempotencyKey: idempotencyHeader || body?.idempotency_key,
      req,
    });
  }

  @Acl('manageWorkflow')
  @Get('/api/v2/meta/bases/:baseId/workflows/:workflowId/executions')
  listExecutions(
    @TenantContext() context: NcContext,
    @Param('workflowId') workflowId: string,
    @Query() query: { limit?: number; offset?: number },
  ) {
    return this.workflowsService.listExecutions(context, workflowId, query);
  }

  @Acl('manageWorkflow')
  @Get(
    '/api/v2/meta/bases/:baseId/workflows/:workflowId/executions/:executionId',
  )
  getExecution(
    @TenantContext() context: NcContext,
    @Param('workflowId') workflowId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.workflowsService.getExecution(context, workflowId, executionId);
  }
}
