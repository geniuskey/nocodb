<script lang="ts" setup>
import dayjs from 'dayjs'
import { type ColumnType, type PaginatedType, type TimelineType, UITypes, ViewTypes, parseProp } from 'nocodb-sdk'
import {
  TIMELINE_PIXELS_PER_DAY,
  TIMELINE_WINDOW_DAYS,
  type TimelineMutationPatch,
  type TimelineZoom,
  buildTimelineEndResizePatch,
  buildTimelineReschedulePatch,
  buildTimelineStartResizePatch,
  layoutTimelineGroups,
  layoutTimelineItems,
  timelineBoundsVisible,
  timelineLaneCount,
  timelineVirtualRange,
} from '~/utils/timelineView'

const DAY_MS = 24 * 60 * 60 * 1000
const LANE_HEIGHT = 44
const GROUP_HEADER_HEIGHT = 36
const TIMELINE_HEADER_HEIGHT = 36
const HORIZONTAL_OVERSCAN = 160
const VERTICAL_OVERSCAN = LANE_HEIGHT * 4

const meta = inject(MetaInj, ref())
const view = inject(ActiveViewInj, ref())
const reloadViewDataHook = inject(ReloadViewDataHookInj)

const { $api } = useNuxtApp()
const { xWhere, isLocked, isSqlView, isSyncedTable } = useSmartsheetStoreOrThrow()
const { isUIAllowed } = useRoles()
const { updateViewMeta } = useViewsStore()
const { addUndo, defineViewScope } = useUndoRedo()
const { t } = useI18n()

const settings = ref<TimelineType>()
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
const canvasWidth = computed(() => windowDays.value * pixelsPerDay.value)

const columns = computed(() => meta.value?.columns || [])
const dateColumns = computed(() =>
  columns.value.filter((column: ColumnType) => [UITypes.Date, UITypes.DateTime].includes(column.uidt)),
)
const titleColumns = computed(() =>
  columns.value.filter((column: ColumnType) => ![UITypes.Attachment, UITypes.Barcode, UITypes.QrCode].includes(column.uidt)),
)
const groupableColumns = computed(() =>
  columns.value.filter(
    (column: ColumnType) => ![UITypes.Attachment, UITypes.Barcode, UITypes.QrCode, UITypes.Button].includes(column.uidt),
  ),
)

const columnById = (id?: string | null) => columns.value.find((column: ColumnType) => column.id === id)
const columnKey = (id?: string | null) => columnById(id)?.title

const startKey = computed(() => columnKey(settings.value?.fk_start_column_id))
const endKey = computed(() => columnKey(settings.value?.fk_end_column_id))
const titleKey = computed(() => columnKey(settings.value?.fk_title_column_id))
const timelineMeta = computed<Record<string, any>>(() => parseProp(settings.value?.meta))
const groupColumn = computed(() => columnById(timelineMeta.value?.group_by_column_id))
const groupKey = computed(() => groupColumn.value?.title)
const startColumn = computed(() => columnById(settings.value?.fk_start_column_id))
const endColumn = computed(() => columnById(settings.value?.fk_end_column_id))

const draft = reactive<{
  fk_title_column_id: string | null
  fk_start_column_id: string | null
  fk_end_column_id: string | null
  fk_group_column_id: string | null
  zoom: TimelineZoom
}>({
  fk_title_column_id: null,
  fk_start_column_id: null,
  fk_end_column_id: null,
  fk_group_column_id: null,
  zoom: 'week',
})

const syncDraft = () => {
  draft.fk_title_column_id = settings.value?.fk_title_column_id || null
  draft.fk_start_column_id = settings.value?.fk_start_column_id || null
  draft.fk_end_column_id = settings.value?.fk_end_column_id || null
  draft.fk_group_column_id = timelineMeta.value?.group_by_column_id || null
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

const layoutInputs = computed(() => {
  if (!startKey.value) return []
  const from = rangeStart.value.valueOf()
  const to = rangeEnd.value.valueOf()

  return records.value.flatMap((record, index) => {
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
  })
})

const collapsedGroups = ref(new Set<string>())
const scrollRegion = ref<HTMLElement>()
const scrollLeft = ref(0)
const scrollTop = ref(0)
const viewportWidth = ref(0)
const viewportHeight = ref(0)
const focusedItemId = ref<string>()

const syncViewport = () => {
  const element = scrollRegion.value
  if (!element) return
  scrollLeft.value = element.scrollLeft
  scrollTop.value = element.scrollTop
  viewportWidth.value = element.clientWidth
  viewportHeight.value = Math.max(0, element.clientHeight - TIMELINE_HEADER_HEIGHT)
}

const onTimelineScroll = (event: Event) => {
  const element = event.currentTarget as HTMLElement
  scrollLeft.value = element.scrollLeft
  scrollTop.value = element.scrollTop
}

useResizeObserver(scrollRegion, syncViewport)

const groupBands = computed(() => {
  if (!groupKey.value) return []

  let top = 0
  return layoutTimelineGroups(layoutInputs.value, (item) => item.record[groupKey.value!]).map((group) => {
    const collapsed = collapsedGroups.value.has(group.key)
    const height = collapsed ? GROUP_HEADER_HEIGHT : GROUP_HEADER_HEIGHT + Math.max(1, group.laneCount) * LANE_HEIGHT + 8
    const band = {
      ...group,
      recordCount: group.items.length,
      collapsed,
      top,
      height,
      items: collapsed
        ? []
        : group.items.map((item) => ({ ...item, top: top + GROUP_HEADER_HEIGHT + item.lane * LANE_HEIGHT + 8 })),
    }
    top += height
    return band
  })
})

const layout = computed(() => {
  if (groupKey.value) return groupBands.value.flatMap((group) => group.items)
  return layoutTimelineItems(layoutInputs.value).map((item) => ({ ...item, top: item.lane * LANE_HEIGHT + 16 }))
})

const canvasHeight = computed(() => {
  if (groupKey.value) return Math.max(240, groupBands.value.reduce((height, group) => height + group.height, 0) + 8)
  return Math.max(240, timelineLaneCount(layout.value) * LANE_HEIGHT + 32)
})

const viewport = computed(() => ({
  left: scrollLeft.value,
  top: scrollTop.value,
  width: viewportWidth.value,
  height: viewportHeight.value,
}))

const visibleGroupBands = computed(() =>
  groupBands.value.filter((group) =>
    timelineBoundsVisible(
      { left: 0, top: group.top, width: canvasWidth.value, height: group.height },
      viewport.value,
      HORIZONTAL_OVERSCAN,
      VERTICAL_OVERSCAN,
    ),
  ),
)

type TimelineLayoutRecord = (typeof layout.value)[number]

const dragState = ref<{
  itemId: string
  pointerId: number
  startX: number
  deltaDays: number
}>()

const resizeState = ref<{
  itemId: string
  pointerId: number
  startX: number
  deltaDays: number
}>()

const startResizeState = ref<{
  itemId: string
  pointerId: number
  startX: number
  deltaDays: number
}>()

const itemGeometry = (item: TimelineLayoutRecord) => {
  const previewDays = dragState.value?.itemId === item.id ? dragState.value.deltaDays : 0
  const resizeDays = resizeState.value?.itemId === item.id ? resizeState.value.deltaDays : 0
  const startResizeDays = startResizeState.value?.itemId === item.id ? startResizeState.value.deltaDays : 0
  const baseWidth = ((item.end - item.start) / DAY_MS) * pixelsPerDay.value

  return {
    left:
      ((item.start - rangeStart.value.valueOf()) / DAY_MS) * pixelsPerDay.value +
      (previewDays + startResizeDays) * pixelsPerDay.value,
    top: item.top,
    width: Math.max(14, baseWidth + (resizeDays - startResizeDays) * pixelsPerDay.value),
    height: 32,
  }
}

const visibleLayout = computed(() =>
  layout.value.filter((item) => {
    const pinned =
      focusedItemId.value === item.id ||
      dragState.value?.itemId === item.id ||
      resizeState.value?.itemId === item.id ||
      startResizeState.value?.itemId === item.id

    return pinned || timelineBoundsVisible(itemGeometry(item), viewport.value, HORIZONTAL_OVERSCAN, VERTICAL_OVERSCAN)
  }),
)

const itemStyle = (item: TimelineLayoutRecord) => {
  const geometry = itemGeometry(item)
  return {
    left: `${geometry.left}px`,
    top: `${geometry.top}px`,
    width: `${geometry.width}px`,
  }
}

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

const visibleDayIndexes = computed(() => {
  const { start, end } = timelineVirtualRange(
    windowDays.value,
    pixelsPerDay.value,
    scrollLeft.value,
    viewportWidth.value,
    HORIZONTAL_OVERSCAN,
  )
  return Array.from({ length: end - start }, (_, offset) => start + offset)
})

const onItemFocusIn = (item: TimelineLayoutRecord) => {
  focusedItemId.value = item.id
}

const onItemFocusOut = (event: FocusEvent, item: TimelineLayoutRecord) => {
  if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) return
  if (focusedItemId.value === item.id) focusedItemId.value = undefined
}

const moveWindow = (direction: -1 | 1) => {
  rangeStart.value = rangeStart.value.add(direction * windowDays.value, 'day')
}

const goToday = () => {
  rangeStart.value = dayjs()
    .startOf('day')
    .subtract(Math.floor(windowDays.value / 2), 'day')
}

const toggleGroup = (key: string, label: string) => {
  const next = new Set(collapsedGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedGroups.value = next
  announcement.value = `${label} group ${next.has(key) ? 'collapsed' : 'expanded'}.`
  nextTick(syncViewport)
}

const canReschedule = computed(
  () =>
    isUIAllowed('dataEdit') &&
    !isLocked.value &&
    !isSqlView.value &&
    !isSyncedTable.value &&
    !!startColumn.value &&
    !startColumn.value.readonly &&
    (!endColumn.value || !endColumn.value.readonly),
)

const canResizeEnd = computed(
  () =>
    isUIAllowed('dataEdit') &&
    !isLocked.value &&
    !isSqlView.value &&
    !isSyncedTable.value &&
    !!startColumn.value?.title &&
    !!endColumn.value?.title &&
    startColumn.value.title !== endColumn.value.title &&
    !endColumn.value.readonly,
)

const canResizeStart = computed(
  () =>
    isUIAllowed('dataEdit') &&
    !isLocked.value &&
    !isSqlView.value &&
    !isSyncedTable.value &&
    !!startColumn.value?.title &&
    !!endColumn.value?.title &&
    startColumn.value.title !== endColumn.value.title &&
    !startColumn.value.readonly,
)

const canResizeItem = (item: TimelineLayoutRecord) => {
  if (!canResizeEnd.value || !endKey.value) return false
  const rawEnd = item.record[endKey.value]
  if (rawEnd === null || rawEnd === undefined || rawEnd === '') return false

  const parsedEnd = parseEnd(rawEnd, Number.NaN)
  return Number.isFinite(parsedEnd) && parsedEnd <= rangeEnd.value.valueOf()
}

const canResizeStartItem = (item: TimelineLayoutRecord) => {
  if (!canResizeStart.value || !startKey.value || !endKey.value) return false
  const rawStart = item.record[startKey.value]
  const rawEnd = item.record[endKey.value]
  if (
    rawStart === null ||
    rawStart === undefined ||
    rawStart === '' ||
    rawEnd === null ||
    rawEnd === undefined ||
    rawEnd === ''
  ) {
    return false
  }

  const parsedStart = parseStart(rawStart)
  return parsedStart !== undefined && parsedStart >= rangeStart.value.valueOf()
}

const patchRecordByPk = async (primaryKey: string, values: Record<string, unknown>) => {
  if (!meta.value?.base_id || !meta.value?.id || !view.value?.id) throw new Error('Timeline row context is unavailable.')

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

const applyTimelineMutation = async (
  item: TimelineLayoutRecord,
  patch: TimelineMutationPatch,
  successText: string,
  failureAction: string,
) => {
  const primaryKey = extractPkFromRow(item.record, columns.value as ColumnType[])
  if (primaryKey === null || primaryKey === undefined) return

  const recordId = String(primaryKey)
  savingRecordId.value = recordId
  announcement.value = ''
  Object.assign(item.record, patch.next)

  try {
    await patchRecordByPk(recordId, patch.next)
    addUndo({
      redo: {
        fn: applyHistoryPatch,
        args: [recordId, { ...patch.next }],
      },
      undo: {
        fn: applyHistoryPatch,
        args: [recordId, { ...patch.previous }],
      },
      scope: defineViewScope({ view: view.value }),
    })
    await loadRecords()
    announcement.value = `${itemTitle(item.record)} ${successText}.`
  } catch (e: any) {
    Object.assign(item.record, patch.previous)
    const messageText = await extractSdkResponseErrorMsg(e)
    announcement.value = `Timeline ${failureAction} failed: ${messageText}`
    message.error(`${t('msg.error.rowUpdateFailed')}: ${messageText}`)
  } finally {
    savingRecordId.value = undefined
  }
}

const rescheduleByDays = async (item: TimelineLayoutRecord, deltaDays: number) => {
  if (!canReschedule.value || savingRecordId.value || !startColumn.value) return

  const patch = buildTimelineReschedulePatch(item.record, startColumn.value, endColumn.value, deltaDays)
  if (!patch) return

  await applyTimelineMutation(
    item,
    patch,
    `moved ${Math.abs(deltaDays)} day${Math.abs(deltaDays) === 1 ? '' : 's'} ${deltaDays > 0 ? 'later' : 'earlier'}`,
    'move',
  )
}

const resizeEndByDays = async (item: TimelineLayoutRecord, deltaDays: number) => {
  if (!canResizeItem(item) || savingRecordId.value || !startColumn.value) return

  const patch = buildTimelineEndResizePatch(item.record, startColumn.value, endColumn.value, deltaDays)
  if (!patch) {
    announcement.value = 'Timeline end cannot precede its start.'
    return
  }

  await applyTimelineMutation(
    item,
    patch,
    `duration ${deltaDays > 0 ? 'increased' : 'decreased'} by ${Math.abs(deltaDays)} day${Math.abs(deltaDays) === 1 ? '' : 's'}`,
    'resize',
  )
}

const resizeStartByDays = async (item: TimelineLayoutRecord, deltaDays: number) => {
  if (!canResizeStartItem(item) || savingRecordId.value || !startColumn.value) return

  const patch = buildTimelineStartResizePatch(item.record, startColumn.value, endColumn.value, deltaDays)
  if (!patch) {
    announcement.value = 'Timeline start cannot follow its end.'
    return
  }

  await applyTimelineMutation(
    item,
    patch,
    `start moved ${Math.abs(deltaDays)} day${Math.abs(deltaDays) === 1 ? '' : 's'} ${deltaDays > 0 ? 'later' : 'earlier'}`,
    'start resize',
  )
}

const beginDrag = (event: PointerEvent, item: TimelineLayoutRecord) => {
  if (!canReschedule.value || savingRecordId.value || event.button !== 0) return
  event.preventDefault()
  dragState.value = {
    itemId: item.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    deltaDays: 0,
  }
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
}

const moveDrag = (event: PointerEvent) => {
  if (!dragState.value || dragState.value.pointerId !== event.pointerId) return
  dragState.value.deltaDays = Math.round((event.clientX - dragState.value.startX) / pixelsPerDay.value)
}

const finishDrag = async (event: PointerEvent, item: TimelineLayoutRecord) => {
  if (!dragState.value || dragState.value.pointerId !== event.pointerId) return
  const deltaDays = dragState.value.deltaDays
  dragState.value = undefined
  if (deltaDays) await rescheduleByDays(item, deltaDays)
}

const cancelDrag = (event: PointerEvent) => {
  if (dragState.value?.pointerId === event.pointerId) dragState.value = undefined
}

const handleItemKeydown = async (event: KeyboardEvent, item: TimelineLayoutRecord) => {
  if (!canReschedule.value || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  await rescheduleByDays(item, event.key === 'ArrowLeft' ? -1 : 1)
}

const beginEndResize = (event: PointerEvent, item: TimelineLayoutRecord) => {
  if (!canResizeItem(item) || savingRecordId.value || event.button !== 0) return
  event.preventDefault()
  resizeState.value = {
    itemId: item.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    deltaDays: 0,
  }
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
}

const moveEndResize = (event: PointerEvent) => {
  if (!resizeState.value || resizeState.value.pointerId !== event.pointerId) return
  resizeState.value.deltaDays = Math.round((event.clientX - resizeState.value.startX) / pixelsPerDay.value)
}

const finishEndResize = async (event: PointerEvent, item: TimelineLayoutRecord) => {
  if (!resizeState.value || resizeState.value.pointerId !== event.pointerId) return
  const deltaDays = resizeState.value.deltaDays
  resizeState.value = undefined
  if (deltaDays) await resizeEndByDays(item, deltaDays)
}

const cancelEndResize = (event: PointerEvent) => {
  if (resizeState.value?.pointerId === event.pointerId) resizeState.value = undefined
}

const handleEndResizeKeydown = async (event: KeyboardEvent, item: TimelineLayoutRecord) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  await resizeEndByDays(item, event.key === 'ArrowLeft' ? -1 : 1)
}

const beginStartResize = (event: PointerEvent, item: TimelineLayoutRecord) => {
  if (!canResizeStartItem(item) || savingRecordId.value || event.button !== 0) return
  event.preventDefault()
  startResizeState.value = {
    itemId: item.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    deltaDays: 0,
  }
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
}

const moveStartResize = (event: PointerEvent) => {
  if (!startResizeState.value || startResizeState.value.pointerId !== event.pointerId) return
  startResizeState.value.deltaDays = Math.round((event.clientX - startResizeState.value.startX) / pixelsPerDay.value)
}

const finishStartResize = async (event: PointerEvent, item: TimelineLayoutRecord) => {
  if (!startResizeState.value || startResizeState.value.pointerId !== event.pointerId) return
  const deltaDays = startResizeState.value.deltaDays
  startResizeState.value = undefined
  if (deltaDays) await resizeStartByDays(item, deltaDays)
}

const cancelStartResize = (event: PointerEvent) => {
  if (startResizeState.value?.pointerId === event.pointerId) startResizeState.value = undefined
}

const handleStartResizeKeydown = async (event: KeyboardEvent, item: TimelineLayoutRecord) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  await resizeStartByDays(item, event.key === 'ArrowLeft' ? -1 : 1)
}

const saveSettings = async () => {
  if (!view.value?.id || !draft.fk_start_column_id) return
  saving.value = true
  error.value = ''
  const previousZoom = zoom.value
  const previousWindowDays = windowDays.value
  try {
    const { fk_group_column_id, ...timelineDraft } = draft
    await updateViewMeta(view.value.id, ViewTypes.TIMELINE, {
      ...timelineDraft,
      meta: {
        ...timelineMeta.value,
        group_by_column_id: fk_group_column_id,
      },
    })
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
  await nextTick()
  syncViewport()
})

onBeforeUnmount(() => reloadViewDataHook?.off(reloadListener))
</script>

<template>
  <div class="nc-timeline flex h-full min-w-0 flex-col bg-nc-bg-default" data-testid="nc-timeline-wrapper">
    <span class="sr-only" aria-live="polite" data-testid="nc-timeline-announcement">{{ announcement }}</span>
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
        <span
          v-if="groupColumn"
          class="rounded bg-nc-bg-brand px-2 py-1 text-xs text-nc-content-brand"
          data-testid="nc-timeline-grouping-label"
        >
          Grouped by {{ groupColumn.title }}
        </span>
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
      class="grid grid-cols-1 gap-3 border-b border-nc-border-gray-medium bg-white p-3 md:grid-cols-5"
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
        Group by
        <a-select v-model:value="draft.fk_group_column_id" allow-clear size="small" data-testid="nc-timeline-settings-group">
          <a-select-option v-for="column in groupableColumns" :key="column.id" :value="column.id">{{
            column.title
          }}</a-select-option>
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

    <div
      v-else
      ref="scrollRegion"
      class="relative flex-1 overflow-auto"
      data-testid="nc-timeline-scroll-region"
      @scroll="onTimelineScroll"
    >
      <div
        class="sticky top-0 z-20 h-9 border-b border-nc-border-gray-medium bg-white"
        :style="{ width: `${canvasWidth}px` }"
        :data-total-days="windowDays"
        :data-rendered-days="visibleDayIndexes.length"
        data-testid="nc-timeline-header"
      >
        <div
          v-for="index in visibleDayIndexes"
          :key="index"
          class="absolute top-0 h-full overflow-visible border-r border-nc-border-gray-light px-1 py-2 text-[11px] text-nc-content-gray-muted"
          :style="{ left: `${index * pixelsPerDay}px`, width: `${pixelsPerDay}px` }"
          :data-day-index="index"
          data-testid="nc-timeline-day"
        >
          <span class="whitespace-nowrap">{{ headerLabel(index) }}</span>
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
        :data-total-items="layout.length"
        :data-rendered-items="visibleLayout.length"
        :data-total-groups="groupBands.length"
        :data-rendered-groups="visibleGroupBands.length"
        data-testid="nc-timeline-canvas"
      >
        <div v-if="loading" class="sticky left-0 flex h-48 w-full items-center justify-center">
          <GeneralLoader size="large" />
        </div>
        <template v-else>
          <div
            v-for="group in visibleGroupBands"
            :key="group.key"
            class="pointer-events-none absolute left-0 border-b border-nc-border-gray-medium bg-nc-bg-gray-extralight/60"
            :style="{ top: `${group.top}px`, width: `${canvasWidth}px`, height: `${group.height}px` }"
            data-testid="nc-timeline-group"
            :data-group-label="group.label"
          >
            <button
              type="button"
              class="pointer-events-auto sticky left-2 z-10 mt-1 flex h-7 max-w-72 items-center gap-1 rounded border border-nc-border-gray-medium bg-white px-2 text-left text-xs font-medium text-nc-content-gray shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-nc-content-brand"
              :aria-expanded="!group.collapsed"
              :aria-label="`${group.collapsed ? 'Expand' : 'Collapse'} ${group.label} group, ${group.recordCount} record${
                group.recordCount === 1 ? '' : 's'
              }`"
              data-testid="nc-timeline-group-toggle"
              @click="toggleGroup(group.key, group.label)"
            >
              <GeneralIcon :icon="group.collapsed ? 'chevronRight' : 'chevronDown'" class="shrink-0" />
              <span class="truncate">{{ group.label }}</span>
              <span class="shrink-0 text-nc-content-gray-muted">({{ group.recordCount }})</span>
            </button>
          </div>
          <div
            v-for="item in visibleLayout"
            :key="item.id"
            class="group absolute z-10 h-8 touch-none overflow-hidden rounded-md border border-blue-300 bg-blue-100 px-2 py-1 text-xs text-blue-900 shadow-sm"
            :class="{
              'cursor-grab select-none hover:border-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500':
                canReschedule,
              'cursor-grabbing opacity-80': dragState?.itemId === item.id,
              'opacity-80': resizeState?.itemId === item.id || startResizeState?.itemId === item.id,
              'animate-pulse': savingRecordId === item.id,
            }"
            :style="itemStyle(item)"
            :title="`${itemTitle(item.record)}${canReschedule ? ' — drag or use arrow keys to move by whole days' : ''}`"
            :tabindex="canReschedule ? 0 : undefined"
            :role="canReschedule || canResizeItem(item) || canResizeStartItem(item) ? 'group' : undefined"
            :aria-label="
              canReschedule
                ? `Move ${itemTitle(item.record)}; use left or right arrow keys`
                : canResizeItem(item)
                ? itemTitle(item.record)
                : canResizeStartItem(item)
                ? itemTitle(item.record)
                : undefined
            "
            data-testid="nc-timeline-item"
            @pointerdown="beginDrag($event, item)"
            @pointermove="moveDrag"
            @pointerup="finishDrag($event, item)"
            @pointercancel="cancelDrag"
            @keydown="handleItemKeydown($event, item)"
            @focusin="onItemFocusIn(item)"
            @focusout="onItemFocusOut($event, item)"
          >
            <span class="block truncate font-medium">{{ itemTitle(item.record) }}</span>
            <span v-if="dragState?.itemId === item.id && dragState.deltaDays" class="sr-only">
              {{ Math.abs(dragState.deltaDays) }} day{{ Math.abs(dragState.deltaDays) === 1 ? '' : 's' }}
              {{ dragState.deltaDays > 0 ? 'later' : 'earlier' }}
            </span>
            <span
              v-if="canResizeStartItem(item)"
              class="absolute left-0 top-0 h-full w-2 cursor-ew-resize border-r border-blue-400 bg-blue-200 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
              role="button"
              :aria-label="`Resize ${itemTitle(item.record)} start; use left or right arrow keys`"
              :title="`Resize ${itemTitle(item.record)} start by whole days`"
              tabindex="0"
              data-testid="nc-timeline-resize-start"
              @pointerdown.stop="beginStartResize($event, item)"
              @pointermove.stop="moveStartResize"
              @pointerup.stop="finishStartResize($event, item)"
              @pointercancel.stop="cancelStartResize"
              @keydown="handleStartResizeKeydown($event, item)"
            />
            <span
              v-if="canResizeItem(item)"
              class="absolute right-0 top-0 h-full w-2 cursor-ew-resize border-l border-blue-400 bg-blue-200 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
              role="button"
              :aria-label="`Resize ${itemTitle(item.record)} end; use left or right arrow keys`"
              :title="`Resize ${itemTitle(item.record)} end by whole days`"
              tabindex="0"
              data-testid="nc-timeline-resize-end"
              @pointerdown.stop="beginEndResize($event, item)"
              @pointermove.stop="moveEndResize"
              @pointerup.stop="finishEndResize($event, item)"
              @pointercancel.stop="cancelEndResize"
              @keydown="handleEndResizeKeydown($event, item)"
            />
            <span v-if="resizeState?.itemId === item.id && resizeState.deltaDays" class="sr-only">
              Duration {{ resizeState.deltaDays > 0 ? 'increased' : 'decreased' }} by {{ Math.abs(resizeState.deltaDays) }} day{{
                Math.abs(resizeState.deltaDays) === 1 ? '' : 's'
              }}
            </span>
            <span v-if="startResizeState?.itemId === item.id && startResizeState.deltaDays" class="sr-only">
              Start moved {{ Math.abs(startResizeState.deltaDays) }} day{{
                Math.abs(startResizeState.deltaDays) === 1 ? '' : 's'
              }}
              {{ startResizeState.deltaDays > 0 ? 'later' : 'earlier' }}
            </span>
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
