import dayjs from 'dayjs'
import type { Dayjs, ManipulateType } from 'dayjs'

export const TIMELINE_ZOOMS = [
  'day',
  'week',
  'two_weeks',
  'month',
  'quarter',
  'six_months',
  'year',
  'two_years',
  'five_years',
] as const

export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number]

export interface TimelineWindow {
  start: Dayjs
  end: Dayjs
}

export interface TimelineAxisBucket extends TimelineWindow {
  key: string
  label: string
  secondaryLabel?: string
  width: number
}

export interface TimelineBarGeometry {
  left: number
  width: number
  clippedBefore: boolean
  clippedAfter: boolean
  invalidRange: boolean
}

const zoomSet = new Set<string>(TIMELINE_ZOOMS)

const zoomSpans: Record<TimelineZoom, { amount: number; unit: ManipulateType }> = {
  day: { amount: 1, unit: 'day' },
  week: { amount: 1, unit: 'week' },
  two_weeks: { amount: 2, unit: 'week' },
  month: { amount: 1, unit: 'month' },
  quarter: { amount: 3, unit: 'month' },
  six_months: { amount: 6, unit: 'month' },
  year: { amount: 1, unit: 'year' },
  two_years: { amount: 2, unit: 'year' },
  five_years: { amount: 5, unit: 'year' },
}

const bucketConfig: Record<TimelineZoom, { amount: number; unit: ManipulateType; width: number }> = {
  day: { amount: 1, unit: 'hour', width: 48 },
  week: { amount: 1, unit: 'day', width: 140 },
  two_weeks: { amount: 1, unit: 'day', width: 84 },
  month: { amount: 1, unit: 'day', width: 36 },
  quarter: { amount: 1, unit: 'day', width: 20 },
  six_months: { amount: 1, unit: 'week', width: 60 },
  year: { amount: 1, unit: 'month', width: 96 },
  two_years: { amount: 1, unit: 'month', width: 64 },
  five_years: { amount: 3, unit: 'month', width: 84 },
}

export const normalizeTimelineZoom = (value?: string | null): TimelineZoom =>
  value && zoomSet.has(value) ? (value as TimelineZoom) : 'month'

export const getTimelineWindow = (anchorInput: Dayjs | string | Date, zoomInput: string): TimelineWindow => {
  const anchor = dayjs(anchorInput)
  const zoom = normalizeTimelineZoom(zoomInput)
  let start: Dayjs

  switch (zoom) {
    case 'day':
      start = anchor.startOf('day')
      break
    case 'week':
    case 'two_weeks':
      start = anchor.startOf('week')
      break
    case 'month':
      start = anchor.startOf('month')
      break
    case 'quarter':
      start = anchor.month(Math.floor(anchor.month() / 3) * 3).startOf('month')
      break
    case 'six_months':
      start = anchor.month(anchor.month() < 6 ? 0 : 6).startOf('month')
      break
    case 'year':
    case 'two_years':
    case 'five_years':
      start = anchor.startOf('year')
      break
  }

  const span = zoomSpans[zoom]
  return { start, end: start.add(span.amount, span.unit) }
}

export const shiftTimelineAnchor = (anchorInput: Dayjs | string | Date, zoomInput: string, direction: -1 | 1): Dayjs => {
  const zoom = normalizeTimelineZoom(zoomInput)
  const span = zoomSpans[zoom]
  return dayjs(anchorInput).add(direction * span.amount, span.unit)
}

const formatBucket = (start: Dayjs, zoom: TimelineZoom) => {
  switch (zoom) {
    case 'day':
      return { label: start.format('HH:mm'), secondaryLabel: start.format('ddd D MMM') }
    case 'week':
    case 'two_weeks':
    case 'month':
    case 'quarter':
      return { label: start.format('D'), secondaryLabel: start.format('ddd MMM') }
    case 'six_months':
      return { label: start.format('D MMM'), secondaryLabel: start.format('YYYY') }
    case 'year':
    case 'two_years':
      return { label: start.format('MMM'), secondaryLabel: start.format('YYYY') }
    case 'five_years':
      return { label: `Q${Math.floor(start.month() / 3) + 1}`, secondaryLabel: start.format('YYYY') }
  }
}

export const createTimelineAxis = (
  startInput: Dayjs | string | Date,
  endInput: Dayjs | string | Date,
  zoomInput: string,
): TimelineAxisBucket[] => {
  const zoom = normalizeTimelineZoom(zoomInput)
  const config = bucketConfig[zoom]
  const end = dayjs(endInput)
  const buckets: TimelineAxisBucket[] = []
  let cursor = dayjs(startInput)

  while (cursor.isBefore(end)) {
    const bucketEnd = cursor.add(config.amount, config.unit)
    const labels = formatBucket(cursor, zoom)
    buckets.push({
      start: cursor,
      end: bucketEnd.isAfter(end) ? end : bucketEnd,
      key: `${cursor.valueOf()}-${zoom}`,
      width: config.width,
      ...labels,
    })
    cursor = bucketEnd
  }

  return buckets
}

export const getTimelineAxisWidth = (axis: TimelineAxisBucket[]) => axis.reduce((total, bucket) => total + bucket.width, 0)

export const getTimelinePosition = (dateInput: Dayjs | string | Date, axis: TimelineAxisBucket[]) => {
  if (!axis.length) return 0
  const date = dayjs(dateInput)
  if (!date.isAfter(axis[0].start)) return 0

  let offset = 0
  for (const bucket of axis) {
    if (date.isBefore(bucket.end)) {
      const duration = bucket.end.valueOf() - bucket.start.valueOf()
      const progress = duration ? (date.valueOf() - bucket.start.valueOf()) / duration : 0
      return offset + Math.max(0, Math.min(1, progress)) * bucket.width
    }
    offset += bucket.width
  }
  return offset
}

export const getTimelineBarGeometry = (
  startInput: Dayjs | string | Date,
  endInput: Dayjs | string | Date | null | undefined,
  axis: TimelineAxisBucket[],
): TimelineBarGeometry | null => {
  if (!axis.length) return null
  const start = dayjs(startInput)
  const configuredEnd = endInput ? dayjs(endInput) : null
  const invalidRange = Boolean(configuredEnd?.isBefore(start))
  const fallbackDuration = axis[0].end.valueOf() - axis[0].start.valueOf()
  const effectiveEnd =
    !configuredEnd || invalidRange || configuredEnd.isSame(start) ? start.add(fallbackDuration, 'millisecond') : configuredEnd
  const axisStart = axis[0].start
  const axisEnd = axis[axis.length - 1].end

  if (!effectiveEnd.isAfter(axisStart) || !start.isBefore(axisEnd)) return null

  const clippedBefore = start.isBefore(axisStart)
  const clippedAfter = effectiveEnd.isAfter(axisEnd)
  const clippedStart = clippedBefore ? axisStart : start
  const clippedEnd = clippedAfter ? axisEnd : effectiveEnd
  const left = getTimelinePosition(clippedStart, axis)
  const right = getTimelinePosition(clippedEnd, axis)

  return {
    left,
    width: Math.max(6, right - left),
    clippedBefore,
    clippedAfter,
    invalidRange,
  }
}

export const formatTimelineWindow = (window: TimelineWindow, zoomInput: string) => {
  const zoom = normalizeTimelineZoom(zoomInput)
  const lastVisibleMoment = window.end.subtract(1, 'millisecond')
  if (zoom === 'day') return window.start.format('dddd, D MMMM YYYY')
  if (zoom === 'month') return window.start.format('MMMM YYYY')
  if (zoom === 'quarter') return `Q${Math.floor(window.start.month() / 3) + 1} ${window.start.format('YYYY')}`
  if (zoom === 'six_months') {
    return `${window.start.format('MMM')} – ${lastVisibleMoment.format('MMM YYYY')}`
  }
  if (zoom === 'year') return window.start.format('YYYY')
  return `${window.start.format('D MMM YYYY')} – ${lastVisibleMoment.format('D MMM YYYY')}`
}
