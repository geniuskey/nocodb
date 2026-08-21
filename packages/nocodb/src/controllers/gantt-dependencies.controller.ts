import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  GanttDependencyCreateReqType,
  GanttDependencyQueryReqType,
  GanttDependencyUpdateReqType,
} from 'nocodb-sdk';
import { NcContext } from '~/interface/config';
import { GlobalGuard } from '~/guards/global/global.guard';
import { MetaApiLimiterGuard } from '~/guards/meta-api-limiter.guard';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import { GanttDependenciesService } from '~/services/gantt-dependencies.service';

@Controller()
@UseGuards(MetaApiLimiterGuard, GlobalGuard)
export class GanttDependenciesController {
  constructor(
    private readonly ganttDependenciesService: GanttDependenciesService,
  ) {}

  @Post([
    '/api/v1/db/meta/gantts/:viewId/dependencies/query',
    '/api/v2/meta/gantts/:viewId/dependencies/query',
  ])
  @Acl('ganttViewGet')
  async dependencyQuery(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
    @Body() body: GanttDependencyQueryReqType,
  ) {
    return await this.ganttDependenciesService.dependencyQuery(context, {
      viewId,
      query: body,
    });
  }

  @Post([
    '/api/v1/db/meta/gantts/:viewId/dependencies',
    '/api/v2/meta/gantts/:viewId/dependencies',
  ])
  @Acl('ganttViewUpdate')
  async dependencyCreate(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
    @Body() body: GanttDependencyCreateReqType,
  ) {
    return await this.ganttDependenciesService.dependencyCreate(context, {
      viewId,
      dependency: body,
    });
  }

  @Patch([
    '/api/v1/db/meta/gantts/:viewId/dependencies/:dependencyId',
    '/api/v2/meta/gantts/:viewId/dependencies/:dependencyId',
  ])
  @Acl('ganttViewUpdate')
  async dependencyUpdate(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
    @Param('dependencyId') dependencyId: string,
    @Body() body: GanttDependencyUpdateReqType,
  ) {
    return await this.ganttDependenciesService.dependencyUpdate(context, {
      viewId,
      dependencyId,
      dependency: body,
    });
  }

  @Delete([
    '/api/v1/db/meta/gantts/:viewId/dependencies/:dependencyId',
    '/api/v2/meta/gantts/:viewId/dependencies/:dependencyId',
  ])
  @Acl('ganttViewUpdate')
  async dependencyDelete(
    @TenantContext() context: NcContext,
    @Param('viewId') viewId: string,
    @Param('dependencyId') dependencyId: string,
  ) {
    return await this.ganttDependenciesService.dependencyDelete(context, {
      viewId,
      dependencyId,
    });
  }
}
