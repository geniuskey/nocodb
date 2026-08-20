<script lang="ts" setup>
import dayjs from 'dayjs'
import { type ColumnType, type PaginatedType, type TimelineType, UITypes, ViewTypes } from 'nocodb-sdk'
import {
  TIMELINE_PIXELS_PER_DAY,
  TIMELINE_WINDOW_DAYS,
  type TimelineZoom,
  layoutTimelineItems,
  timelineLaneCount,
} from '~/utils/timelineView'

const DAY_MS = 24 * 60 * 60 * 1000
const LANE_HEIGHT = 44

const meta = inject(MetaInj, ref())
const view = inject(ActiveViewInj, ref())
const reloadViewDataHook = inject(ReloadViewDataHookInj)

const { $api } = useNuxtApp()
const { xWhere, isLocked } = useSmartsheetStoreOrThrow()
const { isUIAllowed } = useRoles()
const { updateViewMeta } = useViewsStore()

const settings = ref<TimelineType>()
const records = ref<Record<string, any>[]>([])
const pageInfo = ref<PaginatedType>()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const settingsOpen = ref(false)

const zoom = computed<TimelineZoom>(() => settings.value?.zoom || 'week')
const windowDays = computed(() => TIMELINE_WINDOW_DAYS[zoom.value])
const pixelsPerDay = computed(() => TIMELINE_PIXELS_PER_DAY[zoom.value])
const rangeStart = ref(dayjs().startOf('day').subtract(21, 'day'))
const rangeEnd = computed(() => rangeStart.value.add(windowDays.value, 'day'))
const canvasWidth = computed(() => windowDays.value * pixelsPerDay.value)

const columns = computed(() => meta.value?.columns || [])
const dateColumns = computed(() =>
  columns.value.filter((column: ColumnType) => [UITypes.Date, UITypes.DateTime].includes(column.uidt)),
)
const titleColumns = computed(() =>
  columns.value.filter((column: ColumnType) => ![UITypes.Attachment, UITypes.Barcode, UITypes.QrCode].includes(column.uidt)),
)

const columnById = (id?: string | null) => columns.value.find((column: ColumnType) => column.id === id)
const columnKey = (id?: string | null) => columnById(id)?.title

const startKey = computed(() => columnKey(settings.value?.fk_start_column_id))
const endKey = computed(() => columnKey(settings.value?.fk_end_column_id))
const titleKey = computed(() => columnKey(settings.value?.fk_title_column_id))

const draft = reactive<{
  fk_title_column_id: string | null
  fk_start_column_id: string | null
  fk_end_column_id: string | null
  zoom: TimelineZoom
}>({
  fk_title_column_id: null,
  fk_start_column_id: null,
  fk_end_column_id: null,
  zoom: 'week',
})

const syncDraft = () => {
  draft.fk_title_column_id = settings.value?.fk_title_column_id || null
  draft.fk_start_column_id = settings.value?.fk_start_column_id || null
  draft.fk_end_column_id = settings.value?.fk_end_column_id || null
  draft.zoom = settings.value?.zoom || 'week'
}

const resetWindow = (nextZoom: TimelineZoom = zoom.value, previousWindowDays = windowDays.value) => {
  const center = rangeStart.value.add(previousWindowDays / 2, 'day')
  rangeStart.value = center.subtract(TIMELINE_WINDOW_DAYS[nextZoom] / 2, 'day').startOf('day')
}

const loadSettings = async () => {
  if (!view.value?.id) return
  const previousWindowDays = windowDays.value
  settings.value = await $api.dbView.timelineRead(view.value.id)
  syncDraft()
  resetWindow(settings.value?.zoom || 'week', previousWindowDays)
}

const loadRecords = async () => {
  if (!view.value?.id || !settings.value?.fk_start_column_id) {
    records.value = []
    return
  }

  loading.value = true
  error.value = ''
  try {
    const response = await $api.dbTimelineViewRow.list(view.value.id, {
      from: rangeStart.value.format('YYYY-MM-DD'),
      to: rangeEnd.value.format('YYYY-MM-DD'),
      limit: 1000,
      ...(xWhere.value ? { where: xWhere.value } : {}),
    })
    records.value = response.list || []
    pageInfo.value = response.pageInfo
  } catch (e: any) {
    records.value = []
    error.value = await extractSdkResponseErrorMsg(e)
  } finally {
    loading.value = false
  }
}

const parseStart = (value: unknown) => {
  const parsed = dayjs(value as any)
  return parsed.isValid() ? parsed.valueOf() : undefined
}

const parseEnd = (value: unknown, fallback: number) => {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = dayjs(value as any)
  if (!parsed.isValid()) return fallback
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? parsed.add(1, 'day').valueOf() : parsed.valueOf()
}

const layout = computed(() => {
  if (!startKey.value) return []
  const from = rangeStart.value.valueOf()
  const to = rangeEnd.value.valueOf()

  return layoutTimelineItems(
    records.value.flatMap((record, index) => {
      const start = parseStart(record[startKey.value!])
      if (start === undefined) return []
      const end = Math.max(parseEnd(endKey.value ? record[endKey.value] : undefined, start), start)
      return [
        {
          id: String(extractPkFromRow(record, columns.value as ColumnType[]) ?? index),
          start: Math.max(start, from),
          end: Math.min(Math.max(end, start + 1), to),
          record,
        },
      ]
    }),
  )
})

const canvasHeight = computed(() => Math.max(240, timelineLaneCount(layout.value) * LANE_HEIGHT + 32))

const itemStyle = (item: (typeof layout.value)[number]) => ({
  left: `${((item.start - rangeStart.value.valueOf()) / DAY_MS) * pixelsPerDay.value}px`,
  top: `${item.lane * LANE_HEIGHT + 16}px`,
  width: `${Math.max(14, ((item.end - item.start) / DAY_MS) * pixelsPerDay.value)}px`,
})

const itemTitle = (record: Record<string, any>) => {
  const value = titleKey.value ? record[titleKey.value] : undefined
  return value === null || value === undefined || value === '' ? 'Untitled record' : String(value)
}

const headerLabel = (index: number) => {
  const date = rangeStart.value.add(index, 'day')
  if (zoom.value === 'day') return date.format('ddd D')
  if (zoom.value === 'week') return date.day() === 1 ? date.format('MMM D') : ''
  return date.date() === 1 ? date.format(zoom.value === 'quarter' ? 'MMM YYYY' : 'MMM') : ''
}

const moveWindow = (direction: -1 | 1) => {
  rangeStart.value = rangeStart.value.add(direction * windowDays.value, 'day')
}

const goToday = () => {
  rangeStart.value = dayjs()
    .startOf('day')
    .subtract(Math.floor(windowDays.value / 2), 'day')
}

const saveSettings = async () => {
  if (!view.value?.id || !draft.fk_start_column_id) return
  saving.value = true
  error.value = ''
  const previousZoom = zoom.value
  const previousWindowDays = windowDays.value
  try {
    await updateViewMeta(view.value.id, ViewTypes.TIMELINE, { ...draft })
    settings.value = await $api.dbView.timelineRead(view.value.id)
    if (previousZoom !== draft.zoom) resetWindow(draft.zoom, previousWindowDays)
    settingsOpen.value = false
    await loadRecords()
  } catch (e: any) {
    error.value = await extractSdkResponseErrorMsg(e)
  } finally {
    saving.value = false
  }
}

const canConfigure = computed(() => !isLocked.value && isUIAllowed('viewCreateOrEdit'))

watch([rangeStart, xWhere], loadRecords)

const reloadListener = () => loadRecords()
reloadViewDataHook?.on(reloadListener)

onMounted(async () => {
  await loadSettings()
  await loadRecords()
})

onBeforeUnmount(() => reloadViewDataHook?.off(reloadListener))
</script>

<template>
  <div class="nc-timeline flex h-full min-w-0 flex-col bg-nc-bg-default" data-testid="nc-timeline-wrapper">
    <div class="flex min-h-12 items-center justify-between gap-3 border-b border-nc-border-gray-medium bg-white px-3 py-2">
      <div class="flex items-center gap-2">
        <NcButton size="small" type="secondary" data-testid="nc-timeline-previous" @click="moveWindow(-1)">
          <GeneralIcon icon="chevronLeft" />
        </NcButton>
        <NcButton size="small" type="secondary" data-testid="nc-timeline-today" @click="goToday">Today</NcButton>
        <NcButton size="small" type="secondary" data-testid="nc-timeline-next" @click="moveWindow(1)">
          <GeneralIcon icon="chevronRight" />
        </NcButton>
        <span class="ml-2 text-sm font-medium text-nc-content-gray" data-testid="nc-timeline-range-label">
          {{ rangeStart.format('MMM D, YYYY') }} – {{ rangeEnd.subtract(1, 'day').format('MMM D, YYYY') }}
        </span>
        <span class="rounded bg-nc-bg-gray-light px-2 py-1 text-xs capitalize text-nc-content-gray-muted">{{ zoom }}</span>
      </div>

      <NcButton
        v-if="canConfigure"
        size="small"
        type="secondary"
        data-testid="nc-timeline-settings-toggle"
        @click="settingsOpen = !settingsOpen"
      >
        <GeneralIcon icon="settings" />
        Settings
      </NcButton>
    </div>

    <div
      v-if="settingsOpen"
      class="grid grid-cols-4 gap-3 border-b border-nc-border-gray-medium bg-white p-3"
      data-testid="nc-timeline-settings"
    >
      <label class="flex flex-col gap-1 text-xs text-nc-content-gray-muted">
        Start field
        <a-select v-model:value="draft.fk_start_column_id" size="small" data-testid="nc-timeline-settings-start">
          <a-select-option v-for="column in dateColumns" :key="column.id" :value="column.id">{{ column.title }}</a-select-option>
        </a-select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-nc-content-gray-muted">
        End field
        <a-select v-model:value="draft.fk_end_column_id" allow-clear size="small" data-testid="nc-timeline-settings-end">
          <a-select-option v-for="column in dateColumns" :key="column.id" :value="column.id">{{ column.title }}</a-select-option>
        </a-select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-nc-content-gray-muted">
        Title field
        <a-select v-model:value="draft.fk_title_column_id" allow-clear size="small" data-testid="nc-timeline-settings-title">
          <a-select-option v-for="column in titleColumns" :key="column.id" :value="column.id">{{ column.title }}</a-select-option>
        </a-select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-nc-content-gray-muted">
        Zoom
        <div class="flex gap-2">
          <a-select v-model:value="draft.zoom" class="flex-1" size="small" data-testid="nc-timeline-settings-zoom">
            <a-select-option v-for="value in ['day', 'week', 'month', 'quarter']" :key="value" :value="value">
              <span class="capitalize">{{ value }}</span>
            </a-select-option>
          </a-select>
          <NcButton
            size="small"
            :loading="saving"
            :disabled="!draft.fk_start_column_id"
            data-testid="nc-timeline-settings-save"
            @click="saveSettings"
            >Save</NcButton
          >
        </div>
      </label>
    </div>

    <div v-if="error" class="border-b border-nc-border-red bg-nc-bg-red-light px-4 py-2 text-sm text-nc-content-red-dark">
      {{ error }}
    </div>

    <div v-if="!settings?.fk_start_column_id" class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <GeneralViewIcon :meta="{ type: ViewTypes.TIMELINE }" class="text-4xl" />
      <div class="font-semibold text-nc-content-gray">Choose a start field to display this Timeline.</div>
      <NcButton v-if="canConfigure" data-testid="nc-timeline-configure-empty" @click="settingsOpen = true"
        >Configure Timeline</NcButton
      >
    </div>

    <div v-else class="relative flex-1 overflow-auto" data-testid="nc-timeline-scroll-region">
      <div
        class="sticky top-0 z-20 flex h-9 border-b border-nc-border-gray-medium bg-white"
        :style="{ width: `${canvasWidth}px` }"
      >
        <div
          v-for="index in windowDays"
          :key="index"
          class="h-full shrink-0 overflow-visible border-r border-nc-border-gray-light px-1 py-2 text-[11px] text-nc-content-gray-muted"
          :style="{ width: `${pixelsPerDay}px` }"
        >
          <span class="whitespace-nowrap">{{ headerLabel(index - 1) }}</span>
        </div>
      </div>

      <div
        class="relative bg-white"
        :style="{
          width: `${canvasWidth}px`,
          height: `${canvasHeight}px`,
          backgroundImage: 'linear-gradient(to right, #e7e7e9 1px, transparent 1px)',
          backgroundSize: `${pixelsPerDay}px 100%`,
        }"
      >
        <div v-if="loading" class="sticky left-0 flex h-48 w-full items-center justify-center">
          <GeneralLoader size="large" />
        </div>
        <template v-else>
          <div
            v-for="item in layout"
            :key="item.id"
            class="absolute h-8 overflow-hidden rounded-md border border-blue-300 bg-blue-100 px-2 py-1 text-xs text-blue-900 shadow-sm"
            :style="itemStyle(item)"
            :title="itemTitle(item.record)"
            data-testid="nc-timeline-item"
          >
            <span class="block truncate font-medium">{{ itemTitle(item.record) }}</span>
          </div>
          <div
            v-if="!layout.length"
            class="sticky left-0 flex h-48 w-full items-center justify-center text-sm text-nc-content-gray-muted"
          >
            No records in this range.
          </div>
        </template>
      </div>
    </div>

    <div
      v-if="(pageInfo?.totalRows || 0) > records.length"
      class="border-t border-nc-border-gray-medium bg-white px-3 py-1 text-xs text-nc-content-gray-muted"
    >
      Showing the first {{ records.length }} matching records in this range. Narrow the range or filters to see more.
    </div>
  </div>
</template>
