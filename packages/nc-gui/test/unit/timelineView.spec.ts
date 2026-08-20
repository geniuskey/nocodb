import { describe, expect, it } from 'vitest'
import { layoutTimelineItems, timelineLaneCount } from '../../utils/timelineView'

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
