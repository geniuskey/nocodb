<script lang="ts" setup>
import dayjs from 'dayjs'
import type { PaginatedType, RecordTrashType, TableType } from 'nocodb-sdk'

const props = defineProps<{
  visible: boolean
  table: TableType
  canRestore: boolean
  canPermanentlyDelete: boolean
}>()

const emits = defineEmits(['update:visible'])

const dialogVisible = useVModel(props, 'visible', emits)
const { $api } = useNuxtApp()

const records = ref<RecordTrashType[]>([])
const pageInfo = ref<PaginatedType>()
const currentPage = ref(1)
const pageSize = 25
const selectedIds = ref<string[]>([])
const loading = ref(false)
const action = ref<{ type: 'restore' | 'delete'; ids: string[] }>()

const isExpired = (record: RecordTrashType) => dayjs(record.expires_at).valueOf() <= Date.now()

const totalRows = computed(() => Number(pageInfo.value?.totalRows ?? 0))
const selectedRecords = computed(() => records.value.filter((record) => selectedIds.value.includes(String(record.id))))
const restorableSelectedIds = computed(() =>
  selectedRecords.value.filter((record) => !isExpired(record)).map((record) => String(record.id)),
)
const allSelected = computed(() => records.value.length > 0 && selectedIds.value.length === records.value.length)

const formatTimestamp = (value: string) => dayjs(value).format('D MMM YYYY, HH:mm')

const formatPreviewValue = (value: unknown) => {
  const formatted = typeof value === 'string' ? value : JSON.stringify(value)
  if (!formatted) return ''
  return formatted.length > 80 ? `${formatted.slice(0, 77)}...` : formatted
}

const recordPreview = (record: RecordTrashType) => {
  const primaryKeys = new Set(Object.keys(record.pk_data || {}))
  const values = Object.entries(record.row_data || {})
    .filter(([key, value]) => !primaryKeys.has(key) && value !== null && value !== undefined && value !== '')
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${formatPreviewValue(value)}`)

  return values.join(' · ') || 'No record preview available'
}

const loadTrash = async (page = currentPage.value) => {
  if (!props.table.id || !dialogVisible.value) return

  loading.value = true
  try {
    currentPage.value = page
    const response = await $api.dbRecordTrash.list(props.table.id, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    })
    records.value = response.list || []
    pageInfo.value = response.pageInfo
    selectedIds.value = []
  } catch (error) {
    records.value = []
    pageInfo.value = undefined
    message.error(`Unable to load trash: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    loading.value = false
  }
}

const setSelected = (record: RecordTrashType, checked: boolean) => {
  const id = String(record.id)
  selectedIds.value = checked ? [...selectedIds.value, id] : selectedIds.value.filter((selectedId) => selectedId !== id)
}

const setAllSelected = (checked: boolean) => {
  selectedIds.value = checked ? records.value.map((record) => String(record.id)) : []
}

const restore = async (ids: string[]) => {
  if (!props.table.id || !ids.length || !props.canRestore) return

  action.value = { type: 'restore', ids }
  try {
    const response = await $api.dbRecordTrash.restore(props.table.id, { trash_ids: ids })
    message.success(`${response.restored} record${response.restored === 1 ? '' : 's'} restored`)
    await loadTrash(records.value.length === ids.length && currentPage.value > 1 ? currentPage.value - 1 : currentPage.value)
  } catch (error) {
    message.error(`Unable to restore records: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    action.value = undefined
  }
}

const permanentlyDelete = async (ids: string[]) => {
  if (!props.table.id || !ids.length || !props.canPermanentlyDelete) return

  action.value = { type: 'delete', ids }
  try {
    const response = await $api.dbRecordTrash.delete(props.table.id, { trash_ids: ids })
    message.success(`${response.deleted} trash snapshot${response.deleted === 1 ? '' : 's'} permanently deleted`)
    await loadTrash(records.value.length === ids.length && currentPage.value > 1 ? currentPage.value - 1 : currentPage.value)
  } catch (error) {
    message.error(`Unable to permanently delete records: ${await extractSdkResponseErrorMsg(error)}`)
  } finally {
    action.value = undefined
  }
}

const confirmPermanentDelete = (ids: string[]) => {
  if (!ids.length || !props.canPermanentlyDelete) return

  Modal.confirm({
    title: `Permanently delete ${ids.length} trash snapshot${ids.length === 1 ? '' : 's'}?`,
    content: 'This cannot be undone.',
    okText: 'Delete permanently',
    okType: 'danger',
    cancelText: 'Cancel',
    onOk: () => permanentlyDelete(ids),
  })
}

const isActionLoading = (type: 'restore' | 'delete', id?: string) =>
  action.value?.type === type && (!id || action.value.ids.includes(id))

watch(
  [() => dialogVisible.value, () => props.table.id],
  async ([visible]) => {
    if (visible) await loadTrash(1)
  },
  { immediate: true },
)
</script>

<template>
  <NcModal v-model:visible="dialogVisible" size="large" :show-separator="true" wrap-class-name="nc-record-trash-modal">
    <template #header>
      <div class="flex w-full items-center justify-between gap-3 p-1">
        <div class="min-w-0">
          <div class="truncate text-lg font-semibold text-nc-content-gray-emphasis">Trash · {{ table.title }}</div>
          <div class="text-xs font-normal text-nc-content-gray-muted">Records are available for 30 days after deletion.</div>
        </div>
        <div class="flex items-center gap-2">
          <NcButton
            type="text"
            size="small"
            :loading="loading"
            data-testid="nc-record-trash-refresh"
            aria-label="Refresh trash"
            @click="loadTrash()"
          >
            <GeneralIcon icon="reload" />
          </NcButton>
          <NcButton
            type="text"
            size="small"
            data-testid="nc-record-trash-close"
            aria-label="Close trash"
            @click="dialogVisible = false"
          >
            <GeneralIcon icon="close" />
          </NcButton>
        </div>
      </div>
    </template>

    <div class="flex min-h-0 flex-1 flex-col gap-3" data-testid="nc-record-trash-dialog">
      <div class="flex min-h-8 items-center justify-between gap-3">
        <div class="flex items-center gap-2 text-sm text-nc-content-gray-subtle">
          <a-checkbox
            :checked="allSelected"
            :indeterminate="selectedIds.length > 0 && !allSelected"
            :disabled="!records.length"
            aria-label="Select all trash records on this page"
            data-testid="nc-record-trash-select-all"
            @change="setAllSelected($event.target.checked)"
          />
          <span>{{ selectedIds.length ? `${selectedIds.length} selected` : `${totalRows} trashed records` }}</span>
        </div>
        <div v-if="selectedIds.length" class="flex items-center gap-2">
          <NcButton
            v-if="canRestore"
            type="secondary"
            size="small"
            :disabled="!restorableSelectedIds.length"
            :loading="isActionLoading('restore')"
            data-testid="nc-record-trash-restore-selected"
            @click="restore(restorableSelectedIds)"
          >
            Restore
          </NcButton>
          <NcButton
            v-if="canPermanentlyDelete"
            type="danger"
            size="small"
            :loading="isActionLoading('delete')"
            data-testid="nc-record-trash-delete-selected"
            @click="confirmPermanentDelete(selectedIds)"
          >
            Delete permanently
          </NcButton>
        </div>
      </div>

      <div class="min-h-72 flex-1 overflow-y-auto rounded-lg border border-nc-border-gray-medium">
        <div v-if="loading" class="flex h-72 items-center justify-center">
          <GeneralLoader size="large" />
        </div>
        <div
          v-else-if="!records.length"
          class="flex h-72 flex-col items-center justify-center gap-2 text-center text-nc-content-gray-muted"
          data-testid="nc-record-trash-empty"
        >
          <GeneralIcon icon="delete" class="h-8 w-8" />
          <div class="font-medium text-nc-content-gray-subtle">Trash is empty</div>
          <div class="text-xs">Deleted records for this table will appear here.</div>
        </div>
        <div v-else class="divide-y divide-nc-border-gray-medium">
          <div
            v-for="record of records"
            :key="String(record.id)"
            class="flex items-start gap-3 p-4"
            :data-testid="`nc-record-trash-row-${record.id}`"
          >
            <a-checkbox
              class="mt-1"
              :checked="selectedIds.includes(String(record.id))"
              :aria-label="`Select trashed record ${record.record_id}`"
              @change="setSelected(record, $event.target.checked)"
            />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-nc-content-gray-emphasis">Record {{ record.record_id }}</span>
                <span
                  v-if="isExpired(record)"
                  class="rounded bg-nc-bg-red-light px-1.5 py-0.5 text-xs text-nc-content-red-medium"
                >
                  Expired
                </span>
              </div>
              <div class="mt-1 truncate text-sm text-nc-content-gray-subtle" :title="recordPreview(record)">
                {{ recordPreview(record) }}
              </div>
              <div class="mt-1 text-xs text-nc-content-gray-muted">
                Deleted {{ formatTimestamp(record.deleted_at) }} · Expires {{ formatTimestamp(record.expires_at) }}
              </div>
            </div>
            <div class="flex flex-none items-center gap-2">
              <NcButton
                v-if="canRestore"
                type="secondary"
                size="small"
                :disabled="isExpired(record)"
                :loading="isActionLoading('restore', String(record.id))"
                :data-testid="`nc-record-trash-restore-${record.id}`"
                @click="restore([String(record.id)])"
              >
                Restore
              </NcButton>
              <NcButton
                v-if="canPermanentlyDelete"
                type="text"
                size="small"
                :loading="isActionLoading('delete', String(record.id))"
                :data-testid="`nc-record-trash-delete-${record.id}`"
                aria-label="Delete permanently"
                @click="confirmPermanentDelete([String(record.id)])"
              >
                <GeneralIcon icon="delete" class="text-nc-content-red-medium" />
              </NcButton>
            </div>
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
