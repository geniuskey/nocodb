import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bull';
import {
  RECORD_TRASH_CLEANUP_BATCH_SIZE,
  RECORD_TRASH_CLEANUP_MAX_RECORDS,
} from '~/helpers/recordTrash';
import { RecordTrash, ViewTrash } from '~/models';

export type RecordTrashCleanupResult = {
  deleted: number;
  processed: number;
  limitReached: boolean;
};

export async function cleanExpiredRecordTrash(
  deleteBatch: (
    cutoff: Date,
    limit: number,
  ) => Promise<{ selected: number; deleted: number }> = (cutoff, limit) =>
    RecordTrash.deleteExpiredBatch(cutoff, limit),
  options: {
    cutoff?: Date;
    batchSize?: number;
    maxRecords?: number;
  } = {},
): Promise<RecordTrashCleanupResult> {
  const cutoff = options.cutoff ?? new Date();
  const batchSize = options.batchSize ?? RECORD_TRASH_CLEANUP_BATCH_SIZE;
  const maxRecords = options.maxRecords ?? RECORD_TRASH_CLEANUP_MAX_RECORDS;
  let deleted = 0;
  let processed = 0;
  let batchFilled = false;

  while (processed < maxRecords) {
    const limit = Math.min(batchSize, maxRecords - processed);
    const result = await deleteBatch(cutoff, limit);
    processed += result.selected;
    deleted += result.deleted;
    batchFilled = result.selected === limit;
    if (!batchFilled) break;
  }

  return {
    deleted,
    processed,
    limitReached: processed === maxRecords && batchFilled,
  };
}

@Injectable()
export class RecordTrashCleanUpProcessor {
  private readonly logger = new Logger(RecordTrashCleanUpProcessor.name);

  async job(_job: Job): Promise<RecordTrashCleanupResult> {
    const cutoff = new Date();
    const [recordResult, viewResult] = await Promise.all([
      cleanExpiredRecordTrash(
        (batchCutoff, limit) =>
          RecordTrash.deleteExpiredBatch(batchCutoff, limit),
        { cutoff },
      ),
      cleanExpiredRecordTrash(
        (batchCutoff, limit) =>
          ViewTrash.deleteExpiredBatch(batchCutoff, limit),
        { cutoff },
      ),
    ]);
    const result = {
      deleted: recordResult.deleted + viewResult.deleted,
      processed: recordResult.processed + viewResult.processed,
      limitReached: recordResult.limitReached || viewResult.limitReached,
    };
    if (result.deleted || result.limitReached) {
      this.logger.log(
        `Deleted ${result.deleted} expired trash snapshots${
          result.limitReached ? '; per-run limit reached' : ''
        }`,
      );
    }
    return result;
  }
}
