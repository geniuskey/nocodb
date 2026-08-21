import { describe, expect, it } from 'vitest'
import { isGanttMilestone, layoutGanttDependencyLinks, layoutGanttTasks, normalizeGanttProgress } from '../../utils/ganttView'

describe('Gantt task layout', () => {
  it('preserves server order and assigns one stable row per task', () => {
    const tasks = layoutGanttTasks([
      { id: 'later', start: 20, end: 30, record: { title: 'Later' } },
      { id: 'earlier', start: 10, end: 15, record: { title: 'Earlier' } },
    ])

    expect(tasks.map(({ id, row }) => ({ id, row }))).toEqual([
      { id: 'later', row: 0 },
      { id: 'earlier', row: 1 },
    ])
  })
})

describe('Gantt progress', () => {
  it('accepts finite numeric values and clamps them to the visible percentage range', () => {
    expect(normalizeGanttProgress('42.5')).toBe(42.5)
    expect(normalizeGanttProgress(-10)).toBe(0)
    expect(normalizeGanttProgress(150)).toBe(100)
  })

  it('leaves blank and invalid progress unmapped', () => {
    expect(normalizeGanttProgress(null)).toBeUndefined()
    expect(normalizeGanttProgress('')).toBeUndefined()
    expect(normalizeGanttProgress('not-a-number')).toBeUndefined()
  })
})

describe('Gantt milestones', () => {
  it('normalizes database checkbox representations without treating arbitrary values as true', () => {
    expect(isGanttMilestone(true)).toBe(true)
    expect(isGanttMilestone(1)).toBe(true)
    expect(isGanttMilestone('checked')).toBe(true)
    expect(isGanttMilestone('TRUE')).toBe(true)
    expect(isGanttMilestone(false)).toBe(false)
    expect(isGanttMilestone(0)).toBe(false)
    expect(isGanttMilestone('pending')).toBe(false)
  })
})

describe('Gantt dependency layout', () => {
  const tasks = layoutGanttTasks([
    { id: 'a', start: 0, end: 2, record: {} },
    { id: 'b', start: 10, end: 12, record: {} },
  ])
  const options = { rangeStart: 0, pixelsPerDay: 10, tableWidth: 100, rowHeight: 40, dayMs: 1 }

  it('anchors finish-to-start links to the matching task edges', () => {
    expect(
      layoutGanttDependencyLinks(
        tasks,
        [
          {
            id: 'edge',
            source_record_id: 'a',
            target_record_id: 'b',
            dependency_type: 'finish_start',
          },
        ],
        options,
      ),
    ).toEqual([expect.objectContaining({ path: 'M 120 20 H 160 V 60 H 200' })])
  })

  it('omits edges when either endpoint is outside the mounted task set', () => {
    expect(
      layoutGanttDependencyLinks(
        tasks,
        [
          {
            id: 'edge',
            source_record_id: 'a',
            target_record_id: 'missing',
            dependency_type: 'finish_start',
          },
        ],
        options,
      ),
    ).toEqual([])
  })
})
