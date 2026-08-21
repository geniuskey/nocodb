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

export type GanttDependencyKind = 'finish_start' | 'start_start' | 'finish_finish' | 'start_finish'

export interface GanttDependencyInput {
  id: string
  source_record_id: string
  target_record_id: string
  dependency_type: GanttDependencyKind
  lag_days?: number
}

export interface GanttDependencyLink extends GanttDependencyInput {
  path: string
  labelX: number
  labelY: number
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

export function layoutGanttDependencyLinks<T>(
  tasks: GanttTask<T>[],
  dependencies: GanttDependencyInput[],
  options: {
    rangeStart: number
    pixelsPerDay: number
    tableWidth: number
    rowHeight: number
    dayMs: number
  },
): GanttDependencyLink[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const xFor = (task: GanttTask<T>, endpoint: 'start' | 'finish') =>
    options.tableWidth +
    (((endpoint === 'start' ? task.start : task.end) - options.rangeStart) / options.dayMs) * options.pixelsPerDay

  return dependencies.flatMap((dependency) => {
    const source = tasksById.get(dependency.source_record_id)
    const target = tasksById.get(dependency.target_record_id)
    if (!source || !target) return []

    const [sourceEndpoint, targetEndpoint] = dependency.dependency_type.split('_') as ['start' | 'finish', 'start' | 'finish']
    const sourceX = xFor(source, sourceEndpoint)
    const targetX = xFor(target, targetEndpoint)
    const sourceY = source.row * options.rowHeight + options.rowHeight / 2
    const targetY = target.row * options.rowHeight + options.rowHeight / 2
    const elbowX = targetX >= sourceX + 24 ? sourceX + (targetX - sourceX) / 2 : Math.max(sourceX, targetX) + 20

    return [
      {
        ...dependency,
        path: `M ${sourceX} ${sourceY} H ${elbowX} V ${targetY} H ${targetX}`,
        labelX: elbowX + 4,
        labelY: (sourceY + targetY) / 2 - 4,
      },
    ]
  })
}
