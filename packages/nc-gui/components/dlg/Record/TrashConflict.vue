<script lang="ts" setup>
import type { RecordTrashConflictAnalysisType, RecordTrashRestoreModeReqType } from 'nocodb-sdk'

const props = defineProps<{
  analysis: RecordTrashConflictAnalysisType
  loading?: boolean
}>()

const emits = defineEmits<{
  cancel: []
  restore: [mode: NonNullable<RecordTrashRestoreModeReqType['mode']>]
}>()

const displayedIssues = computed(() => props.analysis.conflicts.reduce((count, conflict) => count + conflict.issues.length, 0))
</script>

<template>
  <div class="flex min-h-72 flex-1 flex-col gap-4" data-testid="nc-record-trash-conflicts">
    <div class="rounded-lg border border-nc-border-gray-medium bg-nc-bg-orange-light p-4">
      <div class="font-semibold text-nc-content-gray-emphasis">Some records cannot be restored unchanged</div>
      <div class="mt-1 text-sm text-nc-content-gray-subtle">
        {{ analysis.conflicted }} of {{ analysis.total }} records have {{ displayedIssues }} detected
        {{ displayedIssues === 1 ? 'conflict' : 'conflicts' }}.
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-nc-border-gray-medium">
      <div
        v-for="conflict of analysis.conflicts"
        :key="String(conflict.trash_id)"
        class="border-b border-nc-border-gray-medium p-4 last:border-b-0"
      >
        <div class="font-medium text-nc-content-gray-emphasis">Record {{ conflict.record_id }}</div>
        <div class="mt-2 flex flex-col gap-2">
          <div
            v-for="issue of conflict.issues"
            :key="`${issue.type}-${issue.column_id || ''}`"
            class="flex items-start justify-between gap-3 text-sm"
          >
            <div class="min-w-0">
              <span v-if="issue.field" class="font-medium text-nc-content-gray-emphasis">{{ issue.field }}: </span>
              <span class="text-nc-content-gray-subtle">{{ issue.message }}</span>
            </div>
            <span
              class="flex-none rounded px-1.5 py-0.5 text-xs"
              :class="
                issue.clearable
                  ? 'bg-nc-bg-orange-light text-nc-content-orange-medium'
                  : 'bg-nc-bg-red-light text-nc-content-red-medium'
              "
            >
              {{ issue.clearable ? 'Will be cleared' : 'Cannot force' }}
            </span>
          </div>
        </div>
      </div>
      <div v-if="analysis.truncated" class="p-3 text-center text-xs text-nc-content-gray-muted">
        Only the first 100 conflicting records are shown.
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="max-w-xl text-xs text-nc-content-gray-muted">
        Restore anyway clears conflicting optional fields. Records with a primary-key or required-field conflict remain in Trash.
      </div>
      <div class="flex items-center gap-2">
        <NcButton
          type="secondary"
          size="small"
          :disabled="loading"
          data-testid="nc-record-trash-conflict-cancel"
          @click="emits('cancel')"
        >
          Cancel
        </NcButton>
        <NcButton
          type="secondary"
          size="small"
          :disabled="loading || analysis.clean === 0"
          :loading="loading"
          data-testid="nc-record-trash-restore-clean"
          @click="emits('restore', 'clean')"
        >
          Restore clean ones ({{ analysis.clean }})
        </NcButton>
        <NcButton
          type="primary"
          size="small"
          :disabled="loading"
          :loading="loading"
          data-testid="nc-record-trash-restore-force"
          @click="emits('restore', 'force')"
        >
          Restore anyway
        </NcButton>
      </div>
    </div>
  </div>
</template>
