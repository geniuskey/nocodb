<script setup lang="ts">
import { PermissionEntity, PermissionKey, ViewTypes, isVirtualCol } from 'nocodb-sdk'
import type { ColumnType, ListType, ListViewLevelType, TableType } from 'nocodb-sdk'

const meta = inject(MetaInj, ref())
const view = inject(ActiveViewInj, ref())
const fields = inject(FieldsInj, ref<ColumnType[]>([]))
const reloadViewDataHook = inject(ReloadViewDataHookInj, createEventHook())
const openNewRecordFormHook = inject(OpenNewRecordFormHookInj, createEventHook())

const route = useRoute()
const router = useRouter()
const isPublic = inject(IsPublicInj, ref(false))
const { user } = useGlobal()
const { isUIAllowed } = useRoles()
const { isSyncedTable, xWhere, allFilters, validFiltersFromUrlParams, eventBus } = useSmartsheetStoreOrThrow()
const { isViewDataLoading, isPaginationLoading } = storeToRefs(useViewsStore())

provide(IsFormInj, ref(false))
provide(IsGalleryInj, ref(false))
provide(IsGridInj, ref(false))
provide(IsCalendarInj, ref(false))
provide(
  RowHeightInj,
  computed(() => ((view.value?.view as any)?.row_height ?? 0) + 1),
)
provide(ReloadRowDataHookInj, reloadViewDataHook)

const { formattedData, paginationData, loadData, changePage, navigateToSiblingRow, isFirstRow, islastRow } = useViewData(
  meta,
  view,
  xWhere,
)

const expandedFormDlg = ref(false)
const expandedFormRow = ref<Row>()

const expandedFormOnRowIdDlg = computed({
  get: () => !!route.query.rowId,
  set: (value) => {
    if (!value) {
      router.push({ query: { ...route.query, rowId: undefined } })
    }
  },
})

const visibleFields = computed(() => fields.value.filter(Boolean))
const displayField = computed(() => visibleFields.value.find((field) => field.pv) ?? visibleFields.value[0])
const detailFields = computed(() => visibleFields.value.filter((field) => field.id !== displayField.value?.id))
const hierarchyLevels = computed<ListViewLevelType[]>(() => (view.value?.view as ListType | undefined)?.levels ?? [])

const recordPath = (record: Record<string, any>) => [
  `${meta.value?.id}:${extractPkFromRow(record, meta.value?.columns as ColumnType[])}`,
]

const expandForm = (row: Row) => {
  const rowId = extractPkFromRow(row.row, meta.value?.columns as ColumnType[])
  if (rowId && !isPublic.value) {
    expandedFormRow.value = undefined
    router.push({ query: { ...route.query, rowId } })
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

const focusSibling = (event: KeyboardEvent, index: number, delta: number) => {
  event.preventDefault()
  const target = document.querySelector<HTMLElement>(`[data-list-row-index="${index + delta}"]`)
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ block: 'nearest' })
}

const reload = async () => {
  isViewDataLoading.value = true
  try {
    await loadData()
  } finally {
    isViewDataLoading.value = false
  }
}

watch(
  () => view.value?.id,
  async (id) => {
    if (id && view.value?.type === ViewTypes.LIST) await reload()
  },
  { immediate: true },
)

const onReloadEvent = () => reload()
const onSmartsheetEvent = (event: SmartsheetStoreEvents) => {
  if (event === SmartsheetStoreEvents.DATA_RELOAD) reloadViewDataHook.trigger()
}

reloadViewDataHook.on(onReloadEvent)
openNewRecordFormHook.on(openNewRecord)
eventBus.on(onSmartsheetEvent)

onBeforeUnmount(() => {
  reloadViewDataHook.off(onReloadEvent)
  openNewRecordFormHook.off(openNewRecord)
  eventBus.off(onSmartsheetEvent)
})
</script>

<template>
  <div class="nc-list-view flex h-full min-h-0 w-full flex-col bg-nc-bg-gray-extralight" data-testid="nc-list-wrapper">
    <div class="min-h-0 flex-1 overflow-auto p-3 md:p-5" role="list" aria-label="Records">
      <div v-if="isViewDataLoading || isPaginationLoading" class="space-y-2" aria-busy="true">
        <a-skeleton v-for="index in 6" :key="index" active :paragraph="{ rows: 1 }" />
      </div>

      <div
        v-else-if="!formattedData.length"
        class="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-nc-content-gray-subtle"
        data-testid="nc-list-empty"
      >
        <component :is="iconMap.list" class="h-8 w-8" />
        <span>{{ $t('msg.noData') }}</span>
        <PermissionsTooltip
          v-if="isUIAllowed('dataInsert') && !isSyncedTable"
          :entity="PermissionEntity.TABLE"
          :entity-id="meta?.id"
          :permission="PermissionKey.TABLE_RECORD_ADD"
        >
          <template #default="{ isAllowed }">
            <NcButton size="small" type="primary" :disabled="!isAllowed" @click="openNewRecord">
              {{ $t('activity.newRecord') }}
            </NcButton>
          </template>
        </PermissionsTooltip>
      </div>

      <div v-else class="mx-auto flex max-w-6xl flex-col gap-2">
        <div v-for="(record, index) in formattedData" :key="extractPkFromRow(record.row, meta?.columns as ColumnType[]) || index">
          <div
            role="listitem"
            tabindex="0"
            class="group w-full rounded-lg border border-nc-border-gray-medium bg-nc-bg-default px-4 py-3 text-left shadow-sm transition hover:border-nc-border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-nc-content-brand"
            :data-list-row-index="index"
            :data-testid="`nc-list-row-${index}`"
            @click="expandForm(record)"
            @keydown.down="focusSibling($event, index, 1)"
            @keydown.up="focusSibling($event, index, -1)"
            @keydown.enter="expandForm(record)"
          >
            <LazySmartsheetRow :row="record">
              <div class="flex min-w-0 items-center gap-4">
                <div class="min-w-0 flex-1">
                  <div v-if="displayField" class="min-h-6 truncate font-medium text-nc-content-gray-emphasis">
                    <LazySmartsheetVirtualCell
                      v-if="isVirtualCol(displayField)"
                      v-model="record.row[displayField.title!]"
                      :column="displayField"
                      :row="record"
                    />
                    <LazySmartsheetCell
                      v-else
                      v-model="record.row[displayField.title!]"
                      :column="displayField"
                      :edit-enabled="false"
                      :read-only="true"
                    />
                  </div>
                  <div class="mt-1 flex min-w-0 flex-wrap gap-x-6 gap-y-1 text-small text-nc-content-gray-subtle">
                    <div v-for="field in detailFields" :key="field.id" class="flex min-w-32 max-w-64 items-center gap-2">
                      <span class="shrink-0 truncate text-nc-content-gray-muted">{{ field.title }}</span>
                      <span class="min-w-0 truncate text-nc-content-gray">
                        <LazySmartsheetVirtualCell
                          v-if="isVirtualCol(field)"
                          v-model="record.row[field.title!]"
                          :column="field"
                          :row="record"
                        />
                        <LazySmartsheetCell
                          v-else
                          v-model="record.row[field.title!]"
                          :column="field"
                          :edit-enabled="false"
                          :read-only="true"
                        />
                      </span>
                    </div>
                  </div>
                </div>
                <GeneralIcon icon="chevronRight" class="h-4 w-4 shrink-0 text-nc-content-gray-muted" />
              </div>
            </LazySmartsheetRow>
          </div>
          <SmartsheetListHierarchyNode
            v-if="hierarchyLevels.length && meta"
            :record="record.row"
            :table-meta="meta as TableType"
            :levels="hierarchyLevels"
            :level-index="0"
            :depth="1"
            :path="recordPath(record.row)"
          />
        </div>
      </div>
    </div>

    <LazySmartsheetPagination v-model:pagination-data="paginationData" :change-page="changePage" show-size-changer>
      <template v-if="isUIAllowed('dataInsert') && !isSyncedTable" #add-record>
        <PermissionsTooltip :entity="PermissionEntity.TABLE" :entity-id="meta?.id" :permission="PermissionKey.TABLE_RECORD_ADD">
          <template #default="{ isAllowed }">
            <NcButton class="ml-1" size="small" type="secondary" :disabled="!isAllowed" @click="openNewRecord">
              {{ $t('activity.newRecord') }}
            </NcButton>
          </template>
        </PermissionsTooltip>
      </template>
    </LazySmartsheetPagination>
  </div>

  <Suspense>
    <LazySmartsheetExpandedForm
      v-if="expandedFormRow && expandedFormDlg"
      v-model="expandedFormDlg"
      :row="expandedFormRow"
      :load-row="!isPublic"
      :first-row="isFirstRow"
      :last-row="islastRow"
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
      :row-id="route.query.rowId"
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
