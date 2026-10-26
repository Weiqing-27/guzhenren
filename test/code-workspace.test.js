const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../routes/codeWorkspace');
const { generateToken } = require('../utils/jwt');
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const RECORD_ID = '33333333-3333-4333-8333-333333333333';

// Simulate PostgREST query semantics; tests never contact Supabase or run user code.
function fakeDatabase(rows = []) {
  const state = { rows, failure: null };
  state.from = (table) => {
    assert.equal(table, 'code_workspaces');
    const filters = [];
    let operation = 'select'; let payload; let bounds; let single = false;
    const execute = () => {
      if (state.failure) return { data: null, error: state.failure };
      let selected = state.rows.filter((row) => filters.every(([field, value]) => row[field] === value));
      const count = selected.length;
      if (operation === 'insert') { selected = [{ ...payload, created_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00Z' }]; state.rows.push(selected[0]); }
      if (operation === 'update') selected.forEach((row) => Object.assign(row, payload));
      if (operation === 'delete') state.rows = state.rows.filter((row) => !selected.includes(row));
      if (bounds) selected = selected.slice(bounds[0], bounds[1] + 1);
      return { data: structuredClone(single ? selected[0] || null : selected), error: null, count };
    };
    const query = {
      select: () => query,
      eq: (field, value) => { filters.push([field, value]); return query; },
      order: () => query,
      range: (from, to) => { bounds = [from, to]; return query; },
      insert: (value) => { operation = 'insert'; payload = value; return query; },
      update: (value) => { operation = 'update'; payload = value; return query; },
      delete: () => { operation = 'delete'; return query; },
      single: () => { single = true; return Promise.resolve(execute()); },
      maybeSingle: () => { single = true; return Promise.resolve(execute()); },
      then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
    };
    return query;
  };
  return state;
}
const content = { title: 'Test', category: '基础', html: '<h1>Hello</h1>', css: '', js: '' };
async function withApi(run) {
  const db = fakeDatabase([{ id: RECORD_ID, user_id: OWNER_A, revision: 1, ...content }]);
  const app = new Map([['supabaseAdmin', db], ['hasSupabaseServiceRole', true]]);
  const router = createRouter();
  const request = (path = '', owner = OWNER_A, method = 'GET', body) => new Promise((resolve, reject) => {
    const url = new URL(`http://local/${path.replace(/^\//, '')}`);
    const req = { method, url: url.pathname + url.search, originalUrl: url.pathname + url.search, headers: owner ? { authorization: `Bearer ${generateToken({ userId: owner, role: 'user' })}` } : {}, query: Object.fromEntries(url.searchParams), body, app };
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { resolve({ status: this.statusCode, body: value }); return this; } };
    router.handle(req, res, (error) => error ? reject(error) : reject(new Error('Route did not respond')));
  });
  await run({ request, db, app });
}

test('every workspace route requires auth and server storage credentials', async () => withApi(async ({ request, app }) => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.equal((await request(method === 'GET' || method === 'POST' ? '' : `/${RECORD_ID}`, null, method, content)).status, 401);
  app.set('hasSupabaseServiceRole', false);
  assert.equal((await request()).status, 503);
}));
test('account isolation applies to list, read, update and delete, including forged user_id', async () => withApi(async ({ request, db }) => {
  assert.deepEqual((await request('', OWNER_B)).body.data, []);
  assert.equal((await request(`/${RECORD_ID}`, OWNER_B)).status, 404);
  assert.equal((await request(`/${RECORD_ID}`, OWNER_B, 'PUT', { ...content, title: 'forged', user_id: OWNER_A, revision: 1 })).status, 409);
  assert.equal((await request(`/${RECORD_ID}`, OWNER_B, 'DELETE')).status, 404);
  assert.equal(db.rows[0].title, 'Test');
  const created = await request('', OWNER_B, 'POST', { ...content, user_id: OWNER_A, id: RECORD_ID });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.data.id, RECORD_ID);
  assert.equal(db.rows.find((row) => row.id === created.body.data.id).user_id, OWNER_B);
}));
test('writes enforce revision checks and never overwrite a newer record', async () => withApi(async ({ request, db }) => {
  assert.equal((await request(`/${RECORD_ID}`, OWNER_A, 'PUT', { ...content, title: 'new', revision: 1 })).status, 200);
  assert.equal((await request(`/${RECORD_ID}`, OWNER_A, 'PUT', { ...content, title: 'stale', revision: 1 })).status, 409);
  assert.equal(db.rows[0].title, 'new');
  assert.equal(db.rows[0].revision, 2);
}));
test('UUID, pagination, field types and byte limits are checked before storage writes', async () => withApi(async ({ request, db }) => {
  assert.equal((await request('/not-a-uuid')).status, 400);
  assert.equal((await request('?limit=101')).status, 400);
  for (const invalid of [{ ...content, title: '' }, { ...content, html: {} }, { ...content, css: '中'.repeat(70000) }]) assert.equal((await request('', OWNER_A, 'POST', invalid)).status, 400);
  assert.equal(db.rows.length, 1);
}));
test('storage errors are unsuccessful responses and missing migration is actionable', async () => withApi(async ({ request, db }) => {
  db.failure = { code: '42P01' };
  const result = await request();
  assert.equal(result.status, 503);
  assert.match(result.body.message, /数据库迁移/);
  db.failure = { code: '08000' };
  assert.equal((await request('', OWNER_A, 'POST', content)).status, 500);
}));
