import type { SnapshotManifest } from '~/models/Snapshot';
import { snapshotManifestMatches } from '~/helpers/baseSnapshot';

const manifest = (
  overrides: Partial<SnapshotManifest> = {},
): SnapshotManifest => ({
  format: 'nocodb-community-base-snapshot',
  format_version: 1,
  source_version: '0.111.4',
  source_base_id: 'source-base',
  storage_base_id: 'snapshot-base',
  captured_at: '2026-01-01T00:00:00.000Z',
  tables: [{ title: 'Tasks', column_count: 3, record_count: 2 }],
  ...overrides,
});

describe('Base snapshot manifest validation', () => {
  it('accepts an unchanged storage tree independent of capture metadata', () => {
    expect(
      snapshotManifestMatches(
        manifest(),
        manifest({
          source_base_id: 'snapshot-base',
          captured_at: '2026-02-01T00:00:00.000Z',
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['format', { format: 'unknown-format' }],
    ['format version', { format_version: 2 }],
    ['storage identity', { storage_base_id: 'another-base' }],
    [
      'table schema',
      { tables: [{ title: 'Tasks', column_count: 4, record_count: 2 }] },
    ],
    [
      'record count',
      { tables: [{ title: 'Tasks', column_count: 3, record_count: 3 }] },
    ],
  ])('rejects a mismatched %s', (_label, overrides) => {
    expect(
      snapshotManifestMatches(
        manifest(),
        manifest(overrides as Partial<SnapshotManifest>),
      ),
    ).toBe(false);
  });
});
