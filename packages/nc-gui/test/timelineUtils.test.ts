import dayjs from 'dayjs'
import {
  TIMELINE_ZOOMS,
  createTimelineAxis,
  getTimelineAxisWidth,
  getTimelineBarGeometry,
  getTimelineWindow,
  normalizeTimelineZoom,
  shiftTimelineAnchor,
} from '../utils/timelineUtils'

describe('timeline date axis', () => {
  it('accepts all public zoom identifiers and falls back safely', () => {
    for (const zoom of TIMELINE_ZOOMS) expect(normalizeTimelineZoom(zoom)).toBe(zoom)
    expect(normalizeTimelineZoom('decade')).toBe('month')
    expect(normalizeTimelineZoom()).toBe('month')
  })

  it('aligns calendar windows without assuming equal month lengths', () => {
    const anchor = dayjs('2026-08-29T12:00:00')
    expect(getTimelineWindow(anchor, 'day').start.format()).toContain('2026-08-29T00:00:00')
    expect(getTimelineWindow(anchor, 'week').end.diff(getTimelineWindow(anchor, 'week').start, 'day')).toBe(7)
    expect(getTimelineWindow(anchor, 'two_weeks').end.diff(getTimelineWindow(anchor, 'two_weeks').start, 'day')).toBe(14)
    expect(getTimelineWindow(anchor, 'month').end.format('YYYY-MM-DD')).toBe('2026-09-01')
    expect(getTimelineWindow(anchor, 'quarter').start.format('YYYY-MM-DD')).toBe('2026-07-01')
    expect(getTimelineWindow(anchor, 'quarter').end.format('YYYY-MM-DD')).toBe('2026-10-01')
    expect(getTimelineWindow(anchor, 'six_months').start.format('YYYY-MM-DD')).toBe('2026-07-01')
    expect(getTimelineWindow(anchor, 'two_years').end.format('YYYY-MM-DD')).toBe('2028-01-01')
    expect(getTimelineWindow(anchor, 'five_years').end.format('YYYY-MM-DD')).toBe('2031-01-01')
  })

  it('moves by exactly one active span', () => {
    const anchor = dayjs('2026-08-29')
    expect(shiftTimelineAnchor(anchor, 'day', 1).format('YYYY-MM-DD')).toBe('2026-08-30')
    expect(shiftTimelineAnchor(anchor, 'two_weeks', -1).format('YYYY-MM-DD')).toBe('2026-08-15')
    expect(shiftTimelineAnchor(anchor, 'quarter', 1).format('YYYY-MM-DD')).toBe('2026-11-29')
    expect(shiftTimelineAnchor(anchor, 'five_years', -1).format('YYYY-MM-DD')).toBe('2021-08-29')
  })

  it('uses variable-duration buckets for a continuous axis', () => {
    const window = getTimelineWindow('2024-01-15', 'year')
    const axis = createTimelineAxis(window.start, window.end, 'year')
    expect(axis).toHaveLength(12)
    expect(axis[1].end.diff(axis[1].start, 'day')).toBe(29)
    expect(getTimelineAxisWidth(axis)).toBe(12 * 96)
  })

  it('clips bars and reports the edge that can be navigated to', () => {
    const axis = createTimelineAxis('2026-08-01', '2026-09-01', 'month')
    const normal = getTimelineBarGeometry('2026-08-10', '2026-08-12', axis)
    expect(normal).toMatchObject({ clippedBefore: false, clippedAfter: false, invalidRange: false })
    expect(normal?.left).toBe(9 * 36)
    expect(normal?.width).toBe(2 * 36)

    expect(getTimelineBarGeometry('2026-07-25', '2026-08-03', axis)).toMatchObject({
      left: 0,
      clippedBefore: true,
      clippedAfter: false,
    })
    expect(getTimelineBarGeometry('2026-08-30', '2026-09-05', axis)).toMatchObject({ clippedAfter: true })
    expect(getTimelineBarGeometry('2026-07-01', '2026-07-02', axis)).toBeNull()
    expect(getTimelineBarGeometry('2026-08-20', '2026-08-19', axis)).toMatchObject({ invalidRange: true })
  })
})
