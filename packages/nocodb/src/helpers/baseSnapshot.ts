import type { NcContext } from '~/interface/config';
import type { SnapshotManifest } from '~/models/Snapshot';
import { SNAPSHOT_FORMAT_VERSION } from '~/models/Snapshot';
import { Base, Model } from '~/models';
import NcConnectionMgrv2 from '~/utils/common/NcConnectionMgrv2';

export async function buildSnapshotManifest(
  context: NcContext,
  base: Base,
  sourceVersion: string,
): Promise<SnapshotManifest> {
  const sources = await base.getSources();
  const tables: SnapshotManifest['tables'] = [];

  for (const source of sources) {
    const models = (await source.getModels(context))
      .filter((model) => !model.mm && model.type === 'table')
      .sort((left, right) => left.title.localeCompare(right.title));
    const dbDriver = await NcConnectionMgrv2.get(source);

    for (const model of models) {
      await model.getColumns(context);
      const baseModel = await Model.getBaseModelSQL(context, {
        model,
        source,
        dbDriver,
      });
      tables.push({
        title: model.title,
        column_count: model.columns.length,
        record_count: Number(await baseModel.count()),
      });
    }
  }

  return {
    format: 'nocodb-community-base-snapshot',
    format_version: SNAPSHOT_FORMAT_VERSION,
    source_version: sourceVersion,
    source_base_id: context.base_id,
    storage_base_id: base.id,
    captured_at: new Date().toISOString(),
    tables,
  };
}

export function snapshotManifestMatches(
  stored: SnapshotManifest,
  current: SnapshotManifest,
): boolean {
  if (
    stored.format !== current.format ||
    stored.format_version !== current.format_version ||
    stored.storage_base_id !== current.storage_base_id
  ) {
    return false;
  }
  return JSON.stringify(stored.tables) === JSON.stringify(current.tables);
}
