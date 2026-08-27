import 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { ProjectRoles, UITypes, ViewLockType, ViewTypes } from 'nocodb-sdk';
import init from '../../init';
import { createProject } from '../../factory/base';
import { createTable } from '../../factory/table';
import { createChildRow, createRow } from '../../factory/row';
import { createLtarColumn } from '../../factory/column';
import { createView } from '../../factory/view';
import { Filter, ListView, ListViewLevel, View } from '../../../../src/models';

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
        .patch(
          `/api/v1/db/meta/views/${view.id}/columns/${listNotesColumn?.id}`,
        )
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

    it('renames, locks, duplicates, and deletes a List without losing configuration', async function () {
      const view = await createView(context, {
        title: 'Lifecycle List',
        table,
        type: ViewTypes.LIST,
      });
      const columns = await table.getColumns(ctx);
      const titleColumn = columns.find((column) => column.title === 'Title');
      const notesColumn = columns.find((column) => column.title === 'Notes');
      const notesViewColumn = (await view.getColumns(ctx)).find(
        (column) => column.fk_column_id === notesColumn?.id,
      );

      await request(context.app)
        .patch(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', context.token)
        .send({ row_height: 2, meta: { schemaVersion: 1 } })
        .expect(200);
      await request(context.app)
        .patch(
          `/api/v1/db/meta/views/${view.id}/columns/${notesViewColumn?.id}`,
        )
        .set('xc-auth', context.token)
        .send({ show: false, width: '280px' })
        .expect(200);
      await request(context.app)
        .post(`/api/v1/db/meta/views/${view.id}/sorts`)
        .set('xc-auth', context.token)
        .send({ fk_column_id: titleColumn?.id, direction: 'desc' })
        .expect(200);
      await request(context.app)
        .post(`/api/v1/db/meta/views/${view.id}/filters`)
        .set('xc-auth', context.token)
        .send({
          fk_column_id: titleColumn?.id,
          comparison_op: 'like',
          value: 'Lifecycle',
          logical_op: 'and',
        })
        .expect(200);

      const renamed = await request(context.app)
        .patch(`/api/v1/db/meta/views/${view.id}`)
        .set('xc-auth', context.token)
        .send({ title: 'Lifecycle List Renamed' })
        .expect(200);
      expect(renamed.body.title).to.equal('Lifecycle List Renamed');

      const duplicateResponse = await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/lists`)
        .set('xc-auth', context.token)
        .send({
          title: 'Lifecycle List Copy',
          type: ViewTypes.LIST,
          copy_from_id: view.id,
        })
        .expect(200);
      const duplicate = await View.get(ctx, duplicateResponse.body.id);
      const duplicateMeta = await ListView.get(ctx, duplicate.id!);
      expect(duplicateMeta.row_height).to.equal(2);
      expect(duplicateMeta.meta).to.deep.equal({ schemaVersion: 1 });

      const duplicateNotes = (await duplicate.getColumns(ctx)).find(
        (column) => column.fk_column_id === notesColumn?.id,
      );
      expect(Boolean(duplicateNotes?.show)).to.equal(false);
      expect(duplicateNotes?.width).to.equal('280px');
      const duplicateSorts = await duplicate.getSorts(ctx);
      expect(duplicateSorts).to.have.length(1);
      expect(duplicateSorts[0]).to.include({
        fk_column_id: titleColumn?.id,
        direction: 'desc',
      });
      const duplicateFilters = await Filter.rootFilterList(ctx, {
        viewId: duplicate.id!,
      });
      expect(duplicateFilters).to.have.length(1);
      expect(duplicateFilters[0]).to.include({
        fk_column_id: titleColumn?.id,
        comparison_op: 'like',
        value: 'Lifecycle',
      });

      const locked = await request(context.app)
        .patch(`/api/v1/db/meta/views/${view.id}`)
        .set('xc-auth', context.token)
        .send({ lock_type: ViewLockType.Locked })
        .expect(200);
      expect(locked.body.lock_type).to.equal(ViewLockType.Locked);

      const grid = await createView(context, {
        title: 'Invalid List copy source',
        table,
        type: ViewTypes.GRID,
      });
      await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/lists`)
        .set('xc-auth', context.token)
        .send({
          title: 'Invalid List Copy',
          type: ViewTypes.LIST,
          copy_from_id: grid.id,
        })
        .expect(400);
      expect(
        await View.getByTitleOrId(ctx, {
          titleOrId: 'Invalid List Copy',
          fk_model_id: table.id,
        }),
      ).to.equal(undefined);

      const otherTable = await createTable(context, base, {
        table_name: 'list_copy_source_other_table',
        title: 'List Copy Source Other Table',
        columns: [
          { column_name: 'id', title: 'Id', uidt: UITypes.ID },
          {
            column_name: 'title',
            title: 'Title',
            uidt: UITypes.SingleLineText,
          },
        ],
      });
      const otherList = await createView(context, {
        title: 'Other table List',
        table: otherTable,
        type: ViewTypes.LIST,
      });
      await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/lists`)
        .set('xc-auth', context.token)
        .send({
          title: 'Invalid Cross-table List Copy',
          type: ViewTypes.LIST,
          copy_from_id: otherList.id,
        })
        .expect(400);
      expect(
        await View.getByTitleOrId(ctx, {
          titleOrId: 'Invalid Cross-table List Copy',
          fk_model_id: table.id,
        }),
      ).to.equal(undefined);

      await request(context.app)
        .delete(`/api/v1/db/meta/views/${duplicate.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      await request(context.app)
        .delete(`/api/v1/db/meta/views/${view.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      await request(context.app)
        .delete(`/api/v1/db/meta/views/${grid.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      await request(context.app)
        .delete(`/api/v1/db/meta/views/${otherList.id}`)
        .set('xc-auth', context.token)
        .expect(200);
    });

    it('allows viewers to read and creators to manage List views', async function () {
      const view = await createView(context, {
        title: 'Role List',
        table,
        type: ViewTypes.LIST,
      });

      const invite = async (email: string, role: ProjectRoles) => {
        const credentials = {
          email,
          password: 'A1234abh2@dsad',
        };
        await request(context.app)
          .post('/api/v1/auth/user/signup')
          .send(credentials)
          .expect(200);
        await request(context.app)
          .post(`/api/v1/db/meta/projects/${base.id}/users`)
          .set('xc-auth', context.token)
          .send({
            roles: role,
            email,
            base_id: base.id,
            baseName: base.title,
          })
          .expect(200);
        return (
          await request(context.app)
            .post('/api/v1/auth/user/signin')
            .send(credentials)
            .expect(200)
        ).body.token;
      };

      const viewerToken = await invite(
        'list-viewer@example.com',
        ProjectRoles.VIEWER,
      );
      await request(context.app)
        .get(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', viewerToken)
        .expect(200);
      await request(context.app)
        .get(`/api/v1/db/data/noco/${base.id}/${table.id}/views/${view.id}`)
        .set('xc-auth', viewerToken)
        .expect(200);
      await request(context.app)
        .patch(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', viewerToken)
        .send({ row_height: 3 })
        .expect(403);
      await request(context.app)
        .patch(`/api/v1/db/meta/views/${view.id}`)
        .set('xc-auth', viewerToken)
        .send({ title: 'Viewer must not rename' })
        .expect(403);
      await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/lists`)
        .set('xc-auth', viewerToken)
        .send({ title: 'Viewer must not create', type: ViewTypes.LIST })
        .expect(403);
      await request(context.app)
        .delete(`/api/v1/db/meta/views/${view.id}`)
        .set('xc-auth', viewerToken)
        .expect(403);

      const creatorToken = await invite(
        'list-creator@example.com',
        ProjectRoles.CREATOR,
      );
      const created = await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/lists`)
        .set('xc-auth', creatorToken)
        .send({ title: 'Creator List', type: ViewTypes.LIST })
        .expect(200);
      await request(context.app)
        .patch(`/api/v1/db/meta/lists/${created.body.id}`)
        .set('xc-auth', creatorToken)
        .send({ row_height: 1 })
        .expect(200);
      await request(context.app)
        .patch(`/api/v1/db/meta/views/${created.body.id}`)
        .set('xc-auth', creatorToken)
        .send({ title: 'Creator List Renamed' })
        .expect(200);
      await request(context.app)
        .delete(`/api/v1/db/meta/views/${created.body.id}`)
        .set('xc-auth', creatorToken)
        .expect(200);

      await request(context.app)
        .delete(`/api/v1/db/meta/views/${view.id}`)
        .set('xc-auth', context.token)
        .expect(200);
    });

    it('shares a flat List with projection, paging, sorting, and password protection', async function () {
      const sharedTable = await createTable(context, base, {
        table_name: 'list_shared_records',
        title: 'List Shared Records',
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
      const view = await createView(context, {
        title: 'Shared List',
        table: sharedTable,
        type: ViewTypes.LIST,
      });
      const alpha = await createRow(context, {
        base,
        table: sharedTable,
      });
      const beta = await createRow(context, {
        base,
        table: sharedTable,
      });

      await request(context.app)
        .patch(`/api/v1/db/data/noco/${base.id}/${sharedTable.id}/${alpha.Id}`)
        .set('xc-auth', context.token)
        .send({ title: 'Shared Alpha', notes: 'private alpha note' })
        .expect(200);
      await request(context.app)
        .patch(`/api/v1/db/data/noco/${base.id}/${sharedTable.id}/${beta.Id}`)
        .set('xc-auth', context.token)
        .send({ title: 'Shared Beta', notes: 'private beta note' })
        .expect(200);

      const notesColumn = (await sharedTable.getColumns(ctx)).find(
        (column) => column.title === 'Notes',
      );
      const notesViewColumn = (await view.getColumns(ctx)).find(
        (column) => column.fk_column_id === notesColumn?.id,
      );
      await request(context.app)
        .patch(
          `/api/v1/db/meta/views/${view.id}/columns/${notesViewColumn?.id}`,
        )
        .set('xc-auth', context.token)
        .send({ show: false })
        .expect(200);

      const share = await request(context.app)
        .post(`/api/v1/db/meta/views/${view.id}/share`)
        .set('xc-auth', context.token)
        .expect(200);
      expect(share.body.uuid).to.be.a('string').and.not.empty;

      const publicMeta = await request(context.app)
        .get(`/api/v2/public/shared-view/${share.body.uuid}/meta`)
        .expect(200);
      expect(publicMeta.body.type).to.equal(ViewTypes.LIST);
      expect(
        publicMeta.body.model.columns.map((column) => column.title),
      ).to.include.members(['Id', 'Title']);
      expect(
        publicMeta.body.model.columns.map((column) => column.title),
      ).not.to.include('Notes');

      const firstPage = await request(context.app)
        .get(`/api/v2/public/shared-view/${share.body.uuid}/rows`)
        .query({ fields: ['Title'], sort: '-Title', limit: 1, offset: 0 })
        .expect(200);
      expect(firstPage.body.list).to.have.length(1);
      expect(firstPage.body.list[0].Title).to.equal('Shared Beta');
      expect(firstPage.body.list[0]).not.to.have.property('Notes');
      expect(firstPage.body.pageInfo.totalRows).to.equal(2);

      const publicCount = await request(context.app)
        .get(`/api/v2/public/shared-view/${share.body.uuid}/count`)
        .expect(200);
      expect(publicCount.body.count).to.equal(2);

      const secondPage = await request(context.app)
        .get(`/api/v2/public/shared-view/${share.body.uuid}/rows`)
        .query({ fields: ['Title'], sort: '-Title', limit: 1, offset: 1 })
        .expect(200);
      expect(secondPage.body.list).to.have.length(1);
      expect(secondPage.body.list[0].Title).to.equal('Shared Alpha');

      await request(context.app)
        .patch(`/api/v1/db/meta/views/${view.id}/share`)
        .set('xc-auth', context.token)
        .send({ password: 'list-secret' })
        .expect(200);

      await request(context.app)
        .get(`/api/v2/public/shared-view/${share.body.uuid}/rows`)
        .expect(403);
      await request(context.app)
        .get(`/api/v2/public/shared-view/${share.body.uuid}/rows`)
        .set('xc-password', 'list-secret')
        .expect(200);
    });

    it('validates and persists a lazy Has-Many hierarchy', async function () {
      const parentTable = await createTable(context, base, {
        table_name: 'list_parents',
        title: 'List Parents',
        columns: [
          { column_name: 'id', title: 'Id', uidt: UITypes.ID },
          {
            column_name: 'title',
            title: 'Title',
            uidt: UITypes.SingleLineText,
          },
        ],
      });
      const childTable = await createTable(context, base, {
        table_name: 'list_children',
        title: 'List Children',
        columns: [
          { column_name: 'id', title: 'Id', uidt: UITypes.ID },
          {
            column_name: 'title',
            title: 'Title',
            uidt: UITypes.SingleLineText,
          },
        ],
      });
      const relation = await createLtarColumn(context, {
        title: 'Children',
        parentTable,
        childTable,
        type: 'hm',
      });
      const childTitle = (await childTable.getColumns(ctx)).find(
        (column) => column.title === 'Title',
      );
      const parentTitle = (await parentTable.getColumns(ctx)).find(
        (column) => column.title === 'Title',
      );
      const view = await createView(context, {
        title: 'Parent hierarchy',
        table: parentTable,
        type: ViewTypes.LIST,
      });

      const update = await request(context.app)
        .patch(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', context.token)
        .send({
          levels: [
            {
              fk_relation_column_id: relation.id,
              fields: [childTitle?.id],
              where: '(Title,like,Child)',
              sort: ['-Title'],
              page_size: 10,
              show_empty: true,
            },
          ],
        })
        .expect(200);
      expect(update.body.view.levels).to.have.length(1);
      expect(update.body.view.levels[0]).to.include({
        fk_relation_column_id: relation.id,
        fk_related_model_id: childTable.id,
        order: 1,
        page_size: 10,
        show_empty: true,
      });
      expect(update.body.view.levels[0].fields).to.deep.equal([childTitle?.id]);

      const read = await request(context.app)
        .get(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      expect(read.body.levels[0].sort).to.deep.equal(['-Title']);

      await request(context.app)
        .patch(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', context.token)
        .send({
          levels: [
            {
              fk_relation_column_id: relation.id,
              fields: [parentTitle?.id],
            },
          ],
        })
        .expect(400);

      await request(context.app)
        .patch(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', context.token)
        .send({
          levels: [
            {
              fk_relation_column_id: relation.id,
              recursive: true,
              max_depth: 2,
            },
          ],
        })
        .expect(400);

      await request(context.app)
        .patch(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', context.token)
        .send({
          levels: [
            {
              fk_relation_column_id: parentTitle?.id,
            },
          ],
        })
        .expect(400);

      const parentRow = await createRow(context, {
        base,
        table: parentTable,
      });
      const childRow = await createRow(context, {
        base,
        table: childTable,
      });
      await createChildRow(context, {
        base,
        table: parentTable,
        childTable,
        column: relation,
        rowId: parentRow.Id,
        childRowId: childRow.Id,
        type: 'hm',
      });
      const nested = await request(context.app)
        .get(
          `/api/v1/db/data/noco/${base.id}/${parentTable.id}/${parentRow.Id}/hm/${relation.title}`,
        )
        .set('xc-auth', context.token)
        .query({ limit: 10, offset: 0 })
        .expect(200);
      expect(nested.body.list).to.have.length(1);
      expect(nested.body.list[0].Id).to.equal(childRow.Id);

      const v2Nested = await request(context.app)
        .get(
          `/api/v2/tables/${parentTable.id}/links/${relation.id}/records/${parentRow.Id}`,
        )
        .set('xc-auth', context.token)
        .query({ limit: 10, offset: 0 })
        .expect(200);
      expect(v2Nested.body.list).to.have.length(1);
      expect(v2Nested.body.list[0].Id).to.equal(childRow.Id);

      const share = await request(context.app)
        .post(`/api/v1/db/meta/views/${view.id}/share`)
        .set('xc-auth', context.token)
        .expect(200);
      const publicMeta = await request(context.app)
        .get(`/api/v2/public/shared-view/${share.body.uuid}/meta`)
        .expect(200);
      expect(publicMeta.body.view.levels).to.deep.equal([]);

      await request(context.app)
        .get(
          `/api/v2/public/shared-view/${share.body.uuid}/rows/${parentRow.Id}/hm/${relation.id}`,
        )
        .expect(404);

      const duplicateResponse = await request(context.app)
        .post(`/api/v1/db/meta/tables/${parentTable.id}/lists`)
        .set('xc-auth', context.token)
        .send({
          title: 'Parent hierarchy copy',
          type: ViewTypes.LIST,
          copy_from_id: view.id,
        })
        .expect(200);
      const duplicateLevels = await ListViewLevel.list(
        ctx,
        duplicateResponse.body.id,
      );
      expect(duplicateLevels).to.have.length(1);
      expect(duplicateLevels[0]).to.include({
        fk_relation_column_id: relation.id,
        fk_related_model_id: childTable.id,
        page_size: 10,
        show_empty: true,
      });
      expect(duplicateLevels[0].id).not.to.equal(update.body.view.levels[0].id);

      await request(context.app)
        .delete(`/api/v1/db/meta/views/${duplicateResponse.body.id}`)
        .set('xc-auth', context.token)
        .expect(200);

      await request(context.app)
        .delete(`/api/v1/db/meta/views/${view.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      expect(await ListViewLevel.list(ctx, view.id!)).to.deep.equal([]);
    });

    it('accepts bounded recursion only for a self Has-Many relation', async function () {
      const treeTable = await createTable(context, base, {
        table_name: 'list_tree_nodes',
        title: 'List Tree Nodes',
        columns: [
          { column_name: 'id', title: 'Id', uidt: UITypes.ID },
          {
            column_name: 'title',
            title: 'Title',
            uidt: UITypes.SingleLineText,
          },
        ],
      });
      const descendants = await createLtarColumn(context, {
        title: 'Descendants',
        parentTable: treeTable,
        childTable: treeTable,
        type: 'hm',
      });
      const title = (await treeTable.getColumns(ctx)).find(
        (column) => column.title === 'Title',
      );
      const view = await createView(context, {
        title: 'Recursive hierarchy',
        table: treeTable,
        type: ViewTypes.LIST,
      });

      const update = await request(context.app)
        .patch(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', context.token)
        .send({
          levels: [
            {
              fk_relation_column_id: descendants.id,
              fields: [title?.id],
              recursive: true,
              max_depth: 3,
            },
          ],
        })
        .expect(200);

      expect(update.body.view.levels[0]).to.include({
        fk_relation_column_id: descendants.id,
        fk_related_model_id: treeTable.id,
        recursive: true,
        max_depth: 3,
      });

      await request(context.app)
        .patch(`/api/v1/db/meta/lists/${view.id}`)
        .set('xc-auth', context.token)
        .send({
          levels: [
            {
              fk_relation_column_id: descendants.id,
              recursive: true,
              max_depth: 4,
            },
          ],
        })
        .expect(400);
    });
  });
}
