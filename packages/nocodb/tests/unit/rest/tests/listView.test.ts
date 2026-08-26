import 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { UITypes, ViewTypes } from 'nocodb-sdk';
import init from '../../init';
import { createProject } from '../../factory/base';
import { createTable } from '../../factory/table';
import { createRow } from '../../factory/row';
import { createView } from '../../factory/view';
import { ListView, View } from '../../../../src/models';

export default function listViewTests() {
  describe('List view foundation', function () {
    let context;
    let base;
    let table;
    let ctx;

    before(async function () {
      context = await init();
      base = await createProject(context);
      table = await createTable(context, base, {
        table_name: 'list_records',
        title: 'List Records',
        columns: [
          { column_name: 'id', title: 'Id', uidt: UITypes.ID },
          {
            column_name: 'title',
            title: 'Title',
            uidt: UITypes.SingleLineText,
          },
          {
            column_name: 'notes',
            title: 'Notes',
            uidt: UITypes.LongText,
          },
        ],
      });
      ctx = {
        workspace_id: base.fk_workspace_id,
        base_id: base.id,
      };
    });

    it('creates, reads, updates, and deletes additive List metadata', async function () {
      const view = await createView(context, {
        title: 'Independent List',
        table,
        type: ViewTypes.LIST,
      });

      expect(view.type).to.equal(ViewTypes.LIST);
      expect(view.id).to.be.a('string');

      const read = await request(context.app)
        .get(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      expect(read.body.fk_view_id).to.equal(view.id);

      await request(context.app)
        .patch(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', context.token)
        .send({ row_height: 2, meta: { schemaVersion: 1 } })
        .expect(200);

      const updated = await ListView.get(ctx, view.id!);
      expect(updated.row_height).to.equal(2);
      expect(updated.meta).to.deep.equal({ schemaVersion: 1 });

      const columns = await view.getColumns(ctx);
      expect(columns).to.have.length.greaterThan(1);
      await request(context.app)
        .patch(`/api/v1/db/meta/views/${view.id}/columns/${columns[1].id}`)
        .set('xc-auth', context.token)
        .send({ show: false, width: '320px' })
        .expect(200);
      const changed = (await view.getColumns(ctx)).find(
        (column) => column.id === columns[1].id,
      );
      expect(changed?.show).to.equal(false);
      expect(changed?.width).to.equal('320px');

      await request(context.app)
        .delete(`/api/v1/db/meta/views/${view.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      expect(await View.get(ctx, view.id!)).to.equal(undefined);
    });

    it('uses compatible record APIs for List CRUD and view reads', async function () {
      const view = await createView(context, {
        title: 'List CRUD',
        table,
        type: ViewTypes.LIST,
      });
      const row = await createRow(context, { base, table, index: 7 });
      const secondRow = await createRow(context, { base, table, index: 8 });
      const titleColumn = (await table.getColumns(ctx)).find(
        (column) => column.title === 'Title',
      );
      const notesColumn = (await table.getColumns(ctx)).find(
        (column) => column.title === 'Notes',
      );

      await request(context.app)
        .patch(`/api/v1/db/data/noco/${base.id}/${table.id}/${row.Id}`)
        .set('xc-auth', context.token)
        .send({ title: 'Alpha List Record' })
        .expect(200);
      await request(context.app)
        .patch(`/api/v1/db/data/noco/${base.id}/${table.id}/${secondRow.Id}`)
        .set('xc-auth', context.token)
        .send({ title: 'Beta List Record' })
        .expect(200);

      const list = await request(context.app)
        .get(`/api/v1/db/data/noco/${base.id}/${table.id}/views/${view.id}`)
        .set('xc-auth', context.token)
        .query({
          fields: ['Title'],
          filterArrJson: JSON.stringify([
            {
              fk_column_id: titleColumn?.id,
              status: 'create',
              logical_op: 'and',
              comparison_op: 'like',
              value: 'List Record',
            },
          ]),
          sortArrJson: JSON.stringify([
            { fk_column_id: titleColumn?.id, direction: 'desc' },
          ]),
        })
        .expect(200);
      expect(list.body.list.map((record) => record.Title)).to.deep.equal([
        'Beta List Record',
        'Alpha List Record',
      ]);

      const update = await request(context.app)
        .patch(`/api/v1/db/data/noco/${base.id}/${table.id}/${row.Id}`)
        .set('xc-auth', context.token)
        .send({ title: 'Updated from List' })
        .expect(200);
      expect(update.body.Title).to.equal('Updated from List');

      const listNotesColumn = (await view.getColumns(ctx)).find(
        (column) => column.fk_column_id === notesColumn?.id,
      );
      await request(context.app)
        .patch(`/api/v1/db/meta/views/${view.id}/columns/${listNotesColumn?.id}`)
        .set('xc-auth', context.token)
        .send({ show: false })
        .expect(200);
      expect(
        (await view.getColumns(ctx)).find(
          (column) => column.id === listNotesColumn?.id,
        )?.show,
      ).to.equal(false);
      const hiddenFieldResponse = await request(context.app)
        .get(`/api/v1/db/data/noco/${base.id}/${table.id}/views/${view.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      expect(hiddenFieldResponse.body.list[0]).not.to.have.property('Notes');

      await request(context.app)
        .delete(`/api/v1/db/data/noco/${base.id}/${table.id}/${row.Id}`)
        .set('xc-auth', context.token)
        .expect(200);

      const afterDelete = await request(context.app)
        .get(`/api/v1/db/data/noco/${base.id}/${table.id}/views/${view.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      expect(
        afterDelete.body.list.some((record) => record.Id === row.Id),
      ).to.equal(false);
    });
  });
}
