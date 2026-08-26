import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Api, UITypes } = require('../packages/nocodb-sdk/build/main');

const baseURL = process.env.NC_VERIFY_URL ?? 'http://127.0.0.1:8080';
const email = process.env.NC_VERIFY_EMAIL ?? 'foundation@example.test';
const password = process.env.NC_VERIFY_PASSWORD ?? 'Foundation1!Test';
const titleSuffix = Date.now().toString(36);

async function auth(path) {
  const response = await fetch(`${baseURL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const signup = await auth('/api/v1/auth/user/signup');
if (!signup.response.ok && signup.response.status !== 400) {
  throw new Error(`Signup failed (${signup.response.status}): ${JSON.stringify(signup.body)}`);
}

const signin = await auth('/api/v1/auth/user/signin');
assert(signin.response.ok, `Signin failed (${signin.response.status}): ${JSON.stringify(signin.body)}`);
assert(typeof signin.body.token === 'string', 'Signin response did not contain a token.');

const api = new Api({
  baseURL: `${baseURL}/`,
  headers: { 'xc-auth': signin.body.token },
});

let base;
try {
  base = await api.base.create({ title: `Foundation ${titleSuffix}` });
  assert(base?.id, 'Base creation did not return an ID.');

  const sourceId = base.sources?.[0]?.id;
  assert(sourceId, 'Base creation did not create a default source.');

  const table = await api.source.tableCreate(base.id, sourceId, {
    title: `Tasks ${titleSuffix}`,
    table_name: `tasks_${titleSuffix}`,
    columns: [
      {
        title: 'Id',
        column_name: 'Id',
        uidt: UITypes.ID,
        pk: true,
        ai: true,
      },
      {
        title: 'Title',
        column_name: 'Title',
        uidt: UITypes.SingleLineText,
      },
    ],
  });
  assert(table?.id, 'Table creation did not return an ID.');

  const listView = await api.dbView.listCreate(table.id, {
    title: `List ${titleSuffix}`,
  });
  assert(listView?.id, 'List view creation did not return an ID.');

  const listMetadata = await api.dbView.listRead(listView.id);
  assert(
    listMetadata?.fk_view_id === listView.id,
    `Unexpected List metadata: ${JSON.stringify(listMetadata)}`,
  );

  await api.dbView.listUpdate(listView.id, { row_height: 2 });
  const updatedListMetadata = await api.dbView.listRead(listView.id);
  assert(
    updatedListMetadata?.row_height === 2,
    `List row height was not updated: ${JSON.stringify(updatedListMetadata)}`,
  );

  const created = await api.dbDataTableRow.create(table.id, { Title: 'Created' });
  const rowId = created?.Id;
  assert(rowId, `Record creation did not return an ID: ${JSON.stringify(created)}`);

  const read = await api.dbDataTableRow.read(table.id, String(rowId));
  assert(read?.Title === 'Created', `Unexpected created record: ${JSON.stringify(read)}`);

  await api.dbDataTableRow.update(table.id, [{ Id: rowId, Title: 'Updated' }]);
  const updated = await api.dbDataTableRow.read(table.id, String(rowId));
  assert(updated?.Title === 'Updated', `Unexpected updated record: ${JSON.stringify(updated)}`);

  await api.dbDataTableRow.delete(table.id, [{ Id: rowId }]);
  const listed = await api.dbDataTableRow.list(table.id);
  assert(listed.list.length === 0, `Deleted record is still present: ${JSON.stringify(listed.list)}`);

  console.log(
    JSON.stringify(
      {
        signup: signup.response.ok ? 'created' : 'already existed',
        signin: 'ok',
        base: 'created',
        table: 'created',
        list: 'create/read/update ok',
        records: 'create/read/update/delete ok',
      },
      null,
      2,
    ),
  );
} finally {
  if (base?.id) await api.base.delete(base.id);
}
