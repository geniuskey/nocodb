import 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { ProjectRoles, UITypes, ViewTypes } from 'nocodb-sdk';
import init from '../../init';
import { createProject } from '../../factory/base';
import { createTable } from '../../factory/table';
import { createRow } from '../../factory/row';
import { createView } from '../../factory/view';
import { TimelineView, View } from '../../../../src/models';

export default function timelineViewTests() {
  describe('Timeline view foundation', function () {
    let context;
    let base;
    let table;
    let otherTable;
    let ctx;
    let startColumn;
    let endColumn;
    let titleColumn;

    before(async function () {
      context = await init();
      base = await createProject(context);
      table = await createTable(context, base, {
        table_name: 'timeline_records',
        title: 'Timeline Records',
        columns: [
          { column_name: 'id', title: 'Id', uidt: UITypes.ID },
          {
            column_name: 'title',
            title: 'Title',
            uidt: UITypes.SingleLineText,
          },
          {
            column_name: 'starts_on',
            title: 'Starts On',
            uidt: UITypes.Date,
          },
          {
            column_name: 'ends_at',
            title: 'Ends At',
            uidt: UITypes.DateTime,
          },
        ],
      });
      otherTable = await createTable(context, base, {
        table_name: 'timeline_other_records',
        title: 'Timeline Other Records',
        columns: [
          { column_name: 'id', title: 'Id', uidt: UITypes.ID },
          {
            column_name: 'other_date',
            title: 'Other Date',
            uidt: UITypes.Date,
          },
        ],
      });
      ctx = {
        workspace_id: base.fk_workspace_id,
        base_id: base.id,
      };
      const columns = await table.getColumns(ctx);
      startColumn = columns.find((column) => column.title === 'Starts On');
      endColumn = columns.find((column) => column.title === 'Ends At');
      titleColumn = columns.find((column) => column.title === 'Title');
    });

    it('validates date fields before inserting any view metadata', async function () {
      await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/timelines`)
        .set('xc-auth', context.token)
        .send({ title: 'Missing Timeline Start' })
        .expect(400);
      expect(
        await View.getByTitleOrId(ctx, {
          titleOrId: 'Missing Timeline Start',
          fk_model_id: table.id,
        }),
      ).to.equal(undefined);

      await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/timelines`)
        .set('xc-auth', context.token)
        .send({
          title: 'Text Timeline Start',
          fk_start_date_col_id: titleColumn.id,
        })
        .expect(400);
      expect(
        await View.getByTitleOrId(ctx, {
          titleOrId: 'Text Timeline Start',
          fk_model_id: table.id,
        }),
      ).to.equal(undefined);

      const otherDate = (await otherTable.getColumns(ctx)).find(
        (column) => column.title === 'Other Date',
      );
      await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/timelines`)
        .set('xc-auth', context.token)
        .send({
          title: 'Cross-table Timeline Start',
          fk_start_date_col_id: otherDate.id,
        })
        .expect(400);
      expect(
        await View.getByTitleOrId(ctx, {
          titleOrId: 'Cross-table Timeline Start',
          fk_model_id: table.id,
        }),
      ).to.equal(undefined);
    });

    it('creates, reads, updates, duplicates, and deletes Timeline metadata', async function () {
      const created = await request(context.app)
        .post(`/api/v2/meta/tables/${table.id}/timelines`)
        .set('xc-auth', context.token)
        .send({
          title: 'Independent Timeline',
          fk_start_date_col_id: startColumn.id,
          fk_end_date_col_id: endColumn.id,
          zoom: 'month',
          initial_mode: 'today',
          meta: { schemaVersion: 1 },
        })
        .expect(200);
      expect(created.body.type).to.equal(ViewTypes.TIMELINE);

      const read = await request(context.app)
        .get(`/api/v1/db/meta/timelines/${created.body.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      expect(read.body).to.include({
        fk_view_id: created.body.id,
        fk_start_date_col_id: startColumn.id,
        fk_end_date_col_id: endColumn.id,
        zoom: 'month',
        initial_mode: 'today',
      });
      expect(read.body.meta).to.deep.equal({ schemaVersion: 1 });

      const view = await View.get(ctx, created.body.id);
      const viewColumns = await view.getColumns(ctx);
      expect(viewColumns).to.have.length.greaterThan(2);
      const timelineTitle = viewColumns.find(
        (column) => column.fk_column_id === titleColumn.id,
      );
      await request(context.app)
        .patch(
          `/api/v1/db/meta/views/${created.body.id}/columns/${timelineTitle.id}`,
        )
        .set('xc-auth', context.token)
        .send({ show: true, width: '280px', bold: true })
        .expect(200);
      const changedColumn = (await view.getColumns(ctx)).find(
        (column) => column.id === timelineTitle.id,
      );
      expect(changedColumn).to.include({
        width: '280px',
        bold: true,
      });

      const timelineStart = viewColumns.find(
        (column) => column.fk_column_id === startColumn.id,
      );
      await request(context.app)
        .patch(
          `/api/v1/db/meta/views/${created.body.id}/columns/${timelineStart.id}`,
        )
        .set('xc-auth', context.token)
        .send({ show: false })
        .expect(200);
      expect(
        (await view.getColumns(ctx)).find(
          (column) => column.id === timelineStart.id,
        ).show,
      ).to.equal(true);

      await request(context.app)
        .patch(`/api/v2/meta/timelines/${created.body.id}`)
        .set('xc-auth', context.token)
        .send({
          fk_end_date_col_id: null,
          initial_mode: 'closest_record',
          meta: { schemaVersion: 2 },
        })
        .expect(200);
      const updated = await TimelineView.get(ctx, created.body.id);
      expect(updated.fk_end_date_col_id).to.equal(null);
      expect(updated.initial_mode).to.equal('closest_record');
      expect(updated.meta).to.deep.equal({ schemaVersion: 2 });

      const zooms = [
        'day',
        'week',
        'two_weeks',
        'month',
        'quarter',
        'six_months',
        'year',
        'two_years',
        'five_years',
      ];
      for (const zoom of zooms) {
        await request(context.app)
          .patch(`/api/v2/meta/timelines/${created.body.id}`)
          .set('xc-auth', context.token)
          .send({ zoom })
          .expect(200);
        expect((await TimelineView.get(ctx, created.body.id)).zoom).to.equal(
          zoom,
        );
      }
      await request(context.app)
        .patch(`/api/v2/meta/timelines/${created.body.id}`)
        .set('xc-auth', context.token)
        .send({ zoom: 'decade' })
        .expect(400);
      expect((await TimelineView.get(ctx, created.body.id)).zoom).to.equal(
        'five_years',
      );

      const timelineEnd = viewColumns.find(
        (column) => column.fk_column_id === endColumn.id,
      );
      await request(context.app)
        .patch(
          `/api/v1/db/meta/views/${created.body.id}/columns/${timelineEnd.id}`,
        )
        .set('xc-auth', context.token)
        .send({ show: false })
        .expect(200);
      expect(
        (await view.getColumns(ctx)).find(
          (column) => column.id === timelineEnd.id,
        ).show,
      ).to.equal(false);

      await request(context.app)
        .patch(`/api/v2/meta/timelines/${created.body.id}`)
        .set('xc-auth', context.token)
        .send({ fk_start_date_col_id: endColumn.id })
        .expect(200);
      expect(
        (await view.getColumns(ctx)).find(
          (column) => column.id === timelineEnd.id,
        ).show,
      ).to.equal(true);

      await request(context.app)
        .patch(`/api/v2/meta/timelines/${created.body.id}`)
        .set('xc-auth', context.token)
        .send({ fk_start_date_col_id: startColumn.id })
        .expect(200);

      const duplicate = await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/timelines`)
        .set('xc-auth', context.token)
        .send({
          title: 'Independent Timeline Copy',
          copy_from_id: created.body.id,
        })
        .expect(200);
      const duplicateMeta = await TimelineView.get(ctx, duplicate.body.id);
      expect(duplicateMeta).to.include({
        fk_start_date_col_id: startColumn.id,
        fk_end_date_col_id: null,
        zoom: 'five_years',
        initial_mode: 'closest_record',
      });
      expect(duplicateMeta.meta).to.deep.equal({ schemaVersion: 2 });
      const duplicateTitle = (await View.get(ctx, duplicate.body.id))
        .getColumns(ctx)
        .then((columns) =>
          columns.find((column) => column.fk_column_id === titleColumn.id),
        );
      expect((await duplicateTitle).width).to.equal('280px');

      await request(context.app)
        .post(`/api/v1/db/meta/views/${created.body.id}/share`)
        .set('xc-auth', context.token)
        .expect(400);
      expect((await View.get(ctx, created.body.id)).uuid).to.equal(null);

      await request(context.app)
        .delete(`/api/v1/db/meta/views/${duplicate.body.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      await request(context.app)
        .delete(`/api/v1/db/meta/views/${created.body.id}`)
        .set('xc-auth', context.token)
        .expect(200);
      expect(await TimelineView.get(ctx, created.body.id)).to.equal(undefined);
    });

    it('uses the generic view-aware record API for dated and undated rows', async function () {
      const created = await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/timelines`)
        .set('xc-auth', context.token)
        .send({
          title: 'Timeline Records API',
          fk_start_date_col_id: startColumn.id,
          fk_end_date_col_id: endColumn.id,
        })
        .expect(200);
      const dated = await createRow(context, { base, table });
      const undated = await createRow(context, { base, table });
      await request(context.app)
        .patch(`/api/v1/db/data/noco/${base.id}/${table.id}/${dated.Id}`)
        .set('xc-auth', context.token)
        .send({
          title: 'Dated record',
          starts_on: '2026-08-28',
          ends_at: '2026-08-29 12:00:00',
        })
        .expect(200);
      await request(context.app)
        .patch(`/api/v1/db/data/noco/${base.id}/${table.id}/${undated.Id}`)
        .set('xc-auth', context.token)
        .send({ title: 'Undated record' })
        .expect(200);

      const rows = await request(context.app)
        .get(
          `/api/v1/db/data/noco/${base.id}/${table.id}/views/${created.body.id}`,
        )
        .set('xc-auth', context.token)
        .query({ sort: 'Title' })
        .expect(200);
      expect(rows.body.list.map((row) => row.Title)).to.include.members([
        'Dated record',
        'Undated record',
      ]);
      expect(
        rows.body.list.find((row) => row.Title === 'Dated record')['Starts On'],
      ).to.equal('2026-08-28');
    });

    it('rejects cross-type duplication without a partial view', async function () {
      const grid = await createView(context, {
        title: 'Timeline invalid grid source',
        table,
        type: ViewTypes.GRID,
      });
      await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/timelines`)
        .set('xc-auth', context.token)
        .send({
          title: 'Invalid Timeline Copy',
          copy_from_id: grid.id,
        })
        .expect(400);
      expect(
        await View.getByTitleOrId(ctx, {
          titleOrId: 'Invalid Timeline Copy',
          fk_model_id: table.id,
        }),
      ).to.equal(undefined);
    });

    it('allows viewers to read and creators to manage Timeline views', async function () {
      const ownerView = await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/timelines`)
        .set('xc-auth', context.token)
        .send({
          title: 'Timeline Role View',
          fk_start_date_col_id: startColumn.id,
        })
        .expect(200);

      const invite = async (email: string, role: ProjectRoles) => {
        const credentials = { email, password: 'A1234abh2@dsad' };
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
        'timeline-viewer@example.com',
        ProjectRoles.VIEWER,
      );
      await request(context.app)
        .get(`/api/v1/db/meta/timelines/${ownerView.body.id}`)
        .set('xc-auth', viewerToken)
        .expect(200);
      await request(context.app)
        .patch(`/api/v1/db/meta/timelines/${ownerView.body.id}`)
        .set('xc-auth', viewerToken)
        .send({ initial_mode: 'closest_record' })
        .expect(403);
      await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/timelines`)
        .set('xc-auth', viewerToken)
        .send({
          title: 'Viewer Timeline',
          fk_start_date_col_id: startColumn.id,
        })
        .expect(403);

      const creatorToken = await invite(
        'timeline-creator@example.com',
        ProjectRoles.CREATOR,
      );
      const creatorView = await request(context.app)
        .post(`/api/v1/db/meta/tables/${table.id}/timelines`)
        .set('xc-auth', creatorToken)
        .send({
          title: 'Creator Timeline',
          fk_start_date_col_id: startColumn.id,
        })
        .expect(200);
      await request(context.app)
        .patch(`/api/v1/db/meta/timelines/${creatorView.body.id}`)
        .set('xc-auth', creatorToken)
        .send({ initial_mode: 'closest_record' })
        .expect(200);
      await request(context.app)
        .delete(`/api/v1/db/meta/views/${creatorView.body.id}`)
        .set('xc-auth', creatorToken)
        .expect(200);

      await request(context.app)
        .delete(`/api/v1/db/meta/views/${ownerView.body.id}`)
        .set('xc-auth', context.token)
        .expect(200);
    });
  });
}
