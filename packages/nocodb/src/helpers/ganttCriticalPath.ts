import type {
  GanttDependencyEdgeInput,
  GanttDependencyKind,
} from '~/helpers/ganttDependency';

export interface GanttCriticalPathTaskInput {
  id: string;
  duration: number;
}

export interface GanttCriticalPathTaskResult {
  record_id: string;
  duration: number;
  earliest_start: number;
  latest_start: number;
  total_float: number;
  critical: boolean;
}

export interface GanttCriticalPathComponentResult {
  record_ids: string[];
  project_duration: number;
}

export interface GanttCriticalPathResult {
  tasks: GanttCriticalPathTaskResult[];
  components: GanttCriticalPathComponentResult[];
  critical_dependency_ids: string[];
}

const CRITICAL_EPSILON = 1;

export function ganttDependencyStartOffset(
  dependencyType: GanttDependencyKind,
  sourceDuration: number,
  targetDuration: number,
  lag: number,
) {
  switch (dependencyType) {
    case 'finish_start':
      return sourceDuration + lag;
    case 'start_start':
      return lag;
    case 'finish_finish':
      return sourceDuration - targetDuration + lag;
    case 'start_finish':
      return -targetDuration + lag;
  }
}

/**
 * Computes component-local CPM values from generalized start constraints.
 * Every edge is represented as S(target) >= S(source) + offset.
 */
export function buildGanttCriticalPath(
  tasks: GanttCriticalPathTaskInput[],
  edges: GanttDependencyEdgeInput[],
): GanttCriticalPathResult {
  const taskById = new Map<string, GanttCriticalPathTaskInput>();
  for (const task of tasks) {
    if (
      taskById.has(task.id) ||
      !Number.isFinite(task.duration) ||
      task.duration < 0
    ) {
      throw new Error(`Gantt critical-path task is invalid: ${task.id}`);
    }
    taskById.set(task.id, task);
  }

  const outgoing = new Map<string, GanttDependencyEdgeInput[]>();
  const incoming = new Map<string, GanttDependencyEdgeInput[]>();
  const neighbours = new Map<string, Set<string>>();
  for (const task of tasks) neighbours.set(task.id, new Set());
  for (const edge of edges) {
    if (
      !taskById.has(edge.source_record_id) ||
      !taskById.has(edge.target_record_id)
    ) {
      throw new Error('Gantt critical-path dependency endpoint is missing');
    }
    outgoing.set(edge.source_record_id, [
      ...(outgoing.get(edge.source_record_id) ?? []),
      edge,
    ]);
    incoming.set(edge.target_record_id, [
      ...(incoming.get(edge.target_record_id) ?? []),
      edge,
    ]);
    neighbours.get(edge.source_record_id)!.add(edge.target_record_id);
    neighbours.get(edge.target_record_id)!.add(edge.source_record_id);
  }

  const components: string[][] = [];
  const unvisited = new Set([...taskById.keys()].sort());
  while (unvisited.size) {
    const first = unvisited.values().next().value as string;
    const component: string[] = [];
    const pending = [first];
    unvisited.delete(first);
    while (pending.length) {
      const current = pending.pop()!;
      component.push(current);
      for (const neighbour of [...(neighbours.get(current) ?? [])].sort()) {
        if (!unvisited.delete(neighbour)) continue;
        pending.push(neighbour);
      }
    }
    components.push(component.sort());
  }
  components.sort((left, right) => left[0].localeCompare(right[0]));

  const taskResults: GanttCriticalPathTaskResult[] = [];
  const componentResults: GanttCriticalPathComponentResult[] = [];
  const criticalDependencyIds = new Set<string>();

  for (const component of components) {
    const componentSet = new Set(component);
    const indegree = new Map(
      component.map((recordId) => [
        recordId,
        (incoming.get(recordId) ?? []).filter((edge) =>
          componentSet.has(edge.source_record_id),
        ).length,
      ]),
    );
    const ready = component.filter((id) => indegree.get(id) === 0).sort();
    const ordered: string[] = [];
    while (ready.length) {
      const current = ready.shift()!;
      ordered.push(current);
      for (const edge of outgoing.get(current) ?? []) {
        if (!componentSet.has(edge.target_record_id)) continue;
        const next = (indegree.get(edge.target_record_id) ?? 0) - 1;
        indegree.set(edge.target_record_id, next);
        if (next === 0) {
          ready.push(edge.target_record_id);
          ready.sort();
        }
      }
    }
    if (ordered.length !== component.length) {
      throw new Error('Gantt dependency graph contains a cycle');
    }

    const earliestStart = new Map(component.map((id) => [id, 0]));
    for (const sourceId of ordered) {
      const source = taskById.get(sourceId)!;
      for (const edge of outgoing.get(sourceId) ?? []) {
        if (!componentSet.has(edge.target_record_id)) continue;
        const target = taskById.get(edge.target_record_id)!;
        const offset = ganttDependencyStartOffset(
          edge.dependency_type ?? 'finish_start',
          source.duration,
          target.duration,
          edge.lag_days ?? 0,
        );
        earliestStart.set(
          target.id,
          Math.max(
            earliestStart.get(target.id) ?? 0,
            (earliestStart.get(source.id) ?? 0) + offset,
          ),
        );
      }
    }

    const projectDuration = Math.max(
      0,
      ...component.map(
        (id) => (earliestStart.get(id) ?? 0) + taskById.get(id)!.duration,
      ),
    );
    const latestStart = new Map(
      component.map((id) => [id, projectDuration - taskById.get(id)!.duration]),
    );
    for (const sourceId of [...ordered].reverse()) {
      const source = taskById.get(sourceId)!;
      for (const edge of outgoing.get(sourceId) ?? []) {
        if (!componentSet.has(edge.target_record_id)) continue;
        const target = taskById.get(edge.target_record_id)!;
        const offset = ganttDependencyStartOffset(
          edge.dependency_type ?? 'finish_start',
          source.duration,
          target.duration,
          edge.lag_days ?? 0,
        );
        latestStart.set(
          source.id,
          Math.min(
            latestStart.get(source.id)!,
            latestStart.get(target.id)! - offset,
          ),
        );
      }
    }

    const criticalIds = new Set<string>();
    for (const recordId of ordered) {
      const earliest = earliestStart.get(recordId)!;
      const latest = latestStart.get(recordId)!;
      const totalFloat = Math.max(0, latest - earliest);
      const critical = totalFloat <= CRITICAL_EPSILON;
      if (critical) criticalIds.add(recordId);
      taskResults.push({
        record_id: recordId,
        duration: taskById.get(recordId)!.duration,
        earliest_start: earliest,
        latest_start: latest,
        total_float: critical ? 0 : totalFloat,
        critical,
      });
    }

    for (const edge of edges) {
      if (
        !edge.id ||
        !componentSet.has(edge.source_record_id) ||
        !criticalIds.has(edge.source_record_id) ||
        !criticalIds.has(edge.target_record_id)
      ) {
        continue;
      }
      const source = taskById.get(edge.source_record_id)!;
      const target = taskById.get(edge.target_record_id)!;
      const offset = ganttDependencyStartOffset(
        edge.dependency_type ?? 'finish_start',
        source.duration,
        target.duration,
        edge.lag_days ?? 0,
      );
      if (
        Math.abs(
          earliestStart.get(target.id)! -
            earliestStart.get(source.id)! -
            offset,
        ) <= CRITICAL_EPSILON
      ) {
        criticalDependencyIds.add(edge.id);
      }
    }

    componentResults.push({
      record_ids: [...component],
      project_duration: projectDuration,
    });
  }

  return {
    tasks: taskResults.sort((left, right) =>
      left.record_id.localeCompare(right.record_id),
    ),
    components: componentResults,
    critical_dependency_ids: [...criticalDependencyIds].sort(),
  };
}
