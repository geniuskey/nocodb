import { describe, expect, it } from 'vitest'
import { buildTimelineReschedulePatch, layoutTimelineItems, timelineLaneCount } from '../../utils/timelineView'

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
