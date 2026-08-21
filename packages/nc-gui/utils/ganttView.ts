export interface GanttTaskInput<T = Record<string, any>> {
  id: string
  start: number
  end: number
  record: T
  milestone?: boolean
  progress?: number
}

export interface GanttTask<T = Record<string, any>> extends GanttTaskInput<T> {
  row: number
}

export function layoutGanttTasks<T>(items: GanttTaskInput<T>[]): GanttTask<T>[] {
  return items.map((item, row) => ({ ...item, row }))
}

export function normalizeGanttProgress(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(100, Math.max(0, parsed))
}

export function isGanttMilestone(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value !== 'string') return false
  return ['1', 'true', 'checked', 'yes'].includes(value.trim().toLowerCase())
}
