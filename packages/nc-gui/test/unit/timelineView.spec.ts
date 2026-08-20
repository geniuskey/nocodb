import { describe, expect, it } from 'vitest'
import {
  buildTimelineEndResizePatch,
  buildTimelineReschedulePatch,
  buildTimelineStartResizePatch,
  layoutTimelineGroups,
  layoutTimelineItems,
  timelineBoundsVisible,
  timelineGroupValue,
  timelineLaneCount,
  timelineVirtualRange,
} from '../../utils/timelineView'

describe('Timeline overlap layout', () => {
  it('packs non-overlapping and touching intervals into the same lane', () => {
    const layout = layoutTimelineItems([
      { id: 'second', start: 20, end: 30, record: {} },
      { id: 'first', start: 10, end: 20, record: {} },
    ])

    expect(layout.map(({ id, lane }) => ({ id, lane }))).toEqual([
      { id: 'first', lane: 0 },
      { id: 'second', lane: 0 },
    ])
    expect(timelineLaneCount(layout)).toBe(1)
  })

  it('places overlapping intervals in stable separate lanes', () => {
    const layout = layoutTimelineItems([
      { id: 'short', start: 10, end: 20, record: {} },
      { id: 'long', start: 10, end: 40, record: {} },
      { id: 'later', start: 20, end: 30, record: {} },
    ])

    expect(layout.map(({ id, lane }) => ({ id, lane }))).toEqual([
      { id: 'long', lane: 0 },
      { id: 'short', lane: 1 },
      { id: 'later', lane: 1 },
    ])
    expect(timelineLaneCount(layout)).toBe(2)
  })

  it('treats point events as occupying a lane at their timestamp', () => {
    const layout = layoutTimelineItems([
      { id: 'point-a', start: 10, end: 10, record: {} },
      { id: 'point-b', start: 10, end: 10, record: {} },
    ])

    expect(layout.map((item) => item.lane)).toEqual([0, 1])
  })
})

describe('Timeline grouping', () => {
  it('orders named groups deterministically, leaves blank last, and lays out lanes per group', () => {
    const groups = layoutTimelineGroups(
      [
        { id: 'blank', start: 10, end: 20, record: { Status: null } },
        { id: 'ready-later', start: 15, end: 25, record: { Status: 'Ready' } },
        { id: 'blocked', start: 10, end: 20, record: { Status: 'Blocked' } },
        { id: 'ready-first', start: 10, end: 20, record: { Status: 'Ready' } },
      ],
      (item) => item.record.Status,
    )

    expect(groups.map(({ label, laneCount, items }) => ({ label, laneCount, ids: items.map((item) => item.id) }))).toEqual([
      { label: 'Blocked', laneCount: 1, ids: ['blocked'] },
      { label: 'Ready', laneCount: 2, ids: ['ready-first', 'ready-later'] },
      { label: 'Uncategorized', laneCount: 1, ids: ['blank'] },
    ])
  })

  it('normalizes scalar, compound, and blank values without key collisions', () => {
    expect(timelineGroupValue(true)).toEqual({ key: 'boolean:true', label: 'Checked', blank: false })
    expect(timelineGroupValue({ name: 'Ada', id: 2 })).toEqual({
      key: 'object:{"id":2,"name":"Ada"}',
      label: 'Ada',
      blank: false,
    })
    expect(timelineGroupValue(['Alpha', 'Beta']).label).toBe('Alpha, Beta')
    expect(timelineGroupValue(null)).toEqual({ key: 'blank:', label: 'Uncategorized', blank: true })
    expect(timelineGroupValue('Uncategorized').key).not.toBe(timelineGroupValue(null).key)
  })
})

describe('Timeline viewport virtualization', () => {
  it('returns a clamped end-exclusive day range with overscan', () => {
    expect(timelineVirtualRange(14, 120, 480, 360, 120)).toEqual({ start: 3, end: 8 })
    expect(timelineVirtualRange(14, 120, -50, 240, 0)).toEqual({ start: 0, end: 2 })
    expect(timelineVirtualRange(14, 120, 1_500, 360, 120)).toEqual({ start: 11, end: 14 })
    expect(timelineVirtualRange(14, 120, 5_000, 360, 120)).toEqual({ start: 14, end: 14 })
  })

  it('renders the complete bounded range until the viewport is measured', () => {
    expect(timelineVirtualRange(14, 120, 0, 0, 120)).toEqual({ start: 0, end: 14 })
    expect(timelineVirtualRange(0, 120, 0, 400, 120)).toEqual({ start: 0, end: 0 })
  })

  it('tests both axes with independent overscan and half-open edges', () => {
    const viewport = { left: 100, top: 100, width: 200, height: 100 }

    expect(timelineBoundsVisible({ left: 80, top: 80, width: 20, height: 20 }, viewport)).toBe(false)
    expect(timelineBoundsVisible({ left: 80, top: 80, width: 20, height: 20 }, viewport, 1, 1)).toBe(true)
    expect(timelineBoundsVisible({ left: 150, top: 120, width: 40, height: 30 }, viewport)).toBe(true)
    expect(timelineBoundsVisible({ left: 150, top: 220, width: 40, height: 30 }, viewport, 0, 19)).toBe(false)
    expect(timelineBoundsVisible({ left: 150, top: 220, width: 40, height: 30 }, viewport, 0, 21)).toBe(true)
  })

  it('keeps entries visible before measurement', () => {
    expect(
      timelineBoundsVisible({ left: 10_000, top: 10_000, width: 20, height: 20 }, { left: 0, top: 0, width: 0, height: 0 }),
    ).toBe(true)
  })
})

describe('Timeline rescheduling', () => {
  it('moves Date and DateTime fields by the same whole-day delta', () => {
    const patch = buildTimelineReschedulePatch(
      { Start: '2026-08-21', End: '2026-08-23T10:15:00.000Z' },
      { title: 'Start', uidt: 'Date' },
      { title: 'End', uidt: 'DateTime' },
      2,
    )

    expect(patch).toEqual({
      previous: { Start: '2026-08-21', End: '2026-08-23T10:15:00.000Z' },
      next: { Start: '2026-08-23', End: '2026-08-25T10:15:00.000Z' },
      fields: ['Start', 'End'],
    })
  })

  it('keeps a blank optional end field blank and out of the PATCH', () => {
    expect(
      buildTimelineReschedulePatch(
        { Start: '2026-08-21', End: null },
        { title: 'Start', uidt: 'Date' },
        { title: 'End', uidt: 'DateTime' },
        -1,
      ),
    ).toEqual({
      previous: { Start: '2026-08-21' },
      next: { Start: '2026-08-20' },
      fields: ['Start'],
    })
  })

  it('rejects no-op, invalid, and unsupported reschedules', () => {
    expect(buildTimelineReschedulePatch({ Start: '2026-08-21' }, { title: 'Start', uidt: 'Date' }, undefined, 0)).toBeUndefined()
    expect(buildTimelineReschedulePatch({ Start: 'not-a-date' }, { title: 'Start', uidt: 'Date' }, undefined, 1)).toBeUndefined()
    expect(buildTimelineReschedulePatch({ Start: '2026-08-21' }, { title: 'Start', uidt: 'Text' }, undefined, 1)).toBeUndefined()
    expect(
      buildTimelineReschedulePatch({ Start: '2026-08-21' }, { title: 'Start', uidt: 'Date' }, undefined, 0.5),
    ).toBeUndefined()
  })
})

describe('Timeline end resizing', () => {
  it('changes only a DateTime end by a whole-day delta', () => {
    expect(
      buildTimelineEndResizePatch(
        { Start: '2026-08-21', End: '2026-08-23T10:15:00.000Z' },
        { title: 'Start', uidt: 'Date' },
        { title: 'End', uidt: 'DateTime' },
        2,
      ),
    ).toEqual({
      previous: { End: '2026-08-23T10:15:00.000Z' },
      next: { End: '2026-08-25T10:15:00.000Z' },
      fields: ['End'],
    })
  })

  it('allows an inclusive Date end on the same calendar day as a DateTime start', () => {
    expect(
      buildTimelineEndResizePatch(
        { Start: '2026-08-21T22:00:00', End: '2026-08-22' },
        { title: 'Start', uidt: 'DateTime' },
        { title: 'End', uidt: 'Date' },
        -1,
      )?.next,
    ).toEqual({ End: '2026-08-21' })
  })

  it('rejects blank, reversed, no-op, unsupported, and same-field ends', () => {
    const start = { title: 'Start', uidt: 'Date' }
    const end = { title: 'End', uidt: 'Date' }

    expect(buildTimelineEndResizePatch({ Start: '2026-08-21', End: null }, start, end, 1)).toBeUndefined()
    expect(buildTimelineEndResizePatch({ Start: '2026-08-21', End: '2026-08-21' }, start, end, -1)).toBeUndefined()
    expect(buildTimelineEndResizePatch({ Start: '2026-08-21', End: '2026-08-22' }, start, end, 0)).toBeUndefined()
    expect(
      buildTimelineEndResizePatch({ Start: '2026-08-21', End: '2026-08-22' }, start, { ...end, uidt: 'Text' }, 1),
    ).toBeUndefined()
    expect(buildTimelineEndResizePatch({ Start: '2026-08-21' }, start, { title: 'Start', uidt: 'Date' }, 1)).toBeUndefined()
  })
})

describe('Timeline start resizing', () => {
  it('changes only a Date start by a whole-day delta', () => {
    expect(
      buildTimelineStartResizePatch(
        { Start: '2026-08-21', End: '2026-08-25T10:15:00.000Z' },
        { title: 'Start', uidt: 'Date' },
        { title: 'End', uidt: 'DateTime' },
        2,
      ),
    ).toEqual({
      previous: { Start: '2026-08-21' },
      next: { Start: '2026-08-23' },
      fields: ['Start'],
    })
  })

  it('allows a DateTime start on the same inclusive Date end day', () => {
    expect(
      buildTimelineStartResizePatch(
        { Start: '2026-08-20T22:00:00', End: '2026-08-21' },
        { title: 'Start', uidt: 'DateTime' },
        { title: 'End', uidt: 'Date' },
        1,
      )?.next,
    ).toEqual({ Start: new Date(2026, 7, 21, 22).toISOString() })
  })

  it('rejects blank, reversed, no-op, unsupported, and same-field starts', () => {
    const start = { title: 'Start', uidt: 'Date' }
    const end = { title: 'End', uidt: 'Date' }

    expect(buildTimelineStartResizePatch({ Start: '2026-08-21', End: null }, start, end, -1)).toBeUndefined()
    expect(buildTimelineStartResizePatch({ Start: '2026-08-21', End: '2026-08-21' }, start, end, 1)).toBeUndefined()
    expect(buildTimelineStartResizePatch({ Start: '2026-08-20', End: '2026-08-21' }, start, end, 0)).toBeUndefined()
    expect(
      buildTimelineStartResizePatch({ Start: '2026-08-20', End: '2026-08-21' }, { ...start, uidt: 'Text' }, end, 1),
    ).toBeUndefined()
    expect(buildTimelineStartResizePatch({ Start: '2026-08-21' }, start, { title: 'Start', uidt: 'Date' }, -1)).toBeUndefined()
  })
})
