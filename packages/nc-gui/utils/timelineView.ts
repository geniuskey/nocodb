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

export interface TimelineReschedulePatch {
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
): TimelineReschedulePatch | undefined {
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
