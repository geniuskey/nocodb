import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { NcContext } from '~/interface/config';
import { IEventEmitter } from '~/modules/event-emitter/event-emitter.interface';
import { HANDLE_WEBHOOK } from '~/services/hook-handler.service';
import { WorkflowsService } from '~/services/workflows.service';

@Injectable()
export class WorkflowTriggerHandlerService
  implements OnModuleInit, OnModuleDestroy
{
  protected readonly logger = new Logger(WorkflowTriggerHandlerService.name);
  protected unsubscribe: () => void;

  constructor(
    @Inject('IEventEmitter') protected readonly eventEmitter: IEventEmitter,
    protected readonly workflowsService: WorkflowsService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.eventEmitter.on(HANDLE_WEBHOOK, async (arg) => {
      if (!['after.insert', 'after.bulkInsert'].includes(arg?.hookName)) return;
      try {
        const { context, ...event } = arg;
        await this.workflowsService.triggerRecordCreated(
          {
            ...context,
            cache: false,
            cacheMap: undefined,
          } as NcContext,
          event,
        );
      } catch (error) {
        this.logger.error({
          error,
          details: 'Error while handling a record-created workflow trigger',
        });
      }
    });
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }
}
