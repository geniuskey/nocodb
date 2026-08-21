import {
  buildGanttScheduleShifts,
  GANTT_SCHEDULE_DAY_MS,
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

describe('Gantt schedule propagation', () => {
  const day = GANTT_SCHEDULE_DAY_MS;
  const task = (id: string, start: number, duration = 2) => ({
    id,
    start: start * day,
    finish: (start + duration) * day,
  });

  it.each([
    ['finish_start', task('b', 1), 2],
    ['start_start', task('b', -1), 2],
    ['finish_finish', task('b', 0, 1), 2],
    ['start_finish', task('b', -2, 1), 2],
  ] as const)('applies %s constraints', (dependency_type, target, expected) => {
    expect(
      buildGanttScheduleShifts(
        [task('a', 0), target],
        [
          {
            id: 'edge',
            source_record_id: 'a',
            target_record_id: 'b',
            dependency_type,
            lag_days: 1,
          },
        ],
        ['a'],
      ),
    ).toEqual([
      {
        record_id: 'b',
        delta_days: expected,
        driving_dependency_ids: ['edge'],
      },
    ]);
  });

  it('cascades deterministically, preserves anchors, and selects the strongest constraint', () => {
    expect(
      buildGanttScheduleShifts(
        [task('a', 0), task('b', 0), task('c', 0), task('fixed', 10)],
        [
          { id: 'ab', source_record_id: 'a', target_record_id: 'b' },
          { id: 'bc', source_record_id: 'b', target_record_id: 'c' },
          {
            id: 'fixed-c',
            source_record_id: 'fixed',
            target_record_id: 'c',
            lag_days: -1,
          },
        ],
        ['a', 'fixed'],
      ),
    ).toEqual([
      { record_id: 'b', delta_days: 2, driving_dependency_ids: ['ab'] },
      {
        record_id: 'c',
        delta_days: 11,
        driving_dependency_ids: ['fixed-c'],
      },
    ]);
  });

  it('never pulls a task earlier when negative lag already satisfies a constraint', () => {
    expect(
      buildGanttScheduleShifts(
        [task('a', 0), task('b', 5)],
        [
          {
            id: 'edge',
            source_record_id: 'a',
            target_record_id: 'b',
            lag_days: -2,
          },
        ],
        ['a'],
      ),
    ).toEqual([]);
  });
});
