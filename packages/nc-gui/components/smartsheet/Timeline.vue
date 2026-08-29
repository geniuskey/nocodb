<script setup lang="ts">
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { ViewTypes } from 'nocodb-sdk'
import type { ColumnType, TimelineType } from 'nocodb-sdk'
import {
  TIMELINE_ZOOMS,
  createTimelineAxis,
  formatTimelineWindow,
  getTimelineAxisWidth,
  getTimelineBarGeometry,
  getTimelinePosition,
  getTimelineWindow,
  normalizeTimelineZoom,
  shiftTimelineAnchor,
} from '~/utils/timelineUtils'
import type { TimelineZoom } from '~/utils/timelineUtils'

const meta = inject(MetaInj, ref())
const view = inject(ActiveViewInj, ref())
const fields = inject(FieldsInj, ref<ColumnType[]>([]))
const reloadViewDataHook = inject(ReloadViewDataHookInj, createEventHook())

const route = useRoute()
const router = useRouter()
const { xWhere, eventBus, isViewOperationsAllowed } = useSmartsheetStoreOrThrow()
const viewsStore = useViewsStore()
const { updateViewMeta } = viewsStore
const { isViewDataLoading, isPaginationLoading } = storeToRefs(viewsStore)

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

const zoomLabels: Record<TimelineZoom, string> = {
  day: 'Day',
  week: 'Week',
  two_weeks: '2 weeks',
  month: 'Month',
  quarter: 'Quarter',
  six_months: '6 months',
  year: 'Year',
  two_years: '2 years',
  five_years: '5 years',
}
const activeZoom = ref<TimelineZoom>(normalizeTimelineZoom(timeline.value?.zoom))
const activeAnchor = ref(dayjs())
const selectedDate = ref(activeAnchor.value.format('YYYY-MM-DD'))
const loadedBefore = ref(1)
const loadedAfter = ref(1)
const maximumLoadedSpans = 6
const scrollContainer = ref<HTMLElement>()
let initialAnchorViewId: string | undefined

const activeWindow = computed(() => getTimelineWindow(activeAnchor.value, activeZoom.value))

const shiftBySpans = (anchor: Dayjs, count: number) => {
  let shifted = anchor
  const direction: -1 | 1 = count < 0 ? -1 : 1
  for (let index = 0; index < Math.abs(count); index += 1) {
    shifted = shiftTimelineAnchor(shifted, activeZoom.value, direction)
  }
  return shifted
}

const loadedWindow = computed(() => ({
  start: getTimelineWindow(shiftBySpans(activeAnchor.value, -loadedBefore.value), activeZoom.value).start,
  end: getTimelineWindow(shiftBySpans(activeAnchor.value, loadedAfter.value), activeZoom.value).end,
}))
const axis = computed(() => createTimelineAxis(loadedWindow.value.start, loadedWindow.value.end, activeZoom.value))
const axisWidth = computed(() => getTimelineAxisWidth(axis.value))

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
    const end = parseDate(getFieldValue(record, endField.value))
    const geometry = getTimelineBarGeometry(start, end, axis.value)
    if (!geometry) return []

    return [{ record, index, start, end, ...geometry }]
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

const scrollToActiveWindow = async () => {
  await nextTick()
  if (scrollContainer.value) {
    scrollContainer.value.scrollLeft = getTimelinePosition(activeWindow.value.start, axis.value)
  }
}

const resetLoadedWindow = async () => {
  loadedBefore.value = 1
  loadedAfter.value = 1
  selectedDate.value = activeAnchor.value.format('YYYY-MM-DD')
  await scrollToActiveWindow()
}

const goToDate = async (date: Dayjs) => {
  activeAnchor.value = date
  await resetLoadedWindow()
}

const goToSelectedDate = async () => {
  const parsed = dayjs(selectedDate.value)
  if (parsed.isValid()) await goToDate(parsed)
}

const moveWindow = async (direction: -1 | 1) => {
  await goToDate(shiftTimelineAnchor(activeAnchor.value, activeZoom.value, direction))
}

const changeZoom = async () => {
  activeZoom.value = normalizeTimelineZoom(activeZoom.value)
  await resetLoadedWindow()
  if (view.value?.id && isViewOperationsAllowed.value) {
    await updateViewMeta(view.value.id, ViewTypes.TIMELINE, { zoom: activeZoom.value })
  }
}

const onHorizontalScroll = async () => {
  const container = scrollContainer.value
  if (!container) return

  if (container.scrollLeft < 160 && loadedBefore.value < maximumLoadedSpans) {
    const previousWidth = axisWidth.value
    loadedBefore.value += 1
    await nextTick()
    container.scrollLeft += axisWidth.value - previousWidth
  } else if (
    container.scrollWidth - container.clientWidth - container.scrollLeft < 240 &&
    loadedAfter.value < maximumLoadedSpans
  ) {
    loadedAfter.value += 1
  }
}

const applyInitialAnchor = async () => {
  if (initialAnchorViewId === view.value?.id) return
  initialAnchorViewId = view.value?.id
  if (timeline.value?.initial_mode === 'closest_record') {
    const starts = formattedData.value
      .map((record) => parseDate(getFieldValue(record, startField.value)))
      .filter((date): date is Dayjs => Boolean(date))
      .sort((first, second) => Math.abs(first.diff(dayjs())) - Math.abs(second.diff(dayjs())))
    if (starts[0]) activeAnchor.value = starts[0]
  } else {
    activeAnchor.value = dayjs()
  }
  await resetLoadedWindow()
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
    if (id && view.value?.type === ViewTypes.TIMELINE) {
      activeZoom.value = normalizeTimelineZoom(timeline.value?.zoom)
      await reload()
      await applyInitialAnchor()
    }
  },
  { immediate: true },
)

watch(
  () => timeline.value?.zoom,
  async (zoom) => {
    const normalized = normalizeTimelineZoom(zoom)
    if (normalized !== activeZoom.value) {
      activeZoom.value = normalized
      await resetLoadedWindow()
    }
  },
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
    <div
      class="flex flex-wrap items-center justify-between gap-2 border-b border-nc-border-gray-medium bg-nc-bg-default px-4 py-2"
    >
      <div class="flex min-w-0 items-center gap-2">
        <GeneralViewIcon :meta="{ type: ViewTypes.TIMELINE }" />
        <button
          type="button"
          class="rounded border border-nc-border-gray-medium px-2 py-1 hover:bg-nc-bg-gray-light"
          aria-label="Previous timeline span"
          data-testid="nc-timeline-previous"
          @click="moveWindow(-1)"
        >
          ←
        </button>
        <button
          type="button"
          class="rounded border border-nc-border-gray-medium px-2 py-1 hover:bg-nc-bg-gray-light"
          aria-label="Next timeline span"
          data-testid="nc-timeline-next"
          @click="moveWindow(1)"
        >
          →
        </button>
        <button
          type="button"
          class="rounded border border-nc-border-gray-medium px-2 py-1 text-small hover:bg-nc-bg-gray-light"
          data-testid="nc-timeline-today"
          @click="goToDate(dayjs())"
        >
          Today
        </button>
        <input
          v-model="selectedDate"
          type="date"
          class="h-8 rounded border border-nc-border-gray-medium bg-nc-bg-default px-2 text-small"
          aria-label="Timeline date"
          data-testid="nc-timeline-date"
          @change="goToSelectedDate"
        />
        <span class="truncate font-medium text-nc-content-gray-emphasis">{{
          formatTimelineWindow(activeWindow, activeZoom)
        }}</span>
        <span class="rounded-full bg-nc-bg-gray-medium px-2 py-0.5 text-small text-nc-content-gray-subtle"
          >{{ undatedCount }} undated</span
        >
      </div>
      <label class="flex items-center gap-2 text-small text-nc-content-gray-subtle">
        Scale
        <select
          v-model="activeZoom"
          class="h-8 rounded border border-nc-border-gray-medium bg-nc-bg-default px-2 text-nc-content-gray-emphasis"
          data-testid="nc-timeline-zoom"
          @change="changeZoom"
        >
          <option v-for="zoom in TIMELINE_ZOOMS" :key="zoom" :value="zoom">{{ zoomLabels[zoom] }}</option>
        </select>
      </label>
    </div>

    <div v-if="isViewDataLoading || isPaginationLoading" class="flex-1 p-5" aria-busy="true">
      <a-skeleton active :paragraph="{ rows: 8 }" />
    </div>
    <div v-else-if="!startField" class="flex flex-1 items-center justify-center text-nc-content-gray-subtle">
      Timeline start field is unavailable.
    </div>

    <div v-else ref="scrollContainer" class="min-h-0 flex-1 overflow-auto" @scroll.passive="onHorizontalScroll">
      <div class="min-w-max" :style="{ width: `${axisWidth + 240}px` }">
        <div class="sticky top-0 z-20 flex h-14 border-b border-nc-border-gray-medium bg-nc-bg-default">
          <div
            class="sticky left-0 z-30 flex w-60 shrink-0 items-center border-r border-nc-border-gray-medium bg-nc-bg-default px-4 font-medium"
          >
            Record
          </div>
          <div class="flex" :style="{ width: `${axisWidth}px` }">
            <div
              v-for="bucket in axis"
              :key="bucket.key"
              class="flex shrink-0 flex-col items-center justify-center overflow-hidden border-r border-nc-border-gray-light text-small"
              :class="
                dayjs().isAfter(bucket.start) && dayjs().isBefore(bucket.end)
                  ? 'bg-nc-bg-brand text-nc-content-brand'
                  : 'text-nc-content-gray-subtle'
              "
              :style="{ width: `${bucket.width}px` }"
              :title="`${bucket.secondaryLabel ?? ''} ${bucket.label}`"
            >
              <span class="whitespace-nowrap font-medium">{{ bucket.label }}</span>
              <span v-if="bucket.width >= 48" class="max-w-full truncate px-1 text-[10px]">{{ bucket.secondaryLabel }}</span>
            </div>
          </div>
        </div>

        <div v-if="!datedRecords.length" class="flex h-48 items-center justify-center text-nc-content-gray-subtle">
          No dated records in the loaded timeline range.
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
                v-for="bucket in axis"
                :key="bucket.key"
                class="shrink-0 border-r border-nc-border-gray-light"
                :style="{ width: `${bucket.width}px` }"
              />
            </div>
            <div
              role="button"
              tabindex="0"
              class="absolute top-2.5 z-10 flex h-9 items-center truncate rounded-md bg-teal-600 px-2 text-left text-small font-medium text-white shadow-sm hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              :class="{ '!bg-nc-content-red-medium': item.invalidRange }"
              :style="{ left: `${item.left}px`, width: `${item.width}px` }"
              :title="
                item.invalidRange
                  ? 'End date precedes start date'
                  : `${item.start.format('YYYY-MM-DD')} – ${item.end?.format('YYYY-MM-DD') ?? item.start.format('YYYY-MM-DD')}`
              "
              @click="openRecord(item.record)"
              @keydown.enter="openRecord(item.record)"
              @keydown.space.prevent="openRecord(item.record)"
            >
              <span
                v-if="item.clippedBefore"
                class="mr-1 shrink-0 rounded bg-black/20 px-1"
                title="Navigate to start date"
                role="button"
                tabindex="0"
                aria-label="Navigate to record start date"
                @click.stop="goToDate(item.start)"
                @keydown.enter.stop="goToDate(item.start)"
                >←</span
              >
              <span class="truncate">{{ displayField ? item.record.row[displayField.title!] : 'Record' }}</span>
              <span
                v-if="item.clippedAfter"
                class="ml-auto shrink-0 rounded bg-black/20 px-1"
                title="Navigate to end date"
                role="button"
                tabindex="0"
                aria-label="Navigate to record end date"
                @click.stop="goToDate(item.end ?? item.start)"
                @keydown.enter.stop="goToDate(item.end ?? item.start)"
                >→</span
              >
            </div>
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
