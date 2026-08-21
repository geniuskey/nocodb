import { describe, expect, it } from 'vitest'
import { isGanttMilestone, layoutGanttTasks, normalizeGanttProgress } from '../../utils/ganttView'

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
