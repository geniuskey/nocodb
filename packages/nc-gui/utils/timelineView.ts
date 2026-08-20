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
