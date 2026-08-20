import dayjs from 'dayjs'

export type TimelineZoom = 'day' | 'week' | 'month' | 'quarter'

export interface TimelineLayoutInput<T = Record<string, any>> {
  id: string
  start: number
  end: number
  record: T
}

export interface TimelineLayoutItem<T = Record<string, any>> extends TimelineLayoutInput<T> {
  lane: number
}

export interface TimelineGroupValue {
  key: string
  label: string
  blank: boolean
}

export interface TimelineLayoutGroup<T = Record<string, any>> extends TimelineGroupValue {
  items: TimelineLayoutItem<T>[]
  laneCount: number
}

export interface TimelineBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface TimelineViewport {
  left: number
  top: number
  width: number
  height: number
}

export interface TimelineVirtualRange {
  start: number
  end: number
}

export interface TimelineMutationPatch {
  previous: Record<string, unknown>
  next: Record<string, string>
  fields: string[]
}

export const TIMELINE_WINDOW_DAYS: Record<TimelineZoom, number> = {
  day: 14,
  week: 42,
  month: 120,
  quarter: 366,
}

export const TIMELINE_PIXELS_PER_DAY: Record<TimelineZoom, number> = {
  day: 120,
  week: 40,
  month: 16,
  quarter: 6,
}

/**
 * Assign intervals to the first free lane. Touching half-open intervals do not
 * overlap, which keeps the layout deterministic regardless of API row order.
 */
export function layoutTimelineItems<T>(items: TimelineLayoutInput<T>[]): TimelineLayoutItem<T>[] {
  const laneEnds: number[] = []

  return [...items]
    .sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id))
    .map((item) => {
      let lane = laneEnds.findIndex((end) => item.start >= end)
      if (lane === -1) lane = laneEnds.length

      laneEnds[lane] = Math.max(item.end, item.start + 1)
      return { ...item, lane }
    })
}

export function timelineLaneCount(items: TimelineLayoutItem[]) {
  return items.reduce((count, item) => Math.max(count, item.lane + 1), 0)
}

/**
 * Return an end-exclusive unit range covering the horizontal viewport plus
 * overscan. A not-yet-measured viewport returns the complete bounded range so
 * initial and server-side rendering remain deterministic.
 */
export function timelineVirtualRange(
  total: number,
  unitSize: number,
  offset: number,
  viewportSize: number,
  overscan = 0,
): TimelineVirtualRange {
  const safeTotal = Math.max(0, Math.floor(total))
  if (!safeTotal || unitSize <= 0) return { start: 0, end: 0 }
  if (viewportSize <= 0) return { start: 0, end: safeTotal }

  const start = Math.min(safeTotal, Math.max(0, Math.floor((Math.max(0, offset) - Math.max(0, overscan)) / unitSize)))
  const end = Math.min(
    safeTotal,
    Math.max(start, Math.ceil((Math.max(0, offset) + viewportSize + Math.max(0, overscan)) / unitSize)),
  )

  return { start, end }
}

/** Test a positioned Timeline entry against both viewport axes. */
export function timelineBoundsVisible(bounds: TimelineBounds, viewport: TimelineViewport, overscanX = 0, overscanY = 0) {
  if (viewport.width <= 0 || viewport.height <= 0) return true

  const horizontalPadding = Math.max(0, overscanX)
  const verticalPadding = Math.max(0, overscanY)
  const viewportRight = viewport.left + viewport.width + horizontalPadding
  const viewportBottom = viewport.top + viewport.height + verticalPadding
  const boundsRight = bounds.left + Math.max(0, bounds.width)
  const boundsBottom = bounds.top + Math.max(0, bounds.height)

  return (
    boundsRight > viewport.left - horizontalPadding &&
    bounds.left < viewportRight &&
    boundsBottom > viewport.top - verticalPadding &&
    bounds.top < viewportBottom
  )
}

function stableTimelineValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableTimelineValue).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableTimelineValue(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}

function timelineValueLabel(value: unknown): string {
  if (Array.isArray(value)) return value.map(timelineValueLabel).filter(Boolean).join(', ')
  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>
    for (const key of ['title', 'name', 'display_name', 'email', 'label', 'value']) {
      const candidate = objectValue[key]
      if (['string', 'number', 'boolean'].includes(typeof candidate)) return String(candidate)
    }
    return stableTimelineValue(value)
  }
  if (typeof value === 'boolean') return value ? 'Checked' : 'Unchecked'
  return String(value)
}

/**
 * Normalize an arbitrary cell value into one stable group. Compound values stay
 * together rather than duplicating a record into multiple Timeline bands.
 */
export function timelineGroupValue(value: unknown): TimelineGroupValue {
  const blank = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
  if (blank) return { key: 'blank:', label: 'Uncategorized', blank: true }

  return {
    key: `${typeof value}:${stableTimelineValue(value)}`,
    label: timelineValueLabel(value) || 'Uncategorized',
    blank: false,
  }
}

/** Layout each group independently so overlaps in one group do not consume lanes in another. */
export function layoutTimelineGroups<T>(
  items: TimelineLayoutInput<T>[],
  groupValue: (item: TimelineLayoutInput<T>) => unknown,
): TimelineLayoutGroup<T>[] {
  const grouped = new Map<string, { value: TimelineGroupValue; items: TimelineLayoutInput<T>[] }>()

  for (const item of items) {
    const value = timelineGroupValue(groupValue(item))
    const group = grouped.get(value.key)
    if (group) group.items.push(item)
    else grouped.set(value.key, { value, items: [item] })
  }

  return [...grouped.values()]
    .sort((left, right) => {
      if (left.value.blank !== right.value.blank) return left.value.blank ? 1 : -1
      const leftLabel = left.value.label.toLowerCase()
      const rightLabel = right.value.label.toLowerCase()
      if (leftLabel !== rightLabel) return leftLabel < rightLabel ? -1 : 1
      return left.value.key < right.value.key ? -1 : left.value.key > right.value.key ? 1 : 0
    })
    .map(({ value, items: groupItems }) => {
      const laidOut = layoutTimelineItems(groupItems)
      return { ...value, items: laidOut, laneCount: timelineLaneCount(laidOut) }
    })
}

function shiftTimelineFieldValue(value: unknown, type: 'date' | 'datetime', deltaDays: number) {
  if (value === null || value === undefined || value === '') return undefined

  const shifted = dayjs(value as any).add(deltaDays, 'day')
  if (!shifted.isValid()) return undefined

  return type === 'date' ? shifted.format('YYYY-MM-DD') : shifted.toISOString()
}

/**
 * Build the single row PATCH used by Timeline rescheduling. Start and end are
 * shifted by the same whole-calendar-day delta so the interval duration is
 * preserved. A blank optional end remains blank and is not written.
 */
export function buildTimelineReschedulePatch(
  record: Record<string, any>,
  startColumn: { title?: string; uidt?: string },
  endColumn: { title?: string; uidt?: string } | undefined,
  deltaDays: number,
): TimelineMutationPatch | undefined {
  if (!Number.isSafeInteger(deltaDays) || deltaDays === 0 || !startColumn.title) return undefined

  const startType = startColumn.uidt === 'Date' ? 'date' : startColumn.uidt === 'DateTime' ? 'datetime' : undefined
  if (!startType) return undefined

  const shiftedStart = shiftTimelineFieldValue(record[startColumn.title], startType, deltaDays)
  if (!shiftedStart) return undefined

  const previous: Record<string, unknown> = { [startColumn.title]: record[startColumn.title] }
  const next: Record<string, string> = { [startColumn.title]: shiftedStart }
  const fields = [startColumn.title]

  if (
    endColumn?.title &&
    record[endColumn.title] !== null &&
    record[endColumn.title] !== undefined &&
    record[endColumn.title] !== ''
  ) {
    const endType = endColumn.uidt === 'Date' ? 'date' : endColumn.uidt === 'DateTime' ? 'datetime' : undefined
    if (!endType) return undefined

    const shiftedEnd = shiftTimelineFieldValue(record[endColumn.title], endType, deltaDays)
    if (!shiftedEnd) return undefined

    previous[endColumn.title] = record[endColumn.title]
    next[endColumn.title] = shiftedEnd
    fields.push(endColumn.title)
  }

  return { previous, next, fields }
}

/**
 * Build the row PATCH used by a right-edge Timeline resize. Only the mapped
 * end field changes. Date ends are inclusive calendar days; DateTime ends are
 * instants. A resize may not move the end before the mapped start.
 */
export function buildTimelineEndResizePatch(
  record: Record<string, any>,
  startColumn: { title?: string; uidt?: string },
  endColumn: { title?: string; uidt?: string } | undefined,
  deltaDays: number,
): TimelineMutationPatch | undefined {
  if (
    !Number.isSafeInteger(deltaDays) ||
    deltaDays === 0 ||
    !startColumn.title ||
    !endColumn?.title ||
    startColumn.title === endColumn.title
  ) {
    return undefined
  }

  const startType = startColumn.uidt === 'Date' ? 'date' : startColumn.uidt === 'DateTime' ? 'datetime' : undefined
  const endType = endColumn.uidt === 'Date' ? 'date' : endColumn.uidt === 'DateTime' ? 'datetime' : undefined
  if (!startType || !endType) return undefined

  const originalStart = record[startColumn.title]
  const originalEnd = record[endColumn.title]
  if (
    originalStart === null ||
    originalStart === undefined ||
    originalStart === '' ||
    originalEnd === null ||
    originalEnd === undefined ||
    originalEnd === ''
  ) {
    return undefined
  }

  const parsedStart = dayjs(originalStart as any)
  const shiftedEnd = shiftTimelineFieldValue(originalEnd, endType, deltaDays)
  if (!parsedStart.isValid() || !shiftedEnd) return undefined

  const parsedEnd = dayjs(shiftedEnd)
  const endPrecedesStart =
    endType === 'date'
      ? parsedEnd.startOf('day').valueOf() < parsedStart.startOf('day').valueOf()
      : parsedEnd.valueOf() < parsedStart.valueOf()
  if (endPrecedesStart) return undefined

  return {
    previous: { [endColumn.title]: originalEnd },
    next: { [endColumn.title]: shiftedEnd },
    fields: [endColumn.title],
  }
}

/**
 * Build the row PATCH used by a left-edge Timeline resize. Only the mapped
 * start field changes. An inclusive Date end permits a start anywhere on the
 * same calendar day; a DateTime end is an exact upper bound.
 */
export function buildTimelineStartResizePatch(
  record: Record<string, any>,
  startColumn: { title?: string; uidt?: string },
  endColumn: { title?: string; uidt?: string } | undefined,
  deltaDays: number,
): TimelineMutationPatch | undefined {
  if (
    !Number.isSafeInteger(deltaDays) ||
    deltaDays === 0 ||
    !startColumn.title ||
    !endColumn?.title ||
    startColumn.title === endColumn.title
  ) {
    return undefined
  }

  const startType = startColumn.uidt === 'Date' ? 'date' : startColumn.uidt === 'DateTime' ? 'datetime' : undefined
  const endType = endColumn.uidt === 'Date' ? 'date' : endColumn.uidt === 'DateTime' ? 'datetime' : undefined
  if (!startType || !endType) return undefined

  const originalStart = record[startColumn.title]
  const originalEnd = record[endColumn.title]
  if (
    originalStart === null ||
    originalStart === undefined ||
    originalStart === '' ||
    originalEnd === null ||
    originalEnd === undefined ||
    originalEnd === ''
  ) {
    return undefined
  }

  const shiftedStart = shiftTimelineFieldValue(originalStart, startType, deltaDays)
  const parsedEnd = dayjs(originalEnd as any)
  if (!shiftedStart || !parsedEnd.isValid()) return undefined

  const parsedStart = dayjs(shiftedStart)
  const startFollowsEnd =
    endType === 'date'
      ? parsedStart.startOf('day').valueOf() > parsedEnd.startOf('day').valueOf()
      : parsedStart.valueOf() > parsedEnd.valueOf()
  if (startFollowsEnd) return undefined

  return {
    previous: { [startColumn.title]: originalStart },
    next: { [startColumn.title]: shiftedStart },
    fields: [startColumn.title],
  }
}
