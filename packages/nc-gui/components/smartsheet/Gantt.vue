<script lang="ts" setup>
import dayjs from 'dayjs'
import { type ColumnType, type GanttType, type PaginatedType, UITypes, ViewTypes } from 'nocodb-sdk'
import { isGanttMilestone, layoutGanttTasks, normalizeGanttProgress } from '~/utils/ganttView'
import {
  TIMELINE_PIXELS_PER_DAY,
  TIMELINE_WINDOW_DAYS,
  type TimelineMutationPatch,
  type TimelineZoom,
  buildTimelineEndResizePatch,
  buildTimelineReschedulePatch,
  buildTimelineStartResizePatch,
  timelineVirtualRange,
} from '~/utils/timelineView'

const DAY_MS = 24 * 60 * 60 * 1000
const TASK_TABLE_WIDTH = 288
const HEADER_HEIGHT = 36
const ROW_HEIGHT = 44
const ROW_OVERSCAN = 4
const DAY_OVERSCAN = 160

const meta = inject(MetaInj, ref())
const view = inject(ActiveViewInj, ref())
const reloadViewDataHook = inject(ReloadViewDataHookInj)

const { $api } = useNuxtApp()
const { xWhere, isLocked, isSqlView, isSyncedTable } = useSmartsheetStoreOrThrow()
const { isUIAllowed } = useRoles()
const { updateViewMeta } = useViewsStore()
const { addUndo, defineViewScope } = useUndoRedo()
const { t } = useI18n()

const settings = ref<GanttType>()
const records = ref<Record<string, any>[]>([])
const pageInfo = ref<PaginatedType>()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const settingsOpen = ref(false)
const savingRecordId = ref<string>()
const announcement = ref('')

const zoom = computed<TimelineZoom>(() => settings.value?.zoom || 'week')
const windowDays = computed(() => TIMELINE_WINDOW_DAYS[zoom.value])
const pixelsPerDay = computed(() => TIMELINE_PIXELS_PER_DAY[zoom.value])
const rangeStart = ref(dayjs().startOf('day').subtract(21, 'day'))
const rangeEnd = computed(() => rangeStart.value.add(windowDays.value, 'day'))
const chartWidth = computed(() => windowDays.value * pixelsPerDay.value)
const totalWidth = computed(() => TASK_TABLE_WIDTH + chartWidth.value)

const columns = computed(() => meta.value?.columns || [])
const dateColumns = computed(() =>
  columns.value.filter((column: ColumnType) => [UITypes.Date, UITypes.DateTime].includes(column.uidt)),
)
const titleColumns = computed(() =>
  columns.value.filter((column: ColumnType) => ![UITypes.Attachment, UITypes.Barcode, UITypes.QrCode].includes(column.uidt)),
)
const progressColumns = computed(() =>
  columns.value.filter((column: ColumnType) => [UITypes.Number, UITypes.Decimal, UITypes.Percent].includes(column.uidt)),
)
const milestoneColumns = computed(() => columns.value.filter((column: ColumnType) => column.uidt === UITypes.Checkbox))

const columnById = (id?: string | null) => columns.value.find((column: ColumnType) => column.id === id)
const columnKey = (id?: string | null) => columnById(id)?.title
const startKey = computed(() => columnKey(settings.value?.fk_start_column_id))
const endKey = computed(() => columnKey(settings.value?.fk_end_column_id))
const titleKey = computed(() => columnKey(settings.value?.fk_title_column_id))
const progressKey = computed(() => columnKey(settings.value?.fk_progress_column_id))
const milestoneKey = computed(() => columnKey(settings.value?.fk_milestone_column_id))
const startColumn = computed(() => columnById(settings.value?.fk_start_column_id))
const endColumn = computed(() => columnById(settings.value?.fk_end_column_id))

const draft = reactive<{
  fk_title_column_id: string | null
  fk_start_column_id: string | null
  fk_end_column_id: string | null
  fk_progress_column_id: string | null
  fk_milestone_column_id: string | null
  zoom: TimelineZoom
}>({
  fk_title_column_id: null,
  fk_start_column_id: null,
  fk_end_column_id: null,
  fk_progress_column_id: null,
  fk_milestone_column_id: null,
  zoom: 'week',
})

const syncDraft = () => {
  draft.fk_title_column_id = settings.value?.fk_title_column_id || null
  draft.fk_start_column_id = settings.value?.fk_start_column_id || null
  draft.fk_end_column_id = settings.value?.fk_end_column_id || null
  draft.fk_progress_column_id = settings.value?.fk_progress_column_id || null
  draft.fk_milestone_column_id = settings.value?.fk_milestone_column_id || null
  draft.zoom = settings.value?.zoom || 'week'
}

const resetWindow = (nextZoom: TimelineZoom = zoom.value, previousWindowDays = windowDays.value) => {
  const center = rangeStart.value.add(previousWindowDays / 2, 'day')
  rangeStart.value = center.subtract(TIMELINE_WINDOW_DAYS[nextZoom] / 2, 'day').startOf('day')
}

const loadSettings = async () => {
  if (!view.value?.id) return
  const previousWindowDays = windowDays.value
  settings.value = await $api.dbView.ganttRead(view.value.id)
  syncDraft()
  resetWindow(settings.value?.zoom || 'week', previousWindowDays)
}

const loadRecords = async () => {
  if (!view.value?.id || !settings.value?.fk_start_column_id || !settings.value?.fk_end_column_id) {
    records.value = []
    return
  }

  loading.value = true
  error.value = ''
  try {
    const response = await $api.dbGanttViewRow.list(view.value.id, {
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

const tasks = computed(() => {
  if (!startKey.value || !endKey.value) return []
  const from = rangeStart.value.valueOf()
  const to = rangeEnd.value.valueOf()

  return layoutGanttTasks(
    records.value.flatMap((record, index) => {
      const start = parseStart(record[startKey.value!])
      const end = parseEnd(record[endKey.value!], start ?? Number.NaN)
      if (start === undefined || !Number.isFinite(end)) return []
      return [
        {
          id: String(extractPkFromRow(record, columns.value as ColumnType[]) ?? index),
          start: Math.max(start, from),
          end: Math.min(Math.max(end, start + 1), to),
          record,
          milestone: milestoneKey.value ? isGanttMilestone(record[milestoneKey.value]) : false,
          progress: progressKey.value ? normalizeGanttProgress(record[progressKey.value]) : undefined,
        },
      ]
    }),
  )
})

const canvasHeight = computed(() => Math.max(240, tasks.value.length * ROW_HEIGHT))
const scrollRegion = ref<HTMLElement>()
const scrollLeft = ref(0)
const scrollTop = ref(0)
const viewportWidth = ref(0)
const viewportHeight = ref(0)
const focusedItemId = ref<string>()
const dragState = ref<{ itemId: string; pointerId: number; startX: number; deltaDays: number }>()
const resizeState = ref<{ itemId: string; pointerId: number; startX: number; deltaDays: number }>()
const startResizeState = ref<{ itemId: string; pointerId: number; startX: number; deltaDays: number }>()

const syncViewport = () => {
  const element = scrollRegion.value
  if (!element) return
  scrollLeft.value = element.scrollLeft
  scrollTop.value = element.scrollTop
  viewportWidth.value = element.clientWidth
  viewportHeight.value = Math.max(0, element.clientHeight - HEADER_HEIGHT)
}

const onScroll = (event: Event) => {
  const element = event.currentTarget as HTMLElement
  scrollLeft.value = element.scrollLeft
  scrollTop.value = element.scrollTop
}

useResizeObserver(scrollRegion, syncViewport)

const visibleRows = computed(() => {
  const { start, end } = timelineVirtualRange(
    tasks.value.length,
    ROW_HEIGHT,
    Math.max(0, scrollTop.value - HEADER_HEIGHT),
    viewportHeight.value,
    ROW_HEIGHT * ROW_OVERSCAN,
  )
  const visible = tasks.value.slice(start, end)
  const pinnedId = focusedItemId.value || dragState.value?.itemId || resizeState.value?.itemId || startResizeState.value?.itemId
  if (!pinnedId || visible.some((task) => task.id === pinnedId)) return visible
  const pinned = tasks.value.find((task) => task.id === pinnedId)
  return pinned ? [...visible, pinned] : visible
})

const visibleDayIndexes = computed(() => {
  const chartOffset = Math.max(0, scrollLeft.value - TASK_TABLE_WIDTH)
  const chartViewport = Math.max(0, viewportWidth.value - TASK_TABLE_WIDTH)
  const { start, end } = timelineVirtualRange(windowDays.value, pixelsPerDay.value, chartOffset, chartViewport, DAY_OVERSCAN)
  return Array.from({ length: end - start }, (_, offset) => start + offset)
})

type GanttTaskRecord = (typeof tasks.value)[number]

const taskGeometry = (task: GanttTaskRecord) => {
  const moveDays = dragState.value?.itemId === task.id ? dragState.value.deltaDays : 0
  const endDays = resizeState.value?.itemId === task.id ? resizeState.value.deltaDays : 0
  const startDays = startResizeState.value?.itemId === task.id ? startResizeState.value.deltaDays : 0
  const width = ((task.end - task.start) / DAY_MS) * pixelsPerDay.value
  return {
    left: `${
      TASK_TABLE_WIDTH + ((task.start - rangeStart.value.valueOf()) / DAY_MS + moveDays + startDays) * pixelsPerDay.value
    }px`,
    top: `${task.row * ROW_HEIGHT + 6}px`,
    width: `${Math.max(18, width + (endDays - startDays) * pixelsPerDay.value)}px`,
  }
}

const taskTitle = (record: Record<string, any>) => {
  const value = titleKey.value ? record[titleKey.value] : undefined
  return value === null || value === undefined || value === '' ? 'Untitled task' : String(value)
}

const headerLabel = (index: number) => {
  const date = rangeStart.value.add(index, 'day')
  if (zoom.value === 'day') return date.format('ddd D')
  if (zoom.value === 'week') return date.day() === 1 ? date.format('MMM D') : ''
  return date.date() === 1 ? date.format(zoom.value === 'quarter' ? 'MMM YYYY' : 'MMM') : ''
}

const canReschedule = computed(
  () =>
    isUIAllowed('dataEdit') &&
    !isLocked.value &&
    !isSqlView.value &&
    !isSyncedTable.value &&
    !!startColumn.value &&
    !!endColumn.value &&
    !startColumn.value.readonly &&
    !endColumn.value.readonly,
)

const canResizeEnd = computed(
  () =>
    canReschedule.value &&
    !!startColumn.value?.title &&
    !!endColumn.value?.title &&
    startColumn.value.title !== endColumn.value.title,
)

const patchRecordByPk = async (primaryKey: string, values: Record<string, unknown>) => {
  if (!meta.value?.base_id || !meta.value?.id || !view.value?.id) throw new Error('Gantt row context is unavailable.')
  const updated = await $api.dbViewRow.update(
    NOCO,
    meta.value.base_id,
    meta.value.id,
    view.value.id,
    encodeURIComponent(primaryKey),
    values,
  )
  const target = records.value.find((record) => extractPkFromRow(record, columns.value as ColumnType[]) === primaryKey)
  if (target) Object.assign(target, updated)
  return updated
}

const applyHistoryPatch = async (primaryKey: string, values: Record<string, unknown>) => {
  await patchRecordByPk(primaryKey, values)
  await loadRecords()
}

const applyMutation = async (task: GanttTaskRecord, patch: TimelineMutationPatch, successText: string) => {
  const primaryKey = extractPkFromRow(task.record, columns.value as ColumnType[])
  if (primaryKey === null || primaryKey === undefined) return
  const recordId = String(primaryKey)
  savingRecordId.value = recordId
  Object.assign(task.record, patch.next)
  try {
    await patchRecordByPk(recordId, patch.next)
    addUndo({
      redo: { fn: applyHistoryPatch, args: [recordId, { ...patch.next }] },
      undo: { fn: applyHistoryPatch, args: [recordId, { ...patch.previous }] },
      scope: defineViewScope({ view: view.value }),
    })
    await loadRecords()
    announcement.value = `${taskTitle(task.record)} ${successText}.`
  } catch (e: any) {
    Object.assign(task.record, patch.previous)
    const messageText = await extractSdkResponseErrorMsg(e)
    announcement.value = `Gantt update failed: ${messageText}`
    message.error(`${t('msg.error.rowUpdateFailed')}: ${messageText}`)
  } finally {
    savingRecordId.value = undefined
  }
}

const rescheduleByDays = async (task: GanttTaskRecord, deltaDays: number) => {
  if (!canReschedule.value || savingRecordId.value || !startColumn.value || !endColumn.value) return
  const patch = buildTimelineReschedulePatch(task.record, startColumn.value, endColumn.value, deltaDays)
  if (patch) await applyMutation(task, patch, `moved ${Math.abs(deltaDays)} day${Math.abs(deltaDays) === 1 ? '' : 's'}`)
}

const resizeByDays = async (task: GanttTaskRecord, deltaDays: number, edge: 'start' | 'end') => {
  if (!canResizeEnd.value || savingRecordId.value || !startColumn.value || !endColumn.value || task.milestone) return
  const patch =
    edge === 'start'
      ? buildTimelineStartResizePatch(task.record, startColumn.value, endColumn.value, deltaDays)
      : buildTimelineEndResizePatch(task.record, startColumn.value, endColumn.value, deltaDays)
  if (!patch) {
    announcement.value = 'Gantt task duration must not be negative.'
    return
  }
  await applyMutation(task, patch, `${edge} resized by ${Math.abs(deltaDays)} day${Math.abs(deltaDays) === 1 ? '' : 's'}`)
}

const beginPointer = (event: PointerEvent, task: GanttTaskRecord, edge?: 'start' | 'end') => {
  if (!canReschedule.value || savingRecordId.value || event.button !== 0) return
  event.preventDefault()
  const state = { itemId: task.id, pointerId: event.pointerId, startX: event.clientX, deltaDays: 0 }
  if (edge === 'start') startResizeState.value = state
  else if (edge === 'end') resizeState.value = state
  else dragState.value = state
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const movePointer = (event: PointerEvent) => {
  const state = dragState.value || resizeState.value || startResizeState.value
  if (!state || state.pointerId !== event.pointerId) return
  state.deltaDays = Math.round((event.clientX - state.startX) / pixelsPerDay.value)
}

const finishPointer = async (event: PointerEvent, task: GanttTaskRecord) => {
  const drag = dragState.value
  const end = resizeState.value
  const start = startResizeState.value
  if (drag?.pointerId === event.pointerId) {
    dragState.value = undefined
    if (drag.deltaDays) await rescheduleByDays(task, drag.deltaDays)
  } else if (end?.pointerId === event.pointerId) {
    resizeState.value = undefined
    if (end.deltaDays) await resizeByDays(task, end.deltaDays, 'end')
  } else if (start?.pointerId === event.pointerId) {
    startResizeState.value = undefined
    if (start.deltaDays) await resizeByDays(task, start.deltaDays, 'start')
  }
}

const cancelPointer = (event: PointerEvent) => {
  if (dragState.value?.pointerId === event.pointerId) dragState.value = undefined
  if (resizeState.value?.pointerId === event.pointerId) resizeState.value = undefined
  if (startResizeState.value?.pointerId === event.pointerId) startResizeState.value = undefined
}

const handleKeydown = async (event: KeyboardEvent, task: GanttTaskRecord, edge?: 'start' | 'end') => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  const delta = event.key === 'ArrowLeft' ? -1 : 1
  if (edge) await resizeByDays(task, delta, edge)
  else await rescheduleByDays(task, delta)
}

const onTaskFocusOut = (event: FocusEvent) => {
  const task = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && task.contains(event.relatedTarget)) return
  focusedItemId.value = undefined
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
  if (!view.value?.id || !draft.fk_start_column_id || !draft.fk_end_column_id) return
  saving.value = true
  error.value = ''
  const previousZoom = zoom.value
  const previousWindowDays = windowDays.value
  try {
    await updateViewMeta(view.value.id, ViewTypes.GANTT, { ...draft })
    settings.value = await $api.dbView.ganttRead(view.value.id)
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
  await nextTick()
  syncViewport()
})

onBeforeUnmount(() => reloadViewDataHook?.off(reloadListener))
</script>

<template>
  <div class="nc-gantt flex h-full min-w-0 flex-col bg-nc-bg-default" data-testid="nc-gantt-wrapper">
    <span class="sr-only" aria-live="polite" data-testid="nc-gantt-announcement">{{ announcement }}</span>
    <div class="flex min-h-12 items-center justify-between gap-3 border-b border-nc-border-gray-medium bg-white px-3 py-2">
      <div class="flex items-center gap-2">
        <NcButton size="small" type="secondary" data-testid="nc-gantt-previous" @click="moveWindow(-1)">
          <GeneralIcon icon="chevronLeft" />
        </NcButton>
        <NcButton size="small" type="secondary" data-testid="nc-gantt-today" @click="goToday">Today</NcButton>
        <NcButton size="small" type="secondary" data-testid="nc-gantt-next" @click="moveWindow(1)">
          <GeneralIcon icon="chevronRight" />
        </NcButton>
        <span class="ml-2 text-sm font-medium text-nc-content-gray" data-testid="nc-gantt-range-label">
          {{ rangeStart.format('MMM D, YYYY') }} – {{ rangeEnd.subtract(1, 'day').format('MMM D, YYYY') }}
        </span>
      </div>
      <NcButton
        v-if="canConfigure"
        size="small"
        type="secondary"
        data-testid="nc-gantt-settings-toggle"
        @click="settingsOpen = !settingsOpen"
      >
        <GeneralIcon icon="settings" />
        Settings
      </NcButton>
    </div>

    <div
      v-if="settingsOpen"
      class="grid grid-cols-2 gap-3 border-b border-nc-border-gray-medium bg-white p-3 lg:grid-cols-6"
      data-testid="nc-gantt-settings"
    >
      <label class="text-xs font-medium text-nc-content-gray"
        >Start
        <a-select v-model:value="draft.fk_start_column_id" size="small" data-testid="nc-gantt-settings-start">
          <a-select-option v-for="column in dateColumns" :key="column.id" :value="column.id">{{ column.title }}</a-select-option>
        </a-select>
      </label>
      <label class="text-xs font-medium text-nc-content-gray"
        >End
        <a-select v-model:value="draft.fk_end_column_id" size="small" data-testid="nc-gantt-settings-end">
          <a-select-option v-for="column in dateColumns" :key="column.id" :value="column.id">{{ column.title }}</a-select-option>
        </a-select>
      </label>
      <label class="text-xs font-medium text-nc-content-gray"
        >Title
        <a-select v-model:value="draft.fk_title_column_id" allow-clear size="small" data-testid="nc-gantt-settings-title">
          <a-select-option v-for="column in titleColumns" :key="column.id" :value="column.id">{{ column.title }}</a-select-option>
        </a-select>
      </label>
      <label class="text-xs font-medium text-nc-content-gray"
        >Progress
        <a-select v-model:value="draft.fk_progress_column_id" allow-clear size="small" data-testid="nc-gantt-settings-progress">
          <a-select-option v-for="column in progressColumns" :key="column.id" :value="column.id">{{
            column.title
          }}</a-select-option>
        </a-select>
      </label>
      <label class="text-xs font-medium text-nc-content-gray"
        >Milestone
        <a-select v-model:value="draft.fk_milestone_column_id" allow-clear size="small" data-testid="nc-gantt-settings-milestone">
          <a-select-option v-for="column in milestoneColumns" :key="column.id" :value="column.id">{{
            column.title
          }}</a-select-option>
        </a-select>
      </label>
      <label class="text-xs font-medium text-nc-content-gray"
        >Zoom
        <div class="flex gap-2">
          <a-select v-model:value="draft.zoom" class="flex-1" size="small" data-testid="nc-gantt-settings-zoom">
            <a-select-option v-for="option in ['day', 'week', 'month', 'quarter']" :key="option" :value="option">{{
              option
            }}</a-select-option>
          </a-select>
          <NcButton
            size="small"
            type="primary"
            :disabled="saving || !draft.fk_start_column_id || !draft.fk_end_column_id"
            data-testid="nc-gantt-settings-save"
            @click="saveSettings"
            >Save</NcButton
          >
        </div>
      </label>
    </div>

    <div v-if="error" class="border-b border-nc-border-red bg-nc-bg-red-light px-4 py-2 text-sm text-nc-content-red-dark">
      {{ error }}
    </div>
    <div
      v-if="pageInfo?.totalRows && pageInfo.totalRows > records.length"
      class="border-b border-nc-border-gray-medium bg-nc-bg-gray-light px-4 py-2 text-xs text-nc-content-gray-muted"
    >
      Showing the first {{ records.length }} of {{ pageInfo.totalRows }} tasks in this window.
    </div>

    <div
      v-if="!settings?.fk_start_column_id || !settings?.fk_end_column_id"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <GeneralViewIcon :meta="{ type: ViewTypes.GANTT }" class="text-4xl" />
      <div class="font-semibold text-nc-content-gray">Choose start and end fields to display this Gantt.</div>
      <NcButton v-if="canConfigure" data-testid="nc-gantt-configure-empty" @click="settingsOpen = true">Configure Gantt</NcButton>
    </div>

    <div v-else ref="scrollRegion" class="relative flex-1 overflow-auto" data-testid="nc-gantt-scroll-region" @scroll="onScroll">
      <div
        class="sticky top-0 z-30 h-9 border-b border-nc-border-gray-medium bg-white"
        :style="{ width: `${totalWidth}px` }"
        data-testid="nc-gantt-header"
      >
        <div
          class="sticky left-0 z-40 flex h-full w-72 items-center border-r border-nc-border-gray-medium bg-white px-3 text-xs font-semibold text-nc-content-gray"
        >
          Task
        </div>
        <div
          v-for="index in visibleDayIndexes"
          :key="index"
          class="absolute top-0 h-full border-r border-nc-border-gray-light px-1 py-2 text-[11px] text-nc-content-gray-muted"
          :style="{ left: `${TASK_TABLE_WIDTH + index * pixelsPerDay}px`, width: `${pixelsPerDay}px` }"
          :data-day-index="index"
          data-testid="nc-gantt-day"
        >
          <span class="whitespace-nowrap">{{ headerLabel(index) }}</span>
        </div>
      </div>

      <div
        class="relative bg-white"
        :style="{
          width: `${totalWidth}px`,
          height: `${canvasHeight}px`,
          backgroundImage: `linear-gradient(to right, transparent ${TASK_TABLE_WIDTH - 1}px, #d9d9dc ${
            TASK_TABLE_WIDTH - 1
          }px, #d9d9dc ${TASK_TABLE_WIDTH}px, transparent ${TASK_TABLE_WIDTH}px), repeating-linear-gradient(to right, transparent 0, transparent ${
            pixelsPerDay - 1
          }px, #e7e7e9 ${pixelsPerDay - 1}px, #e7e7e9 ${pixelsPerDay}px)`,
          backgroundPosition: `0 0, ${TASK_TABLE_WIDTH}px 0`,
        }"
        :data-total-tasks="tasks.length"
        :data-rendered-tasks="visibleRows.length"
        data-testid="nc-gantt-canvas"
      >
        <div v-if="loading" class="sticky left-0 flex h-48 w-full items-center justify-center">
          <GeneralLoader size="large" />
        </div>
        <template v-else>
          <div
            v-for="task in visibleRows"
            :key="`row-${task.id}`"
            class="absolute left-0 border-b border-nc-border-gray-light"
            :style="{ top: `${task.row * ROW_HEIGHT}px`, width: `${totalWidth}px`, height: `${ROW_HEIGHT}px` }"
            data-testid="nc-gantt-row"
          >
            <div
              class="sticky left-0 z-20 flex h-full w-72 items-center gap-2 border-r border-nc-border-gray-medium bg-white px-3"
            >
              <span v-if="task.milestone" class="h-2.5 w-2.5 shrink-0 rotate-45 bg-purple-600" aria-label="Milestone" />
              <span class="min-w-0 flex-1 truncate text-sm text-nc-content-gray" :title="taskTitle(task.record)">{{
                taskTitle(task.record)
              }}</span>
              <span v-if="task.progress !== undefined" class="shrink-0 text-xs text-nc-content-gray-muted"
                >{{ Math.round(task.progress) }}%</span
              >
            </div>
          </div>

          <div
            v-for="task in visibleRows"
            :key="task.id"
            class="group absolute z-10 h-8 touch-none select-none text-xs shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-600"
            :class="
              task.milestone
                ? 'w-8 border border-purple-500 bg-purple-200'
                : 'overflow-hidden rounded-md border border-purple-400 bg-purple-100 px-2 py-1 text-purple-950'
            "
            :style="
              task.milestone
                ? { ...taskGeometry(task), width: '24px', transform: 'translateX(-12px) rotate(45deg)' }
                : taskGeometry(task)
            "
            :tabindex="canReschedule ? 0 : undefined"
            :aria-label="`Move ${taskTitle(task.record)}; use left or right arrow keys`"
            :data-milestone="task.milestone"
            :data-progress="task.progress"
            data-testid="nc-gantt-task"
            @pointerdown="beginPointer($event, task)"
            @pointermove="movePointer"
            @pointerup="finishPointer($event, task)"
            @pointercancel="cancelPointer"
            @keydown="handleKeydown($event, task)"
            @focusin="focusedItemId = task.id"
            @focusout="onTaskFocusOut"
          >
            <template v-if="!task.milestone">
              <span class="relative z-10 block truncate font-medium">{{ taskTitle(task.record) }}</span>
              <span
                v-if="task.progress !== undefined"
                class="pointer-events-none absolute inset-y-0 left-0 bg-purple-300/70"
                :style="{ width: `${task.progress}%` }"
                data-testid="nc-gantt-progress"
              />
              <span
                v-if="canResizeEnd"
                class="absolute left-0 top-0 z-20 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
                role="button"
                tabindex="0"
                :aria-label="`Resize ${taskTitle(task.record)} start`"
                data-testid="nc-gantt-resize-start"
                @pointerdown.stop="beginPointer($event, task, 'start')"
                @keydown="handleKeydown($event, task, 'start')"
              />
              <span
                v-if="canResizeEnd"
                class="absolute right-0 top-0 z-20 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
                role="button"
                tabindex="0"
                :aria-label="`Resize ${taskTitle(task.record)} end`"
                data-testid="nc-gantt-resize-end"
                @pointerdown.stop="beginPointer($event, task, 'end')"
                @keydown="handleKeydown($event, task, 'end')"
              />
            </template>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
