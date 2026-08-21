import type { GanttDependencyType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import Noco from '~/Noco';
import { extractProps } from '~/helpers/extractProps';
import { MetaTable } from '~/utils/globals';
import { hashGanttRecordId } from '~/helpers/ganttDependency';

export default class GanttDependency implements GanttDependencyType {
  id: string;
  fk_view_id: string;
  source_record_id: string;
  target_record_id: string;
  source_record_hash?: string;
  target_record_hash?: string;
  dependency_type: GanttDependencyType['dependency_type'];
  lag_days: number;
  fk_workspace_id?: string;
  base_id?: string;
  source_id?: string;
  created_at?: string;
  updated_at?: string;

  constructor(data: Partial<GanttDependency>) {
    Object.assign(this, data);
  }

  private static fromDb(data: any) {
    if (!data) return null;
    const { source_record_hash, target_record_hash, ...publicData } = data;
    return new GanttDependency(publicData);
  }

  static async get(
    context: NcContext,
    dependencyId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    return this.fromDb(
      await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.GANTT_DEPENDENCIES,
        { id: dependencyId },
      ),
    );
  }

  static async listAll(
    context: NcContext,
    viewId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<GanttDependency[]> {
    const dependencies = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.GANTT_DEPENDENCIES,
      {
        condition: { fk_view_id: viewId },
        orderBy: { created_at: 'asc' },
      },
    );
    return dependencies.map((dependency) => this.fromDb(dependency)!);
  }

  static async listForRecords(
    context: NcContext,
    viewId: string,
    recordIds: string[],
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<GanttDependency[]> {
    if (!recordIds.length) return [];
    const hashes = [...new Set(recordIds.map(hashGanttRecordId))];
    const dependencies = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.GANTT_DEPENDENCIES,
      {
        condition: { fk_view_id: viewId },
        xcCondition: {
          _and: [
            { source_record_hash: { in: hashes } },
            { target_record_hash: { in: hashes } },
          ],
        },
        orderBy: { created_at: 'asc' },
      },
    );
    return dependencies
      .filter(
        (dependency) =>
          hashes.includes(dependency.source_record_hash) &&
          hashes.includes(dependency.target_record_hash),
      )
      .map((dependency) => this.fromDb(dependency)!);
  }

  static async insert(
    context: NcContext,
    dependency: Partial<GanttDependency>,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const insertObj = extractProps(dependency, [
      'fk_view_id',
      'source_record_id',
      'target_record_id',
      'dependency_type',
      'lag_days',
      'source_id',
    ]);
    insertObj.source_record_hash = hashGanttRecordId(
      insertObj.source_record_id,
    );
    insertObj.target_record_hash = hashGanttRecordId(
      insertObj.target_record_id,
    );
    insertObj.dependency_type ??= 'finish_start';
    insertObj.lag_days ??= 0;

    return this.fromDb(
      await ncMeta.metaInsert2(
        context.workspace_id,
        context.base_id,
        MetaTable.GANTT_DEPENDENCIES,
        insertObj,
      ),
    );
  }

  static async update(
    context: NcContext,
    dependencyId: string,
    body: Partial<GanttDependency>,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const updateObj = extractProps(body, ['dependency_type', 'lag_days']);
    await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.GANTT_DEPENDENCIES,
      updateObj,
      dependencyId,
    );
    return this.get(context, dependencyId, ncMeta);
  }

  static async delete(
    context: NcContext,
    dependencyId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    await ncMeta.metaDelete(
      context.workspace_id,
      context.base_id,
      MetaTable.GANTT_DEPENDENCIES,
      dependencyId,
    );
  }

  static async copyAll(
    context: NcContext,
    sourceViewId: string,
    targetViewId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const dependencies = await this.listAll(context, sourceViewId, ncMeta);
    if (!dependencies.length) return;
    await ncMeta.bulkMetaInsert(
      context.workspace_id,
      context.base_id,
      MetaTable.GANTT_DEPENDENCIES,
      dependencies.map((dependency) => ({
        fk_view_id: targetViewId,
        source_record_id: dependency.source_record_id,
        target_record_id: dependency.target_record_id,
        source_record_hash: hashGanttRecordId(dependency.source_record_id),
        target_record_hash: hashGanttRecordId(dependency.target_record_id),
        dependency_type: dependency.dependency_type,
        lag_days: dependency.lag_days,
        source_id: dependency.source_id,
      })),
    );
  }
}
