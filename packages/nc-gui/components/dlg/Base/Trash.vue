<script lang="ts" setup>
import dayjs from 'dayjs'
import type {
  BaseTrashEntryType,
  PaginatedType,
  RecordTrashConflictAnalysisType,
  RecordTrashRestoreModeReqType,
} from 'nocodb-sdk'

type BaseTrashItem = BaseTrashEntryType & {
  parent_id?: string
  view_type?: number
}

const props = defineProps<{
  visible: boolean
  baseId: string
  canRestoreRecords: boolean
  canRestoreStructure: boolean
  canEmpty: boolean
}>()

const emits = defineEmits(['update:visible'])

const dialogVisible = useVModel(props, 'visible', emits)
const { $api } = useNuxtApp()
const viewsStore = useViewsStore()
const { loadTables } = useBase()
const { refreshCommandPalette } = useCommandPalette()

const entries = ref<BaseTrashItem[]>([])
const pageInfo = ref<PaginatedType>()
const currentPage = ref(1)
const pageSize = 25
const loading = ref(false)
const restoringId = ref<string>()
const emptying = ref(false)
const conflictState = ref<{ entry: BaseTrashItem; analysis: RecordTrashConflictAnalysisType }>()

const totalRows = computed(() => Number(pageInfo.value?.totalRows ?? 0))
const formatTimestamp = (value: string) => dayjs(value).format('D MMM YYYY, HH:mm')
const isExpired = (entry: BaseTrashItem) => dayjs(entry.expires_at).valueOf() <= Date.now()

const canRestore = (entry: BaseTrashItem) =>
  !isExpired(entry) && (entry.resource_type === 'records' ? props.canRestoreRecords : props.canRestoreStructure)

const recordPreview = (entry: BaseTrashItem) =>
  (entry.records || [])
    .map((record) => {
      const primaryKeys = new Set(Object.keys(record.pk_data || {}))
      const value = Object.entries(record.row_data || {}).find(
        ([key, candidate]) => !primaryKeys.has(key) && candidate !== null && candidate !== undefined && candidate !== '',
      )?.[1]
      return value === undefined ? `Record ${record.record_id}` : String(value)
    })
    .slice(0, 3)
    .join(' · ')

const loadTrash = async (page = currentPage.value) => {
  if (!props.baseId || !dialogVisible.value) return

  loading.value = true
  try {
    currentPage.value = page
    const response = await $api.dbBaseTrash.list(props.baseId, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    })
    entries.value = (response.list || []) as BaseTrashItem[]
    pageInfo.value = response.pageInfo
  } catch (error) {
    entries.value = []
    pageInfo.value = undefined
    message.error(`Unable to load Base Trash: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    loading.value = false
  }
}

type RestoreMode = NonNullable<RecordTrashRestoreModeReqType['mode']>

const performRestore = async (entry: BaseTrashItem, mode: RestoreMode) => {
  const response = await $api.dbBaseTrash.restore(props.baseId, entry.id!, { mode })
  conflictState.value = undefined
  if (entry.resource_type === 'table') {
    await loadTables()
    refreshCommandPalette()
    message.success(`Table “${entry.resource_name || 'Untitled'}” restored`)
  } else if (entry.resource_type === 'view') {
    const tableId = response.parent_id || entry.parent_id
    if (tableId) {
      await viewsStore.loadViews({ tableId, force: true, ignoreLoading: true })
    }
    refreshCommandPalette()
    message.success(`View “${entry.resource_name || 'Untitled'}” restored`)
  } else if (response.skipped) {
    message.warning(
      `${response.restored} record${response.restored === 1 ? '' : 's'} restored; ${response.skipped} remain in Trash`,
    )
  } else {
    message.success(`${response.restored} record${response.restored === 1 ? '' : 's'} restored`)
  }
  await loadTrash(entries.value.length === 1 && currentPage.value > 1 ? currentPage.value - 1 : currentPage.value)
}

const restore = async (entry: BaseTrashItem) => {
  if (!entry.id || !canRestore(entry)) return

  restoringId.value = String(entry.id)
  try {
    if (entry.resource_type === 'records') {
      const analysis = await $api.dbBaseTrash.conflictList(props.baseId, entry.id)
      if (analysis.conflicted) {
        conflictState.value = { entry, analysis }
        return
      }
    }
    await performRestore(entry, 'strict')
  } catch (error) {
    message.error(`Unable to restore entry: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    restoringId.value = undefined
  }
}

const restoreConflicts = async (mode: RestoreMode) => {
  if (!conflictState.value) return
  const entry = conflictState.value.entry
  restoringId.value = String(entry.id)
  try {
    await performRestore(entry, mode)
  } catch (error) {
    message.error(`Unable to restore entry: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    restoringId.value = undefined
  }
}

const emptyTrash = async () => {
  if (!props.canEmpty || !props.baseId) return

  emptying.value = true
  try {
    await $api.dbBaseTrash.empty(props.baseId)
    message.success('Base Trash emptied permanently')
    await loadTrash(1)
  } catch (error) {
    message.error(`Unable to empty Base Trash: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    emptying.value = false
  }
}

const confirmEmpty = () => {
  if (!props.canEmpty || !entries.value.length) return

  Modal.confirm({
    title: 'Empty Base Trash permanently?',
    content: 'Every trashed item in this base will be deleted. This cannot be undone.',
    okText: 'Empty Trash',
    okType: 'danger',
    cancelText: 'Cancel',
    onOk: emptyTrash,
  })
}

watch(
  [() => dialogVisible.value, () => props.baseId],
  async ([visible]) => {
    if (visible) await loadTrash(1)
  },
  { immediate: true },
)
</script>

<template>
  <NcModal v-model:visible="dialogVisible" size="large" :show-separator="true" wrap-class-name="nc-base-trash-modal">
    <template #header>
      <div class="flex w-full items-center justify-between gap-3 p-1">
        <div class="min-w-0">
          <div class="truncate text-lg font-semibold text-nc-content-gray-emphasis">Base Trash</div>
          <div class="text-xs font-normal text-nc-content-gray-muted">
            Deleted records, views, and tables remain available for 30 days.
          </div>
        </div>
        <div class="flex items-center gap-2">
          <NcButton
            v-if="canEmpty"
            type="danger"
            size="small"
            :disabled="!entries.length"
            :loading="emptying"
            data-testid="nc-base-trash-empty"
            @click="confirmEmpty"
          >
            Empty Trash
          </NcButton>
          <NcButton
            type="text"
            size="small"
            :loading="loading"
            data-testid="nc-base-trash-refresh"
            aria-label="Refresh Base Trash"
            @click="loadTrash()"
          >
            <GeneralIcon icon="reload" />
          </NcButton>
          <NcButton
            type="text"
            size="small"
            data-testid="nc-base-trash-close"
            aria-label="Close Base Trash"
            @click="dialogVisible = false"
          >
            <GeneralIcon icon="close" />
          </NcButton>
        </div>
      </div>
    </template>

    <DlgRecordTrashConflict
      v-if="conflictState"
      :analysis="conflictState.analysis"
      :loading="Boolean(restoringId)"
      @cancel="conflictState = undefined"
      @restore="restoreConflicts"
    />

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3" data-testid="nc-base-trash-dialog">
      <div class="text-sm text-nc-content-gray-subtle">{{ totalRows }} trashed {{ totalRows === 1 ? 'item' : 'items' }}</div>

      <div class="min-h-72 flex-1 overflow-y-auto rounded-lg border border-nc-border-gray-medium">
        <div v-if="loading" class="flex h-72 items-center justify-center">
          <GeneralLoader size="large" />
        </div>
        <div
          v-else-if="!entries.length"
          class="flex h-72 flex-col items-center justify-center gap-2 text-center text-nc-content-gray-muted"
          data-testid="nc-base-trash-empty-state"
        >
          <MdiHistory class="h-8 w-8" />
          <div class="font-medium text-nc-content-gray-subtle">Base Trash is empty</div>
          <div class="text-xs">Deleted records, views, and tables will appear here.</div>
        </div>
        <div v-else class="divide-y divide-nc-border-gray-medium">
          <div
            v-for="entry of entries"
            :key="String(entry.id)"
            class="flex items-start gap-3 p-4"
            :data-testid="`nc-base-trash-entry-${entry.id}`"
          >
            <div class="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded bg-nc-bg-gray-light">
              <GeneralViewIcon v-if="entry.resource_type === 'view'" :meta="{ type: entry.view_type }" class="h-4 w-4" />
              <GeneralIcon v-else icon="table" class="h-4 w-4" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-nc-content-gray-emphasis">
                  {{
                    entry.resource_type === 'view'
                      ? 'View'
                      : entry.resource_type === 'table'
                      ? 'Table'
                      : `${entry.record_count} records`
                  }}
                </span>
                <span class="truncate text-sm text-nc-content-gray-subtle">{{ entry.resource_name }}</span>
                <span v-if="isExpired(entry)" class="rounded bg-nc-bg-red-light px-1.5 py-0.5 text-xs text-nc-content-red-medium">
                  Expired
                </span>
              </div>
              <div v-if="entry.resource_type === 'records'" class="mt-1 truncate text-sm text-nc-content-gray-subtle">
                {{ recordPreview(entry) || 'No record preview available' }}
              </div>
              <div class="mt-1 text-xs text-nc-content-gray-muted">
                Deleted {{ formatTimestamp(entry.deleted_at) }} · Expires {{ formatTimestamp(entry.expires_at) }}
              </div>
            </div>
            <NcButton
              v-if="entry.resource_type === 'records' ? canRestoreRecords : canRestoreStructure"
              type="secondary"
              size="small"
              :disabled="!canRestore(entry)"
              :loading="restoringId === String(entry.id)"
              :data-testid="`nc-base-trash-restore-${entry.id}`"
              @click="restore(entry)"
            >
              Restore
            </NcButton>
          </div>
        </div>
      </div>

      <div v-if="totalRows > pageSize" class="flex justify-end">
        <a-pagination
          v-model:current="currentPage"
          :page-size="pageSize"
          :total="totalRows"
          :show-size-changer="false"
          size="small"
          @change="loadTrash"
        />
      </div>
    </div>
  </NcModal>
</template>
