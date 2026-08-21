import {
  buildGanttCriticalPath,
  ganttDependencyStartOffset,
} from '~/helpers/ganttCriticalPath';

describe('Gantt critical path', () => {
  it('normalizes all dependency kinds into start constraints', () => {
    expect(ganttDependencyStartOffset('finish_start', 2, 3, 1)).toBe(3);
    expect(ganttDependencyStartOffset('start_start', 2, 3, 1)).toBe(1);
    expect(ganttDependencyStartOffset('finish_finish', 2, 3, 1)).toBe(0);
    expect(ganttDependencyStartOffset('start_finish', 2, 3, 1)).toBe(-2);
  });

  it('finds the longest branch and reports float on the shorter branch', () => {
    const result = buildGanttCriticalPath(
      [
        { id: 'a', duration: 2 },
        { id: 'b', duration: 4 },
        { id: 'c', duration: 1 },
      ],
      [
        { id: 'ab', source_record_id: 'a', target_record_id: 'b' },
        { id: 'ac', source_record_id: 'a', target_record_id: 'c' },
      ],
    );

    expect(result.components).toEqual([
      { record_ids: ['a', 'b', 'c'], project_duration: 6 },
    ]);
    expect(result.critical_dependency_ids).toEqual(['ab']);
    expect(result.tasks).toEqual([
      {
        record_id: 'a',
        duration: 2,
        earliest_start: 0,
        latest_start: 0,
        total_float: 0,
        critical: true,
      },
      {
        record_id: 'b',
        duration: 4,
        earliest_start: 2,
        latest_start: 2,
        total_float: 0,
        critical: true,
      },
      {
        record_id: 'c',
        duration: 1,
        earliest_start: 2,
        latest_start: 5,
        total_float: 3,
        critical: false,
      },
    ]);
  });

  it('computes each disconnected component against its own finish', () => {
    const result = buildGanttCriticalPath(
      [
        { id: 'a', duration: 2 },
        { id: 'b', duration: 1 },
        { id: 'x', duration: 7 },
        { id: 'y', duration: 2 },
      ],
      [
        { id: 'ab', source_record_id: 'a', target_record_id: 'b' },
        {
          id: 'xy',
          source_record_id: 'x',
          target_record_id: 'y',
          dependency_type: 'start_start',
          lag_days: 1,
        },
      ],
    );

    expect(result.components).toEqual([
      { record_ids: ['a', 'b'], project_duration: 3 },
      { record_ids: ['x', 'y'], project_duration: 7 },
    ]);
    expect(result.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_id: 'x', critical: true }),
        expect.objectContaining({
          record_id: 'y',
          critical: false,
          total_float: 4,
        }),
      ]),
    );
    expect(result.critical_dependency_ids).toEqual(['ab']);
  });

  it('rejects cycles and missing task endpoints defensively', () => {
    expect(() =>
      buildGanttCriticalPath(
        [
          { id: 'a', duration: 1 },
          { id: 'b', duration: 1 },
        ],
        [
          { source_record_id: 'a', target_record_id: 'b' },
          { source_record_id: 'b', target_record_id: 'a' },
        ],
      ),
    ).toThrow('cycle');
    expect(() =>
      buildGanttCriticalPath(
        [{ id: 'a', duration: 1 }],
        [{ source_record_id: 'a', target_record_id: 'missing' }],
      ),
    ).toThrow('endpoint is missing');
  });
});
