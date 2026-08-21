import { UITypes } from 'nocodb-sdk';
import type { Column } from '~/models';
import {
  hashTrashRecordId,
  isRestorableTrashColumn,
  serializedByteLength,
  snapshotTrashRow,
  trashExpiryFrom,
} from '~/helpers/recordTrash';

describe('Record trash snapshots', () => {
  const column = (title: string, uidt: UITypes) => ({ title, uidt } as Column);

  it('keeps stored fields and excludes computed, relation, and audit fields', () => {
    const columns = [
      column('Id', UITypes.ID),
      column('Title', UITypes.SingleLineText),
      column('ForeignKey', UITypes.ForeignKey),
      column('Formula', UITypes.Formula),
      column('Relation', UITypes.LinkToAnotherRecord),
      column('CreatedAt', UITypes.CreatedTime),
      column('CreatedBy', UITypes.CreatedBy),
      column('Order', UITypes.Order),
    ];

    expect(isRestorableTrashColumn(columns[2])).toBe(true);
    expect(
      snapshotTrashRow(columns, {
        Id: 7,
        Title: 'Recover me',
        ForeignKey: 11,
        Formula: 'computed',
        Relation: [{ Id: 11 }],
        CreatedAt: '2026-08-22T00:00:00.000Z',
        CreatedBy: { id: 'user' },
        Order: 42,
      }),
    ).toEqual({ Id: 7, Title: 'Recover me', ForeignKey: 11 });
  });

  it('hashes canonical record IDs deterministically without exposing them', () => {
    expect(hashTrashRecordId('7')).toBe(hashTrashRecordId('7'));
    expect(hashTrashRecordId('7')).not.toBe(hashTrashRecordId('8'));
    expect(hashTrashRecordId('7')).toHaveLength(64);
  });

  it('uses UTF-8 byte limits and deterministic retention timestamps', () => {
    expect(serializedByteLength({ value: '한' })).toBe(
      Buffer.byteLength(JSON.stringify({ value: '한' }), 'utf8'),
    );
    expect(
      trashExpiryFrom(new Date('2026-08-22T00:00:00.000Z')).toISOString(),
    ).toBe('2026-09-21T00:00:00.000Z');
  });
});
