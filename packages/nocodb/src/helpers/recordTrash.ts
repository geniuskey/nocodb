import { createHash } from 'node:crypto';
import { isVirtualCol, UITypes } from 'nocodb-sdk';
import type { Column } from '~/models';

export const RECORD_TRASH_MAX_BATCH_SIZE = 100;
export const RECORD_TRASH_MAX_RECORD_ID_BYTES = 2048;
export const RECORD_TRASH_MAX_ROW_BYTES = 1024 * 1024;
export const RECORD_TRASH_MAX_BATCH_BYTES = 10 * 1024 * 1024;
export const RECORD_TRASH_RETENTION_DAYS = 30;
export const RECORD_TRASH_CLEANUP_BATCH_SIZE = 500;
export const RECORD_TRASH_CLEANUP_MAX_RECORDS = 10_000;
export const RECORD_TRASH_CLEANUP_CRON = '15 * * * *';

export function isRecordTrashCleanupEnabled(
  disabled = process.env.NC_RECORD_TRASH_CLEANUP_DISABLED,
): boolean {
  return disabled !== 'true';
}

export function hashTrashRecordId(recordId: string): string {
  return createHash('sha256').update(recordId).digest('hex');
}

export function isRestorableTrashColumn(column: Column): boolean {
  return (
    Boolean(column.title) &&
    !isVirtualCol(column) &&
    column.uidt !== UITypes.Order
  );
}

export function snapshotTrashRow(
  columns: Column[],
  row: Record<string, unknown>,
): Record<string, unknown> {
  return columns.reduce<Record<string, unknown>>((snapshot, column) => {
    const key = [column.title, column.column_name, column.id].find(
      (candidate) =>
        candidate && Object.prototype.hasOwnProperty.call(row, candidate),
    );
    if (isRestorableTrashColumn(column) && key) {
      snapshot[column.title] = row[key];
    }
    return snapshot;
  }, {});
}

export function snapshotTrashFieldMap(
  columns: Column[],
  row: Record<string, unknown>,
): Record<string, string> {
  return columns.reduce<Record<string, string>>((snapshot, column) => {
    if (
      column.id &&
      isRestorableTrashColumn(column) &&
      [column.title, column.column_name, column.id].some((key) =>
        Object.prototype.hasOwnProperty.call(row, key),
      )
    ) {
      snapshot[column.id] = column.title;
    }
    return snapshot;
  }, {});
}

export function projectTrashRow(
  columns: Column[],
  rowData: Record<string, unknown>,
  fieldMap?: Record<string, string>,
): Record<string, unknown> {
  const currentById = new Map(columns.map((column) => [column.id, column]));
  if (fieldMap && Object.keys(fieldMap).length) {
    return Object.entries(fieldMap).reduce<Record<string, unknown>>(
      (projected, [columnId, oldTitle]) => {
        const column = currentById.get(columnId);
        if (
          column &&
          isRestorableTrashColumn(column) &&
          Object.prototype.hasOwnProperty.call(rowData, oldTitle)
        ) {
          projected[column.title] = rowData[oldTitle];
        }
        return projected;
      },
      {},
    );
  }

  return columns.reduce<Record<string, unknown>>((projected, column) => {
    if (
      isRestorableTrashColumn(column) &&
      Object.prototype.hasOwnProperty.call(rowData, column.title)
    ) {
      projected[column.title] = rowData[column.title];
    }
    return projected;
  }, {});
}

export function serializedByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function trashExpiryFrom(
  deletedAt: Date,
  retentionDays = RECORD_TRASH_RETENTION_DAYS,
): Date {
  return new Date(deletedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}
