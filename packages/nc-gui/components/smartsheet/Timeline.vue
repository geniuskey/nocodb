<script setup lang="ts">
import dayjs from 'dayjs'
import { ViewTypes } from 'nocodb-sdk'
import type { ColumnType, TimelineType } from 'nocodb-sdk'

const meta = inject(MetaInj, ref())
const view = inject(ActiveViewInj, ref())
const fields = inject(FieldsInj, ref<ColumnType[]>([]))
const reloadViewDataHook = inject(ReloadViewDataHookInj, createEventHook())

const route = useRoute()
const router = useRouter()
const { xWhere, eventBus } = useSmartsheetStoreOrThrow()
const { isViewDataLoading, isPaginationLoading } = storeToRefs(useViewsStore())

provide(IsFormInj, ref(false))
provide(IsGalleryInj, ref(false))
provide(IsGridInj, ref(false))
provide(IsCalendarInj, ref(false))
provide(RowHeightInj, ref(1))
provide(ReloadRowDataHookInj, reloadViewDataHook)

const { formattedData, paginationData, loadData, changePage, navigateToSiblingRow, isFirstRow, islastRow } = useViewData(
  meta,
  view,
  xWhere,
)

const timeline = computed(() => view.value?.view as TimelineType | undefined)
const startField = computed(() =>
  meta.value?.columns?.find((column: ColumnType) => column.id === timeline.value?.fk_start_date_col_id),
)
const endField = computed(() =>
  meta.value?.columns?.find((column: ColumnType) => column.id === timeline.value?.fk_end_date_col_id),
)
const displayField = computed(() => fields.value.find((field) => field?.pv) ?? fields.value.find(Boolean))

const activeMonth = ref(dayjs().startOf('month'))
const dayWidth = 36
const days = computed(() =>
  Array.from({ length: activeMonth.value.daysInMonth() }, (_, index) => activeMonth.value.add(index, 'day')),
)
const axisWidth = computed(() => days.value.length * dayWidth)
const monthEnd = computed(() => activeMonth.value.endOf('month'))

const getFieldValue = (record: Row, field?: ColumnType) => (field?.title ? record.row[field.title] : undefined)

const parseDate = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = dayjs(value as string)
  return parsed.isValid() ? parsed : null
}

const datedRecords = computed(() =>
  formattedData.value.flatMap((record, index) => {
    const start = parseDate(getFieldValue(record, startField.value))
    if (!start) return []

    const configuredEnd = parseDate(getFieldValue(record, endField.value))
    const invalidRange = Boolean(configuredEnd?.isBefore(start))
    const effectiveEnd = !configuredEnd || invalidRange ? start : configuredEnd
    if (effectiveEnd.isBefore(activeMonth.value, 'day') || start.isAfter(monthEnd.value, 'day')) return []

    const clippedStart = start.isBefore(activeMonth.value, 'day') ? activeMonth.value : start
    const clippedEnd = effectiveEnd.isAfter(monthEnd.value, 'day') ? monthEnd.value : effectiveEnd
    const startOffset = Math.max(0, clippedStart.startOf('day').diff(activeMonth.value, 'day'))
    const duration = Math.max(1, clippedEnd.startOf('day').diff(clippedStart.startOf('day'), 'day') + 1)

    return [
      {
        record,
        index,
        start,
        end: configuredEnd,
        invalidRange,
        left: startOffset * dayWidth,
        width: duration * dayWidth,
      },
    ]
  }),
)

const undatedCount = computed(
  () => formattedData.value.filter((record) => !parseDate(getFieldValue(record, startField.value))).length,
)

const expandedFormOnRowIdDlg = computed({
  get: () => !!route.query.rowId,
  set: (value) => {
    if (!value) router.push({ query: { ...route.query, rowId: undefined } })
  },
})

const openRecord = (record: Row) => {
  const rowId = extractPkFromRow(record.row, meta.value?.columns as ColumnType[])
  if (rowId !== null && rowId !== undefined && rowId !== '') {
    router.push({ query: { ...route.query, rowId } })
  }
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
    if (id && view.value?.type === ViewTypes.TIMELINE) await reload()
  },
  { immediate: true },
)

const onReloadEvent = () => reload()
const onSmartsheetEvent = (event: SmartsheetStoreEvents) => {
  if (event === SmartsheetStoreEvents.DATA_RELOAD) reloadViewDataHook.trigger()
}

reloadViewDataHook.on(onReloadEvent)
eventBus.on(onSmartsheetEvent)

onBeforeUnmount(() => {
  reloadViewDataHook.off(onReloadEvent)
  eventBus.off(onSmartsheetEvent)
})
</script>

<template>
  <div class="nc-timeline-view flex h-full min-h-0 w-full flex-col bg-nc-bg-gray-extralight" data-testid="nc-timeline-wrapper">
    <div class="flex items-center justify-between border-b border-nc-border-gray-medium bg-nc-bg-default px-4 py-2">
      <div class="flex items-center gap-2">
        <GeneralViewIcon :meta="{ type: ViewTypes.TIMELINE }" />
        <span class="font-medium text-nc-content-gray-emphasis">{{ activeMonth.format('MMMM YYYY') }}</span>
        <span class="rounded-full bg-nc-bg-gray-medium px-2 py-0.5 text-small text-nc-content-gray-subtle">
          {{ undatedCount }} undated
        </span>
      </div>
      <span class="text-small text-nc-content-gray-muted">Month scale · read-only foundation</span>
    </div>

    <div v-if="isViewDataLoading || isPaginationLoading" class="flex-1 p-5" aria-busy="true">
      <a-skeleton active :paragraph="{ rows: 8 }" />
    </div>

    <div v-else-if="!startField" class="flex flex-1 items-center justify-center text-nc-content-gray-subtle">
      Timeline start field is unavailable.
    </div>

    <div v-else class="min-h-0 flex-1 overflow-auto">
      <div class="min-w-max" :style="{ width: `${axisWidth + 240}px` }">
        <div class="sticky top-0 z-20 flex h-12 border-b border-nc-border-gray-medium bg-nc-bg-default">
          <div
            class="sticky left-0 z-30 flex w-60 shrink-0 items-center border-r border-nc-border-gray-medium bg-nc-bg-default px-4 font-medium"
          >
            Record
          </div>
          <div class="flex" :style="{ width: `${axisWidth}px` }">
            <div
              v-for="day in days"
              :key="day.format('YYYY-MM-DD')"
              class="flex shrink-0 flex-col items-center justify-center border-r border-nc-border-gray-light text-small"
              :class="day.isSame(dayjs(), 'day') ? 'bg-nc-bg-brand text-nc-content-brand' : 'text-nc-content-gray-subtle'"
              :style="{ width: `${dayWidth}px` }"
            >
              <span>{{ day.format('dd')[0] }}</span>
              <span>{{ day.format('D') }}</span>
            </div>
          </div>
        </div>

        <div v-if="!datedRecords.length" class="flex h-48 items-center justify-center text-nc-content-gray-subtle">
          No dated records in this month.
        </div>

        <div
          v-for="item in datedRecords"
          :key="extractPkFromRow(item.record.row, meta?.columns as ColumnType[]) ?? item.index"
          class="flex h-14 border-b border-nc-border-gray-light bg-nc-bg-default"
          :data-testid="`nc-timeline-row-${item.index}`"
        >
          <button
            type="button"
            class="sticky left-0 z-10 w-60 shrink-0 truncate border-r border-nc-border-gray-medium bg-nc-bg-default px-4 text-left hover:bg-nc-bg-gray-light"
            @click="openRecord(item.record)"
          >
            <LazySmartsheetCell
              v-if="displayField"
              v-model="item.record.row[displayField.title!]"
              :column="displayField"
              :edit-enabled="false"
              :read-only="true"
            />
          </button>
          <div class="relative" :style="{ width: `${axisWidth}px` }">
            <div class="absolute inset-0 flex">
              <div
                v-for="day in days"
                :key="day.format('YYYY-MM-DD')"
                class="shrink-0 border-r border-nc-border-gray-light"
                :style="{ width: `${dayWidth}px` }"
              />
            </div>
            <button
              type="button"
              class="absolute top-2.5 z-10 h-9 truncate rounded-md bg-teal-600 px-2 text-left text-small font-medium text-white shadow-sm hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              :class="{ '!bg-nc-content-red-medium': item.invalidRange }"
              :style="{ left: `${item.left}px`, width: `${item.width}px` }"
              :title="
                item.invalidRange
                  ? 'End date precedes start date'
                  : `${item.start.format('YYYY-MM-DD')} – ${item.end?.format('YYYY-MM-DD') ?? item.start.format('YYYY-MM-DD')}`
              "
              @click="openRecord(item.record)"
            >
              {{ displayField ? item.record.row[displayField.title!] : 'Record' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <LazySmartsheetPagination v-model:pagination-data="paginationData" :change-page="changePage" show-size-changer />
  </div>

  <Suspense>
    <LazySmartsheetExpandedForm
      v-if="expandedFormOnRowIdDlg && meta?.id"
      v-model="expandedFormOnRowIdDlg"
      :row="{ row: {}, oldRow: {}, rowMeta: {} }"
      :meta="meta"
      :load-row="true"
      :row-id="route.query.rowId"
      :first-row="isFirstRow"
      :last-row="islastRow"
      :view="view"
      show-next-prev-icons
      @next="navigateToSiblingRow(NavigateDir.NEXT)"
      @prev="navigateToSiblingRow(NavigateDir.PREV)"
    />
  </Suspense>
</template>
