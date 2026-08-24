<script setup lang="ts">
import dayjs from 'dayjs'
import type { CommunityWorkflowExecutionType, CommunityWorkflowType } from 'nocodb-sdk'

const props = defineProps<{ visible: boolean; baseId: string }>()
const emits = defineEmits(['update:visible'])
const dialogVisible = useVModel(props, 'visible', emits)
const { $api } = useNuxtApp()
const workflowStore = useWorkflowStore()
const { activeBaseWorkflows: workflows, isLoadingWorkflow: loading } = storeToRefs(workflowStore)

const creating = ref(false)
const saving = ref(false)
const running = ref(false)
const newTitle = ref('')
const selectedId = ref<string>()
const executions = ref<CommunityWorkflowExecutionType[]>([])
const executionLoading = ref(false)
const triggerInputs = ref('{}')
const form = reactive({
  title: '',
  description: '',
  enabled: false,
  actionType: 'action.log',
  message: 'Workflow started',
  method: 'POST',
  url: '',
  body: '',
  retryAttempts: 1,
  secretHeaderName: '',
  secretName: '',
})

const selected = computed(() => workflows.value.find((workflow) => String(workflow.id) === selectedId.value))

const loadExecutions = async () => {
  if (!selectedId.value) return
  executionLoading.value = true
  try {
    const response = await $api.workflow.executionList(props.baseId, selectedId.value, { limit: 20, offset: 0 })
    executions.value = response.list || []
  } catch (error) {
    message.error(`Unable to load executions: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    executionLoading.value = false
  }
}

const selectWorkflow = async (workflow: CommunityWorkflowType) => {
  selectedId.value = String(workflow.id)
  const action = workflow.nodes?.find((node) => node.type !== 'trigger.manual')
  form.title = workflow.title || ''
  form.description = workflow.description || ''
  form.enabled = Boolean(workflow.enabled)
  form.actionType = action?.type || 'action.log'
  form.message = String(action?.data.config?.message || 'Workflow started')
  form.method = String(action?.data.config?.method || 'POST')
  form.url = String(action?.data.config?.url || '')
  form.body =
    typeof action?.data.config?.body === 'string' ? action.data.config.body : JSON.stringify(action?.data.config?.body ?? '')
  form.retryAttempts = Number(action?.data.config?.retry_attempts || 1)
  form.secretHeaderName = String(action?.data.config?.secret_headers?.[0]?.name || '')
  form.secretName = String(action?.data.config?.secret_headers?.[0]?.secret || '')
  await loadExecutions()
}

const load = async () => {
  try {
    const list = await workflowStore.loadWorkflows(props.baseId)
    if (selectedId.value) {
      const current = list.find((workflow) => String(workflow.id) === selectedId.value)
      if (current) await selectWorkflow(current)
      else selectedId.value = undefined
    }
  } catch (error) {
    message.error(`Unable to load workflows: ${await extractSdkResponseErrorMsg(error)}`)
  }
}

const create = async () => {
  const title = newTitle.value.trim()
  if (!title || creating.value) return
  creating.value = true
  try {
    const workflow = await workflowStore.createWorkflow(props.baseId, { title })
    newTitle.value = ''
    await selectWorkflow(workflow)
    message.success('Workflow created')
  } catch (error) {
    message.error(`Unable to create workflow: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    creating.value = false
  }
}

const definition = () => {
  const trigger = {
    id: 'manual_trigger',
    type: 'trigger.manual' as const,
    data: { title: 'Manual trigger', config: {} },
  }
  const config =
    form.actionType === 'action.http'
      ? {
          method: form.method,
          url: form.url.trim(),
          body: form.body,
          retry_attempts: form.retryAttempts,
          ...(form.secretHeaderName.trim() && form.secretName.trim()
            ? { secret_headers: [{ name: form.secretHeaderName.trim(), secret: form.secretName.trim().toUpperCase() }] }
            : {}),
        }
      : { message: form.message }
  const action = {
    id: 'primary_action',
    type: form.actionType as 'action.log' | 'action.http',
    data: { title: form.actionType === 'action.http' ? 'HTTP request' : 'Log message', config },
  }
  return {
    nodes: [trigger, action],
    edges: [{ id: 'manual_trigger_to_primary_action', source: trigger.id, target: action.id }],
  }
}

const save = async () => {
  if (!selectedId.value || saving.value) return
  saving.value = true
  try {
    const workflow = await workflowStore.updateWorkflow(props.baseId, selectedId.value, {
      title: form.title,
      description: form.description,
      enabled: form.enabled,
      ...definition(),
    })
    await selectWorkflow(workflow)
    message.success('Workflow saved')
  } catch (error) {
    message.error(`Unable to save workflow: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    saving.value = false
  }
}

const run = async () => {
  if (!selectedId.value || running.value) return
  let inputs: Record<string, any>
  try {
    inputs = JSON.parse(triggerInputs.value || '{}')
  } catch {
    message.error('Trigger input must be valid JSON')
    return
  }
  running.value = true
  try {
    const result = await $api.workflow.trigger(props.baseId, selectedId.value, {
      inputs,
      idempotency_key: crypto.randomUUID(),
    })
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const execution = await $api.workflow.executionRead(props.baseId, selectedId.value, result.execution_id)
      if (execution.finished) {
        await loadExecutions()
        if (execution.status === 'success') message.success('Workflow completed')
        else message.error(execution.error || 'Workflow failed')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    message.warning('Workflow is still running; refresh execution history for status')
    await loadExecutions()
  } catch (error) {
    message.error(`Unable to run workflow: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    running.value = false
  }
}

const remove = () => {
  if (!selected.value?.id) return
  Modal.confirm({
    title: `Delete “${selected.value.title}”?`,
    content: 'Execution history for this workflow will also be removed. This cannot be undone.',
    okText: 'Delete workflow',
    okType: 'danger',
    onOk: async () => {
      try {
        await workflowStore.deleteWorkflow(props.baseId, String(selected.value!.id))
        selectedId.value = undefined
        executions.value = []
        message.success('Workflow deleted')
      } catch (error) {
        message.error(`Unable to delete workflow: ${await extractSdkResponseErrorMsg(error)}`)
      }
    },
  })
}

watch(
  [() => dialogVisible.value, () => props.baseId],
  async ([visible]) => {
    if (visible) await load()
  },
  { immediate: true },
)
</script>

<template>
  <NcModal v-model:visible="dialogVisible" size="large" :show-separator="true" wrap-class-name="nc-workflow-manager-modal">
    <template #header>
      <div class="flex w-full items-center justify-between gap-3 p-1">
        <div>
          <div class="text-lg font-semibold text-nc-content-gray-emphasis">Automation workflows</div>
          <div class="text-xs text-nc-content-gray-muted">Manual triggers with durable log or HTTP actions</div>
        </div>
        <NcButton type="text" size="small" aria-label="Close workflows" @click="dialogVisible = false">
          <GeneralIcon icon="close" />
        </NcButton>
      </div>
    </template>

    <div class="grid min-h-120 grid-cols-[240px_minmax(0,1fr)] gap-4" data-testid="nc-workflow-manager">
      <div class="flex flex-col gap-3 border-r border-nc-border-gray-medium pr-4">
        <div class="flex gap-2">
          <a-input
            v-model:value="newTitle"
            data-testid="nc-workflow-new-title"
            placeholder="Workflow name"
            @press-enter="create"
          />
          <NcButton type="primary" size="small" :loading="creating" data-testid="nc-workflow-create" @click="create">
            Add
          </NcButton>
        </div>
        <div v-if="loading" class="flex flex-1 items-center justify-center"><GeneralLoader /></div>
        <div v-else-if="!workflows.length" class="p-4 text-center text-sm text-nc-content-gray-muted">No workflows yet.</div>
        <button
          v-for="workflow of workflows"
          v-else
          :key="String(workflow.id)"
          type="button"
          class="rounded-lg border p-3 text-left"
          :class="
            selectedId === String(workflow.id) ? 'border-nc-border-brand bg-nc-bg-brand-light' : 'border-nc-border-gray-medium'
          "
          :data-testid="`nc-workflow-row-${workflow.id}`"
          @click="selectWorkflow(workflow)"
        >
          <div class="truncate font-medium text-nc-content-gray-emphasis">{{ workflow.title }}</div>
          <div class="mt-1 text-xs text-nc-content-gray-muted">
            {{ workflow.enabled ? 'Enabled' : 'Disabled' }} · {{ workflow.trigger_count || 0 }} runs
          </div>
        </button>
      </div>

      <div v-if="selected" class="min-w-0 overflow-y-auto pr-1">
        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <div class="mb-1 text-xs font-medium">Name</div>
            <a-input v-model:value="form.title" />
          </div>
          <div class="col-span-2">
            <div class="mb-1 text-xs font-medium">Description</div>
            <a-textarea v-model:value="form.description" :rows="2" />
          </div>
          <div class="col-span-2 flex items-center gap-2">
            <a-switch v-model:checked="form.enabled" data-testid="nc-workflow-enabled" /><span class="text-sm">Enabled</span>
          </div>
          <div class="col-span-2">
            <div class="mb-1 text-xs font-medium">Action</div>
            <a-select v-model:value="form.actionType" class="w-full">
              <a-select-option value="action.log">Log message</a-select-option>
              <a-select-option value="action.http">HTTP request</a-select-option>
            </a-select>
          </div>
          <div v-if="form.actionType === 'action.log'" class="col-span-2">
            <div class="mb-1 text-xs font-medium">Message</div>
            <a-textarea v-model:value="form.message" :rows="3" data-testid="nc-workflow-log-message" />
          </div>
          <template v-else>
            <div>
              <div class="mb-1 text-xs font-medium">Method</div>
              <a-select v-model:value="form.method" class="w-full">
                <a-select-option
                  v-for="method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']"
                  :key="method"
                  :value="method"
                >
                  {{ method }}
                </a-select-option>
              </a-select>
            </div>
            <div>
              <div class="mb-1 text-xs font-medium">Retry attempts</div>
              <a-input-number v-model:value="form.retryAttempts" :min="1" :max="3" class="w-full" />
            </div>
            <div class="col-span-2">
              <div class="mb-1 text-xs font-medium">URL</div>
              <a-input v-model:value="form.url" data-testid="nc-workflow-http-url" placeholder="https://example.com/webhook" />
            </div>
            <div class="col-span-2">
              <div class="mb-1 text-xs font-medium">Body template</div>
              <a-textarea v-model:value="form.body" :rows="3" placeholder='{"value":"{{ trigger.value }}"}' />
            </div>
            <div>
              <div class="mb-1 text-xs font-medium">Secret header</div>
              <a-input v-model:value="form.secretHeaderName" placeholder="Authorization" />
            </div>
            <div>
              <div class="mb-1 text-xs font-medium">Environment secret name</div>
              <a-input v-model:value="form.secretName" placeholder="API_TOKEN" />
            </div>
            <div class="col-span-2 text-xs text-nc-content-gray-muted">
              Secret values are read only from NC_WORKFLOW_SECRET_&lt;NAME&gt; and are never stored in definitions or logs.
            </div>
          </template>
        </div>

        <div class="mt-4 flex justify-between border-t border-nc-border-gray-medium pt-4">
          <NcButton type="danger" size="small" @click="remove">Delete</NcButton>
          <NcButton type="primary" size="small" :loading="saving" data-testid="nc-workflow-save" @click="save">
            Save workflow
          </NcButton>
        </div>

        <div class="mt-5 border-t border-nc-border-gray-medium pt-4">
          <div class="flex items-end gap-2">
            <div class="flex-1">
              <div class="mb-1 text-xs font-medium">Manual trigger input (JSON)</div>
              <a-textarea v-model:value="triggerInputs" :rows="2" data-testid="nc-workflow-trigger-input" />
            </div>
            <NcButton
              type="secondary"
              :loading="running"
              :disabled="!selected.enabled"
              data-testid="nc-workflow-run"
              @click="run"
            >
              Run
            </NcButton>
          </div>
          <div class="mt-4 flex items-center justify-between">
            <div class="font-medium">Execution history</div>
            <NcButton type="text" size="small" :loading="executionLoading" @click="loadExecutions"
              ><GeneralIcon icon="reload"
            /></NcButton>
          </div>
          <div
            v-if="!executions.length"
            class="mt-2 rounded border border-nc-border-gray-medium p-4 text-center text-sm text-nc-content-gray-muted"
          >
            No executions yet.
          </div>
          <div v-else class="mt-2 divide-y divide-nc-border-gray-medium rounded border border-nc-border-gray-medium">
            <div
              v-for="execution of executions"
              :key="String(execution.id)"
              class="flex items-center justify-between gap-3 p-3"
              :data-testid="`nc-workflow-execution-${execution.id}`"
            >
              <div>
                <div class="text-sm font-medium">{{ execution.status }}</div>
                <div class="text-xs text-nc-content-gray-muted">
                  {{ dayjs(execution.created_at).format('D MMM YYYY, HH:mm:ss') }}
                </div>
              </div>
              <div v-if="execution.error" class="max-w-80 truncate text-xs text-nc-content-red-medium">{{ execution.error }}</div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="flex items-center justify-center text-sm text-nc-content-gray-muted">Select or create a workflow.</div>
    </div>
  </NcModal>
</template>
