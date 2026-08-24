import { WorkflowTriggerHandlerService } from './workflow-trigger-handler.service';

describe('WorkflowTriggerHandlerService', () => {
  it('forwards committed insert events and ignores other data hooks', async () => {
    let listener!: (arg: any) => Promise<void>;
    const unsubscribe = jest.fn();
    const eventEmitter = {
      emit: jest.fn(),
      on: jest.fn((_event, callback) => {
        listener = callback;
        return unsubscribe;
      }),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    const workflowsService = { triggerRecordCreated: jest.fn() };
    const service = new WorkflowTriggerHandlerService(
      eventEmitter,
      workflowsService as any,
    );

    service.onModuleInit();
    await listener({
      context: { workspace_id: 'w1', base_id: 'b1', cache: true },
      hookName: 'after.insert',
      modelId: 'm1',
      newData: { Id: 1 },
    });
    await listener({
      context: { workspace_id: 'w1', base_id: 'b1' },
      hookName: 'after.update',
      modelId: 'm1',
      newData: { Id: 1 },
    });

    expect(workflowsService.triggerRecordCreated).toHaveBeenCalledTimes(1);
    expect(workflowsService.triggerRecordCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 'w1',
        base_id: 'b1',
        cache: false,
        cacheMap: undefined,
      }),
      expect.objectContaining({
        hookName: 'after.insert',
        modelId: 'm1',
        newData: { Id: 1 },
      }),
    );

    service.onModuleDestroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
