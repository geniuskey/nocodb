<script setup lang="ts">
const visible = ref(false)
const { base } = storeToRefs(useBase())
</script>

<template>
  <ProjectActionItem
    label="Automation workflows"
    subtext="Run durable actions from a manual trigger"
    data-testid="proj-view-btn__workflows"
    @click="visible = true"
  >
    <template #icon>
      <GeneralIcon icon="ncAutomation" class="!h-8 !w-8 !text-nc-content-purple-medium" />
    </template>
  </ProjectActionItem>

  <LazyDlgWorkflowManager v-if="base?.id" v-model:visible="visible" :base-id="base.id" />
</template>
