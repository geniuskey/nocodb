<script setup lang="ts">
import { PermissionEntity, PermissionKey, ViewTypes, isVirtualCol } from 'nocodb-sdk'
import type { ColumnType, ListType } from 'nocodb-sdk'
import type { Row as RowType } from '#imports'

const meta = inject(MetaInj, ref())
const view = inject(ActiveViewInj, ref())
const fields = inject(FieldsInj, ref<ColumnType[]>([]))
const reloadViewDataHook = inject(ReloadViewDataHookInj, createEventHook())
const openNewRecordFormHook = inject(OpenNewRecordFormHookInj, createEventHook())
const isPublic = inject(IsPublicInj, ref(false))

const { user } = useGlobal()
const { isUIAllowed } = useRoles()
const { xWhere, allFilters, validFiltersFromUrlParams, eventBus, isSyncedTable } = useSmartsheetStoreOrThrow()

const router = useRouter()
const route = router.currentRoute

provide(IsFormInj, ref(false))
provide(IsGalleryInj, ref(false))
provide(IsGridInj, ref(false))
provide(IsCalendarInj, ref(false))
provide(RowHeightInj, ref(1 as const))
provide(ReloadRowDataHookInj, reloadViewDataHook)

const { formattedData, paginationData, loadData, changePage, navigateToSiblingRow, isFirstRow, islastRow } = useViewData(
  meta,
  view,
  xWhere,
)

const listConfig = computed<Partial<ListType>>(() => (view.value?.view as ListType) || {})

const columnById = computed(() =>
  (meta.value?.columns || []).reduce<Record<string, ColumnType>>((columns, column) => {
    if (column.id) columns[column.id] = column
    return columns
  }, {}),
)

const titleField = computed(() => {
  const configured = listConfig.value.fk_title_column_id
  return (configured && columnById.value[configured]) || fields.value.find((column) => column.pv) || fields.value[0]
})

const subtitleField = computed(() => {
  const configured = listConfig.value.fk_subtitle_column_id
  if (configured && columnById.value[configured]?.id !== titleField.value?.id) return columnById.value[configured]
  return fields.value.find((column) => column.id !== titleField.value?.id)
})

const detailFields = computed(() =>
  fields.value.filter((column) => column.id !== titleField.value?.id && column.id !== subtitleField.value?.id),
)

const showFieldLabels = computed(() => ![false, 0, '0'].includes(listConfig.value.show_field_labels))

const densityClass = computed(() => {
  switch (listConfig.value.density) {
    case 'compact':
      return 'py-2'
    case 'spacious':
      return 'py-5'
    default:
      return 'py-3.5'
  }
})

const expandedFormDlg = ref(false)
const expandedFormRow = ref<RowType>()
const expandedFormRowState = ref<Record<string, any>>()

const routeQuery = computed(() => route.value.query as Record<string, string>)

const expandedFormOnRowIdDlg = computed({
  get: () => !!routeQuery.value.rowId,
  set: (visible) => {
    if (!visible) {
      router.push({
        query: {
          ...routeQuery.value,
          rowId: undefined,
        },
      })
    }
  },
})

const expandForm = (row: RowType, state?: Record<string, any>) => {
  const rowId = extractPkFromRow(row.row, meta.value?.columns as ColumnType[])
  expandedFormRowState.value = state

  if (rowId && !isPublic.value) {
    expandedFormRow.value = undefined
    router.push({
      query: {
        ...routeQuery.value,
        rowId,
      },
    })
  } else {
    expandedFormRow.value = row
    expandedFormDlg.value = true
  }
}

const openNewRecord = () => {
  const rowFilters = getPlaceholderNewRow(
    [...allFilters.value, ...validFiltersFromUrlParams.value],
    meta.value?.columns as ColumnType[],
    { currentUser: user.value ?? undefined },
  )

  expandForm({
    row: { ...rowDefaultData(meta.value?.columns), ...rowFilters },
    oldRow: {},
    rowMeta: { new: true },
  })
}

const recordKey = (record: RowType, index: number) =>
  extractPkFromRow(record.row, meta.value?.columns as ColumnType[]) || `list-row-${index}`

const reloadData = async () => {
  await loadData()
}

const smartsheetEventHandler = (event: SmartsheetStoreEvents) => {
  if (event === SmartsheetStoreEvents.DATA_RELOAD) reloadData()
}

openNewRecordFormHook.on(openNewRecord)
reloadViewDataHook.on(reloadData)
eventBus.on(smartsheetEventHandler)

watch(
  () => view.value?.id,
  async (viewId) => {
    if (viewId && view.value?.type === ViewTypes.LIST) await reloadData()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  openNewRecordFormHook.off(openNewRecord)
  reloadViewDataHook.off(reloadData)
  eventBus.off(smartsheetEventHandler)
})
</script>

<template>
  <div data-testid="nc-list-wrapper" class="flex h-full min-h-0 w-full flex-col bg-nc-bg-gray-extralight">
    <div class="nc-list-scroll flex-1 overflow-auto nc-scrollbar-md">
      <div v-if="formattedData.length" class="mx-auto w-full max-w-5xl p-3 md:p-5">
        <LazySmartsheetRow v-for="(record, rowIndex) in formattedData" :key="recordKey(record, rowIndex)" :row="record">
          <article
            :data-testid="`nc-list-row-${rowIndex}`"
            class="nc-list-row group mb-2 flex cursor-pointer gap-4 rounded-lg border-1 border-nc-border-gray-medium bg-nc-bg-default px-4 transition-colors hover:border-nc-border-gray-dark focus-within:border-nc-border-brand"
            :class="densityClass"
            role="button"
            tabindex="0"
            @click="expandForm(record)"
            @keydown.enter.prevent="expandForm(record)"
          >
            <div class="min-w-0 flex-1">
              <div v-if="titleField" class="nc-list-title min-h-6 text-sm font-semibold text-nc-content-gray-emphasis">
                <LazySmartsheetVirtualCell
                  v-if="isVirtualCol(titleField)"
                  v-model="record.row[titleField.title]"
                  :column="titleField"
                  :row="record"
                  class="pointer-events-none"
                />
                <LazySmartsheetCell
                  v-else
                  v-model="record.row[titleField.title]"
                  :column="titleField"
                  :edit-enabled="false"
                  :read-only="true"
                  class="pointer-events-none"
                />
              </div>

              <div v-if="subtitleField" class="nc-list-subtitle mt-0.5 min-h-5 text-xs text-nc-content-gray-muted">
                <LazySmartsheetVirtualCell
                  v-if="isVirtualCol(subtitleField)"
                  v-model="record.row[subtitleField.title]"
                  :column="subtitleField"
                  :row="record"
                  class="pointer-events-none"
                />
                <LazySmartsheetCell
                  v-else
                  v-model="record.row[subtitleField.title]"
                  :column="subtitleField"
                  :edit-enabled="false"
                  :read-only="true"
                  class="pointer-events-none"
                />
              </div>
            </div>

            <dl v-if="detailFields.length" class="hidden min-w-0 flex-[2] grid-cols-1 gap-x-5 gap-y-1 md:grid lg:grid-cols-2">
              <div v-for="column in detailFields" :key="column.id" class="flex min-w-0 items-center gap-2 text-xs">
                <dt v-if="showFieldLabels" class="w-24 flex-none truncate text-nc-content-gray-muted">
                  {{ column.title }}
                </dt>
                <dd class="min-w-0 flex-1 truncate text-nc-content-gray">
                  <LazySmartsheetVirtualCell
                    v-if="isVirtualCol(column)"
                    v-model="record.row[column.title]"
                    :column="column"
                    :row="record"
                    class="pointer-events-none"
                  />
                  <LazySmartsheetCell
                    v-else
                    v-model="record.row[column.title]"
                    :column="column"
                    :edit-enabled="false"
                    :read-only="true"
                    class="pointer-events-none"
                  />
                </dd>
              </div>
            </dl>

            <GeneralIcon icon="chevronRight" class="mt-1 h-4 w-4 flex-none text-nc-content-gray-muted" />
          </article>
        </LazySmartsheetRow>
      </div>

      <div v-else class="flex h-full min-h-56 flex-col items-center justify-center gap-2 text-nc-content-gray-muted">
        <GeneralIcon icon="list" class="h-8 w-8" />
        <span class="text-sm">{{ $t('objects.records') }}</span>
      </div>
    </div>

    <SmartsheetPagination v-model:pagination-data="paginationData" :change-page="changePage" show-size-changer>
      <template #add-record>
        <PermissionsTooltip
          v-if="isUIAllowed('dataInsert') && !isSyncedTable"
          :entity="PermissionEntity.TABLE"
          :entity-id="meta?.id"
          :permission="PermissionKey.TABLE_RECORD_ADD"
        >
          <template #default="{ isAllowed }">
            <NcButton
              data-testid="nc-list-add-record"
              size="small"
              type="text"
              class="ml-2"
              :disabled="!isAllowed"
              @click="openNewRecord"
            >
              <GeneralIcon icon="plus" />
              {{ $t('activity.newRecord') }}
            </NcButton>
          </template>
        </PermissionsTooltip>
      </template>
    </SmartsheetPagination>
  </div>

  <Suspense>
    <LazySmartsheetExpandedForm
      v-if="expandedFormRow && expandedFormDlg"
      v-model="expandedFormDlg"
      :row="expandedFormRow"
      :load-row="!isPublic"
      :first-row="isFirstRow"
      :last-row="islastRow"
      :state="expandedFormRowState"
      :meta="meta"
      :view="view"
    />
  </Suspense>

  <Suspense>
    <LazySmartsheetExpandedForm
      v-if="expandedFormOnRowIdDlg && meta?.id"
      v-model="expandedFormOnRowIdDlg"
      :row="expandedFormRow ?? { row: {}, oldRow: {}, rowMeta: {} }"
      :meta="meta"
      :load-row="!isPublic"
      :row-id="routeQuery.rowId"
      :first-row="isFirstRow"
      :last-row="islastRow"
      :view="view"
      show-next-prev-icons
      :expand-form="expandForm"
      @next="navigateToSiblingRow(NavigateDir.NEXT)"
      @prev="navigateToSiblingRow(NavigateDir.PREV)"
    />
  </Suspense>
</template>

<style scoped lang="scss">
.nc-list-row :deep(.nc-cell),
.nc-list-row :deep(.nc-virtual-cell) {
  @apply min-h-0 w-full overflow-hidden;
}

.nc-list-row :deep(.nc-cell-field),
.nc-list-row :deep(.nc-cell-field-link) {
  @apply min-h-0 truncate py-0;
}
</style>
