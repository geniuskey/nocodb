import {
  hashGanttRecordId,
  normalizeGanttRecordId,
  wouldCreateGanttDependencyCycle,
} from '~/helpers/ganttDependency';

describe('Gantt dependency graph', () => {
  it('normalizes bounded scalar record identities without trimming significant data', () => {
    expect(normalizeGanttRecordId(42)).toBe('42');
    expect(normalizeGanttRecordId(' task ')).toBe(' task ');
    expect(normalizeGanttRecordId('')).toBeNull();
    expect(normalizeGanttRecordId('x'.repeat(2049))).toBeNull();
  });

  it('hashes record identities deterministically', () => {
    expect(hashGanttRecordId('record-1')).toHaveLength(64);
    expect(hashGanttRecordId('record-1')).toBe(hashGanttRecordId('record-1'));
    expect(hashGanttRecordId('record-1')).not.toBe(
      hashGanttRecordId('record-2'),
    );
  });

  it('rejects self edges and edges that close a directed path', () => {
    const edges = [
      { source_record_id: 'a', target_record_id: 'b' },
      { source_record_id: 'b', target_record_id: 'c' },
    ];
    expect(wouldCreateGanttDependencyCycle(edges, 'c', 'a')).toBe(true);
    expect(wouldCreateGanttDependencyCycle(edges, 'a', 'a')).toBe(true);
    expect(wouldCreateGanttDependencyCycle(edges, 'c', 'd')).toBe(false);
  });
});
