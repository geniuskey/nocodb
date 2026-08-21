import { createHash } from 'node:crypto';

export const GANTT_DEPENDENCY_TYPES = [
  'finish_start',
  'start_start',
  'finish_finish',
  'start_finish',
] as const;

export type GanttDependencyKind = (typeof GANTT_DEPENDENCY_TYPES)[number];

export interface GanttDependencyEdgeInput {
  source_record_id: string;
  target_record_id: string;
}

export const GANTT_DEPENDENCY_MAX_EDGES = 10_000;
export const GANTT_DEPENDENCY_MAX_RECORD_IDS = 1_000;
export const GANTT_DEPENDENCY_MAX_RECORD_ID_BYTES = 2_048;
export const GANTT_DEPENDENCY_MAX_LAG_DAYS = 3_650;

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
