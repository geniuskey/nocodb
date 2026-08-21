import { createHash } from 'node:crypto';
import type { GanttWorkingCalendarConfig } from '~/helpers/ganttWorkingCalendar';
import {
  ganttWorkingShiftForConstraint,
  shiftGanttDateFinishTimestamp,
  shiftGanttTimestamp,
} from '~/helpers/ganttWorkingCalendar';

export const GANTT_DEPENDENCY_TYPES = [
  'finish_start',
  'start_start',
  'finish_finish',
  'start_finish',
] as const;

export type GanttDependencyKind = (typeof GANTT_DEPENDENCY_TYPES)[number];

export interface GanttDependencyEdgeInput {
  id?: string;
  source_record_id: string;
  target_record_id: string;
  dependency_type?: GanttDependencyKind;
  lag_days?: number;
}

export interface GanttScheduleTaskInput {
  id: string;
  start: number;
  finish: number;
  finish_is_date?: boolean;
}

export interface GanttScheduleShift {
  record_id: string;
  delta_days: number;
  driving_dependency_ids: string[];
}

export const GANTT_DEPENDENCY_MAX_EDGES = 10_000;
export const GANTT_DEPENDENCY_MAX_RECORD_IDS = 1_000;
export const GANTT_DEPENDENCY_MAX_RECORD_ID_BYTES = 2_048;
export const GANTT_DEPENDENCY_MAX_LAG_DAYS = 3_650;
export const GANTT_SCHEDULE_MAX_TASKS = 1_000;
export const GANTT_SCHEDULE_MAX_ANCHORS = 100;
export const GANTT_SCHEDULE_DAY_MS = 86_400_000;

const ganttGraphLocks = new Map<string, Promise<void>>();

/** Serializes graph writers and schedule application within one server. */
export async function withGanttGraphLock<T>(
  viewId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = ganttGraphLocks.get(viewId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  ganttGraphLocks.set(viewId, tail);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (ganttGraphLocks.get(viewId) === tail) ganttGraphLocks.delete(viewId);
  }
}

export function normalizeGanttRecordId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value);
  if (!normalized.length) return null;
  if (
    Buffer.byteLength(normalized, 'utf8') > GANTT_DEPENDENCY_MAX_RECORD_ID_BYTES
  ) {
    return null;
  }
  return normalized;
}

export function hashGanttRecordId(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function isGanttDependencyKind(
  value: unknown,
): value is GanttDependencyKind {
  return GANTT_DEPENDENCY_TYPES.includes(value as GanttDependencyKind);
}

export function wouldCreateGanttDependencyCycle(
  edges: GanttDependencyEdgeInput[],
  sourceRecordId: string,
  targetRecordId: string,
): boolean {
  if (sourceRecordId === targetRecordId) return true;

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source_record_id) ?? [];
    targets.push(edge.target_record_id);
    outgoing.set(edge.source_record_id, targets);
  }

  const pending = [targetRecordId];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === sourceRecordId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

/**
 * Builds a deterministic, forward-only schedule. Anchor tasks remain fixed and
 * descendants are shifted by whole days while preserving their duration.
 */
export function buildGanttScheduleShifts(
  tasks: GanttScheduleTaskInput[],
  edges: GanttDependencyEdgeInput[],
  anchorRecordIds: string[],
  calendar?: GanttWorkingCalendarConfig,
): GanttScheduleShift[] {
  const taskById = new Map(tasks.map((task) => [task.id, { ...task }]));
  const anchors = new Set(anchorRecordIds);
  const outgoing = new Map<string, GanttDependencyEdgeInput[]>();
  const incoming = new Map<string, GanttDependencyEdgeInput[]>();

  for (const edge of edges) {
    outgoing.set(edge.source_record_id, [
      ...(outgoing.get(edge.source_record_id) ?? []),
      edge,
    ]);
    incoming.set(edge.target_record_id, [
      ...(incoming.get(edge.target_record_id) ?? []),
      edge,
    ]);
  }

  const affected = new Set<string>();
  const pending = [...anchors].sort().reverse();
  while (pending.length) {
    const current = pending.pop()!;
    for (const edge of outgoing.get(current) ?? []) {
      if (
        anchors.has(edge.target_record_id) ||
        affected.has(edge.target_record_id)
      ) {
        continue;
      }
      affected.add(edge.target_record_id);
      if (affected.size > GANTT_SCHEDULE_MAX_TASKS) {
        throw new Error(
          `Gantt schedule supports at most ${GANTT_SCHEDULE_MAX_TASKS} affected tasks`,
        );
      }
      pending.push(edge.target_record_id);
    }
  }

  const indegree = new Map([...affected].map((id) => [id, 0]));
  for (const id of affected) {
    for (const edge of incoming.get(id) ?? []) {
      if (affected.has(edge.source_record_id)) {
        indegree.set(id, (indegree.get(id) ?? 0) + 1);
      }
    }
  }

  const ready = [...affected].filter((id) => indegree.get(id) === 0).sort();
  const ordered: string[] = [];
  while (ready.length) {
    const current = ready.shift()!;
    ordered.push(current);
    for (const edge of outgoing.get(current) ?? []) {
      if (!affected.has(edge.target_record_id)) continue;
      const next = (indegree.get(edge.target_record_id) ?? 0) - 1;
      indegree.set(edge.target_record_id, next);
      if (next === 0) {
        ready.push(edge.target_record_id);
        ready.sort();
      }
    }
  }
  if (ordered.length !== affected.size) {
    throw new Error('Gantt dependency graph contains a cycle');
  }

  const result: GanttScheduleShift[] = [];
  for (const recordId of ordered) {
    const target = taskById.get(recordId);
    if (!target)
      throw new Error(`Gantt schedule task does not exist: ${recordId}`);

    let requiredDelta = 0;
    let drivers: string[] = [];
    for (const edge of incoming.get(recordId) ?? []) {
      const source = taskById.get(edge.source_record_id);
      if (!source) {
        throw new Error(
          `Gantt schedule task does not exist: ${edge.source_record_id}`,
        );
      }
      const kind = edge.dependency_type ?? 'finish_start';
      const sourceAnchor =
        kind === 'finish_start' || kind === 'finish_finish'
          ? source.finish
          : source.start;
      const targetAnchor =
        kind === 'finish_finish' || kind === 'start_finish'
          ? target.finish
          : target.start;
      let minimum: number;
      if (!calendar?.enabled) {
        minimum = sourceAnchor + (edge.lag_days ?? 0) * GANTT_SCHEDULE_DAY_MS;
      } else if (source.finish_is_date && kind === 'finish_start') {
        const nextWorkingStart = shiftGanttTimestamp(
          source.finish,
          1,
          calendar,
        );
        minimum = shiftGanttTimestamp(
          nextWorkingStart,
          edge.lag_days ?? 0,
          calendar,
        );
      } else if (source.finish_is_date && kind === 'finish_finish') {
        minimum = shiftGanttDateFinishTimestamp(
          source.finish,
          edge.lag_days ?? 0,
          calendar,
        );
      } else {
        minimum = shiftGanttTimestamp(
          sourceAnchor,
          edge.lag_days ?? 0,
          calendar,
        );
      }
      const delta = calendar?.enabled
        ? ganttWorkingShiftForConstraint(
            targetAnchor,
            target.start,
            minimum,
            calendar,
          )
        : Math.max(
            0,
            Math.ceil((minimum - targetAnchor) / GANTT_SCHEDULE_DAY_MS),
          );
      if (delta > requiredDelta) {
        requiredDelta = delta;
        drivers = edge.id ? [edge.id] : [];
      } else if (delta > 0 && delta === requiredDelta && edge.id) {
        drivers.push(edge.id);
      }
    }

    if (requiredDelta > 0) {
      target.start = calendar?.enabled
        ? shiftGanttTimestamp(target.start, requiredDelta, calendar)
        : target.start + requiredDelta * GANTT_SCHEDULE_DAY_MS;
      target.finish = calendar?.enabled
        ? target.finish_is_date
          ? shiftGanttDateFinishTimestamp(
              target.finish,
              requiredDelta,
              calendar,
            )
          : shiftGanttTimestamp(target.finish, requiredDelta, calendar)
        : target.finish + requiredDelta * GANTT_SCHEDULE_DAY_MS;
      result.push({
        record_id: recordId,
        delta_days: requiredDelta,
        driving_dependency_ids: [...new Set(drivers)].sort(),
      });
    }
  }
  return result;
}
