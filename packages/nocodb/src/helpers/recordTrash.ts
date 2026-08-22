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
    if (isRestorableTrashColumn(column) && column.title in row) {
      snapshot[column.title] = row[column.title];
    }
    return snapshot;
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
