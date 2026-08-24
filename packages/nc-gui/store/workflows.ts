import type { CommunityWorkflowType } from 'nocodb-sdk'

export const useWorkflowStore = defineStore('workflow', () => {
  const { $api } = useNuxtApp()
  const { isUIAllowed } = useRoles()
  const workflows = ref(new Map<string, CommunityWorkflowType>())
  const isLoadingWorkflow = ref(false)

  const isWorkflowsEnabled = computed(() => isUIAllowed('manageWorkflow'))
  const activeBaseWorkflows = computed(() => Array.from(workflows.value.values()))
  const activeWorkflowId = computed(() => null)
  const activeWorkflow = computed(() => null)

  const loadWorkflows = async (baseId: string) => {
    isLoadingWorkflow.value = true
    try {
      const response = await $api.workflow.list(baseId, { limit: 100, offset: 0 })
      workflows.value = new Map((response.list || []).map((workflow) => [String(workflow.id), workflow]))
      return activeBaseWorkflows.value
    } finally {
      isLoadingWorkflow.value = false
    }
  }

  const loadWorkflow = async (baseId: string, workflowId: string) => {
    const workflow = await $api.workflow.read(baseId, workflowId)
    workflows.value.set(String(workflow.id), workflow)
    return workflow
  }

  const createWorkflow = async (baseId: string, data: { title: string; description?: string }) => {
    const workflow = await $api.workflow.create(baseId, data)
    workflows.value.set(String(workflow.id), workflow)
    return workflow
  }

  const updateWorkflow = async (baseId: string, workflowId: string, data: Record<string, any>) => {
    const workflow = await $api.workflow.update(baseId, workflowId, data)
    workflows.value.set(String(workflow.id), workflow)
    return workflow
  }

  const deleteWorkflow = async (baseId: string, workflowId: string) => {
    await $api.workflow.delete(baseId, workflowId)
    workflows.value.delete(workflowId)
  }

  const openWorkflow = async (baseId: string, workflowId: string) => loadWorkflow(baseId, workflowId)

  return {
    workflows,
    activeWorkflow,
    isLoadingWorkflow,
    isWorkflowsEnabled,
    activeBaseWorkflows,
    activeWorkflowId,
    loadWorkflows,
    loadWorkflow,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    openWorkflow,
  }
})
