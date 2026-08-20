<script setup lang="ts">
import { useVirtualList } from '@vueuse/core'
import tinycolor from 'tinycolor2'
import { PermissionEntity, PermissionKey, ViewTypes, isVirtualCol } from 'nocodb-sdk'
import type { ColumnType, ListType } from 'nocodb-sdk'
import type { ComponentPublicInstance } from 'vue'
import type { Row as RowType } from '#imports'
import {
  buildListBulkUpdateData,
  parseListColorRules,
  parseListImageAttachment,
  resolveListColorField,
  resolveListConditionalRowColor,
  resolveListPresentationFields,
  resolveListRowColor,
} from '~/utils/listView'

const meta = inject(MetaInj, ref())
const view = inject(ActiveViewInj, ref())
const fields = inject(FieldsInj, ref<ColumnType[]>([]))
const reloadViewDataHook = inject(ReloadViewDataHookInj, createEventHook())
const openNewRecordFormHook = inject(OpenNewRecordFormHookInj, createEventHook())
const isPublic = inject(IsPublicInj, ref(false))

const { user } = useGlobal()
const { metas } = useMetas()
const { getBaseType } = useBase()
const { isUIAllowed } = useRoles()
const { isViewDataLoading } = storeToRefs(useViewsStore())
const { xWhere, allFilters, validFiltersFromUrlParams, eventBus, isSyncedTable } = useSmartsheetStoreOrThrow()

const router = useRouter()
const route = router.currentRoute

provide(IsFormInj, ref(false))
provide(IsGalleryInj, ref(false))
provide(IsGridInj, ref(false))
provide(IsCalendarInj, ref(false))
provide(RowHeightInj, ref(1 as const))
provide(ReloadRowDataHookInj, reloadViewDataHook)

const {
  formattedData,
  paginationData,
  loadData,
  changePage,
  deleteRowsByPk,
  deleteAllMatchingRows,
  updateRowsByPk,
  updateAllMatchingRows,
  navigateToSiblingRow,
  isFirstRow,
  islastRow,
} = useViewData(meta, view, xWhere)

const listConfig = computed<Partial<ListType>>(() => (view.value?.view as ListType) || {})

const presentation = computed(() => resolveListPresentationFields(fields.value, listConfig.value))
const titleField = computed(() => presentation.value.titleField)
const subtitleField = computed(() => presentation.value.subtitleField)
const imageField = computed(() => presentation.value.imageField)
const detailFields = computed(() => presentation.value.detailFields)
const colorField = computed(() => resolveListColorField(fields.value, listConfig.value.meta))
const colorRules = computed(() => parseListColorRules(listConfig.value.meta))

const imageAttachment = (record: RowType) =>
  imageField.value?.title ? parseListImageAttachment(record.row[imageField.value.title]) : undefined

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

const densityVerticalPadding = computed(() => {
  switch (listConfig.value.density) {
    case 'compact':
      return 8
    case 'spacious':
      return 20
    default:
      return 14
  }
})

const { width: viewportWidth } = useWindowSize()

const listItemHeight = computed(() => {
  const detailRows =
    viewportWidth.value >= 1024
      ? Math.ceil(detailFields.value.length / 2)
      : viewportWidth.value >= 768
      ? detailFields.value.length
      : 0
  const contentHeight = Math.max(46, detailRows * 20, imageField.value ? 72 : 0)

  // Include the eight-pixel gap after every record in the virtual item size.
  return contentHeight + densityVerticalPadding.value * 2 + 8
})

const listRowStyle = (record: RowType) => {
  const currentUser = user.value?.id && user.value?.email ? { id: user.value.id, email: user.value.email } : undefined
  const color =
    resolveListConditionalRowColor(record.row, fields.value, colorRules.value, {
      client: getBaseType(listConfig.value.source_id),
      metas: metas.value,
      currentUser,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }) || resolveListRowColor(record.row, colorField.value)

  return {
    height: `${listItemHeight.value - 8}px`,
    ...(color && !record.rowMeta.selected
      ? {
          backgroundColor: tinycolor.mix(color, '#ffffff', 85).toString(),
          borderLeftColor: color,
          borderLeftWidth: '4px',
        }
      : {}),
  }
}

const {
  list: virtualRows,
  containerProps,
  wrapperProps,
  scrollTo,
} = useVirtualList(formattedData, {
  itemHeight: () => listItemHeight.value,
  overscan: 5,
})

const rowElements = new Map<number, HTMLElement>()

const setRowElement = (element: Element | ComponentPublicInstance | null, index: number) => {
  if (element instanceof HTMLElement) {
    rowElements.set(index, element)
  } else {
    rowElements.delete(index)
  }
}

const focusRow = async (index: number) => {
  if (!virtualRows.value.some((row) => row.index === index)) scrollTo(index)

  await nextTick()
  const element = rowElements.get(index)
  element?.focus({ preventScroll: true })
  element?.scrollIntoView({ block: 'nearest' })
}

const totalRows = computed(() => paginationData.value.totalRows ?? formattedData.value.length)

const rowPrimaryKey = (record: RowType) => {
  const primaryKey = extractPkFromRow(record.row, meta.value?.columns as ColumnType[])
  return primaryKey === null || primaryKey === undefined ? undefined : String(primaryKey)
}

const {
  activeIndex,
  selectedCount,
  hasSelection,
  allSelected,
  isIndeterminate,
  isAllMatchingSelected,
  canSelectAllMatching,
  selectedValues,
  excludedKeys,
  clearSelection,
  selectAllMatching,
  toggleRow,
  onRowFocus,
  onRowKeydown,
} = useViewRowSelection<RowType>({
  rows: formattedData,
  isSelected: (row) => !!row.rowMeta.selected,
  setSelected: (row, selected) => {
    row.rowMeta.selected = selected
  },
  getRowKey: rowPrimaryKey,
  getSelectionValue: (row) => rowPkData(row.row, meta.value?.columns as ColumnType[]),
  totalRows,
  focusRow,
})

watch(listItemHeight, () => containerProps.onScroll())

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

const handleRowKeydown = (event: KeyboardEvent, index: number) =>
  onRowKeydown(event, index, {
    onOpen: (row) => expandForm(row),
  })

const onRowSelectionChange = (event: Event, index: number) => {
  toggleRow(index, (event as MouseEvent).shiftKey)
}

const isDeletingSelection = ref(false)
const isUpdatingSelection = ref(false)
const bulkUpdateVisible = ref(false)
const { isAllowed: isFieldAllowed } = usePermissions()

const bulkUpdateFields = computed(() =>
  fields.value.filter(
    (field) =>
      isListBulkUpdateColumn(field) &&
      !!field.id &&
      isFieldAllowed(PermissionEntity.FIELD, field.id, PermissionKey.RECORD_FIELD_EDIT),
  ),
)

const bulkUpdateSelection = async ({ updates }: { updates: Array<{ field: ColumnType; value: any }> }) => {
  if (isUpdatingSelection.value || !updates.length) return

  const data = buildListBulkUpdateData(updates, bulkUpdateFields.value)
  if (!data) return

  isUpdatingSelection.value = true
  try {
    const updated = isAllMatchingSelected.value
      ? await updateAllMatchingRows(data, excludedKeys.value)
      : await updateRowsByPk(selectedValues.value as Record<string, any>[], data)

    if (!updated) return

    clearSelection()
    bulkUpdateVisible.value = false
  } finally {
    isUpdatingSelection.value = false
  }
}

const deleteSelection = () => {
  if (!hasSelection.value || isDeletingSelection.value) return

  const dialogVisible = ref(true)
  const { close } = useDialog(resolveComponent('DlgRecordDeleteAll'), {
    'modelValue': dialogVisible,
    'rows': selectedCount.value,
    'isSelectedAll': false,
    'onUpdate:modelValue': closeDialog,
    'onDeleteAll': async () => {
      if (isDeletingSelection.value) return

      isDeletingSelection.value = true
      try {
        const deleted = isAllMatchingSelected.value
          ? await deleteAllMatchingRows(excludedKeys.value)
          : await deleteRowsByPk(selectedValues.value as Record<string, string>[])

        if (!deleted) return

        clearSelection()
        closeDialog()
      } finally {
        isDeletingSelection.value = false
      }
    },
  })

  function closeDialog() {
    dialogVisible.value = false
    close(200)
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

const recordKey = (record: RowType, index: number) => rowPrimaryKey(record) ?? `list-row-${index}`

const reloadData = async () => {
  clearSelection()
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
    if (!viewId || view.value?.type !== ViewTypes.LIST) return

    isViewDataLoading.value = true
    try {
      await reloadData()
    } finally {
      isViewDataLoading.value = false
    }
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
    <div
      v-if="formattedData.length"
      data-testid="nc-list-selection-toolbar"
      class="flex h-10 flex-none items-center gap-2 border-b-1 border-nc-border-gray-medium bg-nc-bg-default px-3"
    >
      <NcCheckbox
        v-model:checked="allSelected"
        :indeterminate="isIndeterminate"
        data-testid="nc-list-select-all"
        :aria-label="$t('general.selectAll')"
      />
      <span class="text-xs text-nc-content-gray-muted">
        <template v-if="isAllMatchingSelected">
          {{ $t('labels.allMatchingRecordsSelected', { count: selectedCount }) }}
        </template>
        <template v-else-if="hasSelection">{{ selectedCount }} {{ $t('general.selected') }}</template>
        <template v-else>{{ $t('general.selectAll') }}</template>
      </span>

      <NcButton
        v-if="canSelectAllMatching && allSelected && !isAllMatchingSelected && totalRows > selectedCount"
        data-testid="nc-list-select-all-matching"
        type="text"
        size="small"
        @click="selectAllMatching"
      >
        {{ $t('labels.selectAllMatchingRecords', { count: totalRows }) }}
      </NcButton>

      <div v-if="hasSelection" class="ml-auto flex items-center gap-1">
        <NcButton data-testid="nc-list-clear-selection" type="text" size="small" @click="clearSelection">
          {{ $t('labels.clearSelection') }}
        </NcButton>
        <NcButton
          v-if="isUIAllowed('dataEdit') && !isSyncedTable && bulkUpdateFields.length"
          data-testid="nc-list-update-selected"
          type="secondary"
          size="small"
          :loading="isUpdatingSelection"
          @click="bulkUpdateVisible = true"
        >
          <template #icon><GeneralIcon icon="edit" /></template>
          {{ $t('labels.updateSelectedRows') }}
        </NcButton>
        <PermissionsTooltip
          v-if="isUIAllowed('dataDelete') && !isSyncedTable"
          :entity="PermissionEntity.TABLE"
          :entity-id="meta?.id"
          :permission="PermissionKey.TABLE_RECORD_DELETE"
        >
          <template #default="{ isAllowed }">
            <NcButton
              data-testid="nc-list-delete-selected"
              type="danger"
              size="small"
              :disabled="!isAllowed"
              :loading="isDeletingSelection"
              @click="deleteSelection"
            >
              <template #icon><GeneralIcon icon="delete" /></template>
              {{ $t('activity.deleteSelectedRow') }}
            </NcButton>
          </template>
        </PermissionsTooltip>
      </div>
    </div>

    <div
      v-bind="containerProps"
      class="nc-list-scroll flex-1 overflow-auto nc-scrollbar-md"
      role="listbox"
      aria-multiselectable="true"
      :aria-label="$t('labels.listViewRecords')"
    >
      <div v-if="formattedData.length" class="mx-auto w-full max-w-5xl p-3 md:p-5">
        <div v-bind="wrapperProps">
          <LazySmartsheetRow
            v-for="virtualRow in virtualRows"
            :key="recordKey(virtualRow.data, virtualRow.index)"
            :row="virtualRow.data"
          >
            <article
              :ref="(element) => setRowElement(element, virtualRow.index)"
              :data-testid="`nc-list-row-${virtualRow.index}`"
              class="nc-list-row group mb-2 flex cursor-pointer gap-3 overflow-hidden rounded-lg border-1 border-nc-border-gray-medium bg-nc-bg-default px-4 transition-colors hover:border-nc-border-gray-dark focus-visible:(border-nc-border-brand ring-1 ring-nc-border-brand)"
              :class="[
                densityClass,
                {
                  '!border-nc-border-brand bg-nc-bg-brand-light': virtualRow.data.rowMeta.selected,
                },
              ]"
              :style="listRowStyle(virtualRow.data)"
              role="option"
              :aria-selected="!!virtualRow.data.rowMeta.selected"
              :tabindex="activeIndex === null ? (virtualRow.index === 0 ? 0 : -1) : activeIndex === virtualRow.index ? 0 : -1"
              @click="expandForm(virtualRow.data)"
              @focus="onRowFocus(virtualRow.index)"
              @keydown="handleRowKeydown($event, virtualRow.index)"
            >
              <div class="flex flex-none items-start pt-1" @click.stop>
                <NcCheckbox
                  :checked="!!virtualRow.data.rowMeta.selected"
                  :data-testid="`nc-list-select-row-${virtualRow.index}`"
                  :aria-label="$t('labels.selectRecord', { index: virtualRow.index + 1 })"
                  @change="(event) => onRowSelectionChange(event, virtualRow.index)"
                />
              </div>

              <div
                v-if="imageField"
                class="h-full w-24 flex-none overflow-hidden rounded-md border-1 border-nc-border-gray-light bg-nc-bg-gray-light"
              >
                <LazyCellAttachmentPreviewThumbnail
                  v-if="imageAttachment(virtualRow.data)"
                  :attachment="imageAttachment(virtualRow.data)!"
                  :alt="String(imageAttachment(virtualRow.data)?.title || '')"
                  thumbnail="small"
                  image-class="!h-full !w-full"
                />
                <div v-else class="flex h-full w-full items-center justify-center text-nc-content-gray-muted">
                  <GeneralIcon icon="image" class="h-5 w-5" />
                </div>
              </div>

              <div class="min-w-0 flex-1">
                <div v-if="titleField" class="nc-list-title min-h-6 text-sm font-semibold text-nc-content-gray-emphasis">
                  <LazySmartsheetVirtualCell
                    v-if="isVirtualCol(titleField)"
                    v-model="virtualRow.data.row[titleField.title]"
                    :column="titleField"
                    :row="virtualRow.data"
                    class="pointer-events-none"
                  />
                  <LazySmartsheetCell
                    v-else
                    v-model="virtualRow.data.row[titleField.title]"
                    :column="titleField"
                    :edit-enabled="false"
                    :read-only="true"
                    class="pointer-events-none"
                  />
                </div>

                <div v-if="subtitleField" class="nc-list-subtitle mt-0.5 min-h-5 text-xs text-nc-content-gray-muted">
                  <LazySmartsheetVirtualCell
                    v-if="isVirtualCol(subtitleField)"
                    v-model="virtualRow.data.row[subtitleField.title]"
                    :column="subtitleField"
                    :row="virtualRow.data"
                    class="pointer-events-none"
                  />
                  <LazySmartsheetCell
                    v-else
                    v-model="virtualRow.data.row[subtitleField.title]"
                    :column="subtitleField"
                    :edit-enabled="false"
                    :read-only="true"
                    class="pointer-events-none"
                  />
                </div>
              </div>

              <dl
                v-if="detailFields.length"
                class="hidden min-w-0 flex-[2] grid-cols-1 gap-x-5 gap-y-1 overflow-hidden md:grid lg:grid-cols-2"
              >
                <div v-for="column in detailFields" :key="column.id" class="flex h-5 min-w-0 items-center gap-2 text-xs">
                  <dt v-if="showFieldLabels" class="w-24 flex-none truncate text-nc-content-gray-muted">
                    {{ column.title }}
                  </dt>
                  <dd class="min-w-0 flex-1 truncate text-nc-content-gray">
                    <LazySmartsheetVirtualCell
                      v-if="isVirtualCol(column)"
                      v-model="virtualRow.data.row[column.title]"
                      :column="column"
                      :row="virtualRow.data"
                      class="pointer-events-none"
                    />
                    <LazySmartsheetCell
                      v-else
                      v-model="virtualRow.data.row[column.title]"
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

  <LazySmartsheetListBulkUpdate
    v-if="bulkUpdateVisible"
    v-model="bulkUpdateVisible"
    :fields="bulkUpdateFields"
    :record-count="selectedCount"
    :loading="isUpdatingSelection"
    @apply="bulkUpdateSelection"
  />
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

.nc-list-row[aria-selected='true'] :deep(.ant-checkbox-inner) {
  @apply border-nc-border-brand;
}
</style>
