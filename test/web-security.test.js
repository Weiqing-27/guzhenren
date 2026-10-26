process.env.JWT_SECRET = 'offline-web-security-test-secret-value-only';
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { spawnSync } = require('node:child_process');
const XLSX = require('xlsx');
let aiCalls = 0;
// No requests are sent to a database or AI provider in this suite.
const aiPath = require.resolve('../services/deepseek');
require.cache[aiPath] = { id: aiPath, filename: aiPath, loaded: true, exports: {
  callDeepSeekText: async () => { aiCalls++; return JSON.stringify([{ title: 'New question', content: 'Explain closures', type: 'theory', difficulty: 'medium', reference_answer: 'Closure', scoring_rubric: '0-10' }]); },
  parseJsonContent: JSON.parse,
  createQuestionEvaluationGuide: async () => { aiCalls++; return { reference_answer: 'Reference', scoring_rubric: '0-10' }; },
  gradeGrowthPractice: async () => { aiCalls++; return { score: 8.5, feedback: '准确解释了闭包，补充边界情况。' }; },
} };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const token = (userId, role = 'user') => jwt.sign({ userId, role, username: userId === ADMIN ? 'admin' : 'user' }, process.env.JWT_SECRET);
const headers = (user = A, role = 'user') => ({ Authorization: `Bearer ${token(user, role)}`, 'Content-Type': 'application/json' });
class FakeDB {
  constructor() { this.reset(); }
  reset() {
    this.quotaAllowed = true;
    this.quotaError = false;
    this.failureTable = null;
    this.tables = {
      tasks: [
        { id: 1, user_id: A, title: 'A in October', start_date: '2026-10-01', end_date: '2026-10-15', category: 'work', status: 'completed', progress: 100 },
        { id: 2, user_id: B, title: 'B private', start_date: '2026-10-01', end_date: '2026-10-15', category: 'work', status: 'todo' },
        { id: 3, user_id: A, title: 'A in November', start_date: '2026-11-01', end_date: '2026-11-15', category: 'study', status: 'todo' },
        { id: 4, user_id: null, title: 'Unassigned legacy', start_date: '2026-10-01', end_date: '2026-10-15' },
      ],
      diaries: [{ id: 1, user_id: A, title: 'A diary', type: '1', content: '<p>Hello</p>' }, { id: 2, user_id: B, title: 'B diary', type: '1', content: 'Private' }],
      questions: [{ id: 1, title: 'Closures', content: 'Explain closures', topic: 'JavaScript', reference_answer: 'A closure', scoring_rubric: '0-10', deleted_at: null }],
      submissions: [
        { id: 1, question_id: 1, user_id: A, ai_result: '{"score":7.5,"feedback":"good"}', status: '正确' },
        { id: 2, question_id: 1, user_id: B, ai_result: '{"score":9}', status: '正确' },
        { id: 3, question_id: 1, user_id: A, ai_result: '旧的文字反馈', status: '错误' },
      ],
      ruankao_questions: [{ id: 1, qtype: 'multi', stem: 'Choose two', options: [{ key: 'A', text: 'One' }, { key: 'B', text: 'Two' }, { key: 'C', text: 'Three' }], answer: 'AB', difficulty: 'medium', deleted_at: null }],
      ruankao_attempts: [{ id: 1, user_id: A, question_id: 1 }], ruankao_wrong_book: [], users: [{ user_id: A, username: 'a', role: 'user' }],
    };
  }
  from(table) { return new Query(this, table); }
  async rpc(name, args) { this.lastQuota = { name, args }; return { data: this.quotaAllowed, error: this.quotaError ? { code: 'PGRST202', message: 'Function missing' } : null }; }
}
class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.op = 'select'; }
  select(fields = '*', options = {}) { this.fields = fields; this.options = options; return this; }
  eq(key, value) { this.filters.push((row) => String(row[key]) === String(value)); return this; }
  is(key, value) { this.filters.push((row) => value === null ? row[key] == null : row[key] === value); return this; }
  gte(key, value) { this.filters.push((row) => row[key] >= value); return this; }
  lte(key, value) { this.filters.push((row) => row[key] <= value); return this; }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
  order() { return this; }
  range(from, to) { this.slice = [from, to + 1]; return this; }
  limit(take) { this.slice = [0, take]; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  insert(rows) { this.op = 'insert'; this.rows = rows; return this; }
  update(values) { this.op = 'update'; this.values = values; return this; }
  delete() { this.op = 'delete'; return this; }
  then(resolve, reject) {
    try {
      if (this.db.failureTable === this.table) return Promise.resolve({ data: null, error: { code: 'OFFLINE_FAILURE', message: 'Database unavailable' } }).then(resolve, reject);
      const table = this.db.tables[this.table] ||= [];
      let matched = table.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.op === 'insert') {
        matched = this.rows.map((row, i) => ({ ...row, id: Math.max(0, ...table.map((r) => r.id || 0)) + i + 1, created_at: new Date().toISOString() }));
        table.push(...matched);
      }
      if (this.op === 'update') matched.forEach((row) => Object.assign(row, this.values));
      if (this.op === 'delete') this.db.tables[this.table] = table.filter((row) => !matched.includes(row));
      const count = matched.length;
      let rows = this.slice ? matched.slice(...this.slice) : matched;
      rows = rows.map((row) => ({ ...row, ...(this.fields?.includes('questions(title)') ? { questions: this.db.tables.questions.find((q) => q.id === row.question_id) } : {}) }));
      return Promise.resolve({ data: this.options?.head ? null : this.one ? (rows[0] || null) : rows, count, error: null }).then(resolve, reject);
    } catch (error) { return Promise.reject(error).then(resolve, reject); }
  }
}
const db = new FakeDB();
const app = express();
app.use(express.json());
app.set('supabase', db);
app.set('supabaseAdmin', db);
app.set('hasSupabaseServiceRole', true);
app.use('/api/tasks', require('../routes/tasks'));
app.use('/api', require('../routes/diaries'));
app.use('/api', require('../routes/questions'));
app.use('/api/ruankao', require('../routes/ruankao'));
app.use('/api/auth', require('../routes/auth'));
let server, base;
before(async () => { server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => server.close(resolve)); });
async function request(path, options = {}) {
  const response = await fetch(base + path, options);
  const body = await response.json();
  return { status: response.status, body };
}
test('private routes reject missing, forged, expired, or identity-free JWTs', async () => {
  for (const route of ['/api/tasks', '/api/diaries', '/api/submissions']) assert.equal((await request(route)).status, 401);
  for (const invalid of [jwt.sign({ userId: A }, 'wrong-key'), jwt.sign({ userId: A }, process.env.JWT_SECRET, { expiresIn: -1 }), jwt.sign({ role: 'admin' }, process.env.JWT_SECRET)]) {
    assert.equal((await request('/api/tasks', { headers: { Authorization: `Bearer ${invalid}` } })).status, 401);
  }
});
test('tasks filter owner and period identically for lists and statistics; pagination supports aliases', async () => {
  db.reset();
  const list = await request('/api/tasks?startTime=2026-10-01&endTime=2026-10-31&limit=1', { headers: headers() });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.records[0].title, 'A in October');
  assert.equal(list.body.data.records[0].startDate, '2026-10-01');
  const stats = await request('/api/tasks/stats?startTime=2026-10-01&endTime=2026-10-31', { headers: headers() });
  assert.equal(stats.body.data.total, 1);
  assert.equal(stats.body.data.completionRate, 100);
  const page2 = await request('/api/tasks?page=2&size=1', { headers: headers() });
  assert.equal(page2.body.data.records[0].id, 3);
  const bounded = await request('/api/tasks?page=abc&limit=9999999', { headers: headers() });
  assert.equal(bounded.body.data.current, 1);
  assert.equal(bounded.body.data.size, 100);
});
test('cross-user task reads, updates and deletes fail without changing another owner', async () => {
  db.reset();
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const result = await request(`/api/tasks/2${method === 'PATCH' ? '/status' : ''}`, { method, headers: headers(), ...(method === 'PUT' || method === 'PATCH' ? { body: JSON.stringify({ title: 'Stolen', progress: 10 }) } : {}) });
    assert.equal(result.status, 404);
  }
  assert.equal(db.tables.tasks.find((row) => row.id === 2).title, 'B private');
  assert.equal((await request('/api/tasks/4', { headers: headers() })).status, 404);
});
test('task validation prevents invalid progress/dates and disregards forged owners', async () => {
  db.reset();
  for (const invalid of [{ progress: 101 }, { startDate: '2026-02-30' }, { startDate: '2026-12-01', endDate: '2026-01-01' }]) {
    assert.equal((await request('/api/tasks', { method: 'POST', headers: headers(), body: JSON.stringify({ title: 'Task', ...invalid }) })).status, 400);
  }
  assert.equal((await request('/api/tasks', { method: 'POST', headers: headers(), body: JSON.stringify({ title: 'Task', user_id: B }) })).status, 200);
  assert.equal(db.tables.tasks.at(-1).user_id, A);
});
test('diary list, statistics, mutations and Excel imports are owner-scoped', async () => {
  db.reset();
  assert.equal((await request('/api/diaries', { headers: headers() })).body.data.pagination.total, 1);
  assert.equal((await request('/api/diaries/stats', { headers: headers() })).body.data.totalCharacters, 5);
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await request('/api/diaries/2', { method, headers: headers(), ...(method === 'PUT' ? { body: JSON.stringify({ title: 'Stolen' }) } : {}) })).status, 404);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['日期', '工作内容'], ['2026-10-25', 'Imported diary']]), 'Sheet1');
  const fileData = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
  const imported = await request('/api/diaries/import-excel', { method: 'POST', headers: headers(), body: JSON.stringify({ fileData, user_id: B }) });
  assert.equal(imported.status, 201);
  assert.equal(db.tables.diaries.at(-1).user_id, A);
});
test('admin generation never trusts username spoofing or ordinary signed users', async () => {
  db.reset(); aiCalls = 0;
  assert.equal((await request('/api/admin/generate-questions?username=weiqing', { headers: { 'x-username': 'weiqing' } })).status, 401);
  for (const path of ['/api/questions/generate', '/api/ruankao/generate', '/api/ruankao/questions']) assert.equal((await request(path, { method: 'POST', headers: headers(), body: '{}' })).status, 403);
  assert.equal(aiCalls, 0);
  const generated = await request('/api/questions/generate', { method: 'POST', headers: headers(ADMIN, 'admin'), body: '{"count":1}' });
  assert.equal(generated.status, 200);
  assert.equal(generated.body.data.count, 1);
  assert.equal(db.lastQuota.args.p_user_id, ADMIN);
});
test('judge uses the server grade, persists owner and returns feedback; quota stops paid calls', async () => {
  db.reset(); aiCalls = 0;
  const judged = await request('/api/judge', { method: 'POST', headers: headers(), body: JSON.stringify({ question_id: 1, user_code: 'A closure', user_id: B, score: 10 }) });
  assert.equal(judged.status, 200);
  assert.equal(judged.body.data.score, 8.5);
  assert.equal(db.tables.submissions.at(-1).user_id, A);
  assert.equal(db.tables.submissions.at(-1).correct_answer, 'A closure');
  db.quotaAllowed = false;
  const denied = await request('/api/judge', { method: 'POST', headers: headers(), body: JSON.stringify({ question_id: 1, user_code: 'A closure' }) });
  assert.equal(denied.status, 429);
  assert.equal(aiCalls, 1);
});
test('submission history is paginated per owner, keeps real scores, and deletes only owned records', async () => {
  db.reset();
  const history = await request('/api/submissions?pageSize=1&page=1', { headers: headers() });
  assert.equal(history.body.data.total, 2);
  assert.equal(history.body.data.list[0].score, 7.5);
  assert.equal(history.body.data.list[0].feedback, 'good');
  const legacy = await request('/api/submissions?limit=1&page=2', { headers: headers() });
  assert.equal(legacy.body.data.list[0].score, null);
  assert.equal((await request('/api/submissions/2', { method: 'DELETE', headers: headers() })).status, 404);
  assert.equal((await request('/api/submissions/1', { method: 'DELETE', headers: headers() })).status, 200);
  assert.equal(db.tables.submissions.some((row) => row.id === 2), true);
});
test('persistence failures never report a successful save or judge result', async () => {
  db.reset(); db.failureTable = 'submissions';
  const result = await request('/api/judge', { method: 'POST', headers: headers(), body: JSON.stringify({ question_id: 1, user_code: 'Answer' }) });
  assert.equal(result.status, 500);
  assert.equal(result.body.data, null);
});
test('soft-exam multi-choice edits retain all answers and archive keeps learning history', async () => {
  db.reset();
  const updated = await request('/api/ruankao/questions/1', { method: 'PUT', headers: headers(ADMIN, 'admin'), body: JSON.stringify({ stem: 'Updated stem', answer: 'B,A' }) });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.qtype, 'multi');
  assert.equal(updated.body.data.answer, 'AB');
  const invalid = await request('/api/ruankao/questions/1', { method: 'PUT', headers: headers(ADMIN, 'admin'), body: JSON.stringify({ qtype: 'single', answer: 'AB' }) });
  assert.equal(invalid.status, 400);
  assert.equal((await request('/api/ruankao/questions/1', { method: 'DELETE', headers: headers(ADMIN, 'admin') })).status, 200);
  assert.equal(db.tables.ruankao_questions.length, 1);
  assert.equal(db.tables.ruankao_attempts.length, 1);
  assert.equal((await request('/api/ruankao/questions', { headers: headers() })).body.data.total, 0);
  assert.equal((await request('/api/ruankao/questions/1?reveal=1', { headers: headers() })).status, 404);
  assert.equal((await request('/api/ruankao/attempts', { method: 'POST', headers: headers(), body: JSON.stringify({ question_id: 1, user_answer: 'AB' }) })).status, 404);
});
test('profile changes require login and never accept another userId', async () => {
  assert.equal((await request('/api/auth/avatar', { method: 'PUT', body: '{}', headers: { 'Content-Type': 'application/json' } })).status, 401);
  assert.equal((await request('/api/auth/avatar', { method: 'PUT', headers: headers(), body: JSON.stringify({ userId: B, avatarUrl: 'https://example.org/avatar.png' }) })).status, 403);
  assert.equal((await request('/api/auth/password/change', { method: 'POST', headers: headers(), body: JSON.stringify({ userId: B }) })).status, 403);
  assert.equal((await request(`/api/auth/profile/${B}`, { headers: headers() })).status, 403);
});
test('missing service-role config and quota migration fail closed with 503 before AI calls', async () => {
  db.reset(); aiCalls = 0;
  app.set('hasSupabaseServiceRole', false);
  try {
    const result = await request('/api/tasks', { headers: headers() });
    assert.equal(result.status, 503);
    assert.match(result.body.message, /数据库未配置/);
  } finally { app.set('hasSupabaseServiceRole', true); }
  db.quotaError = true;
  const result = await request('/api/judge', { method: 'POST', headers: headers(), body: JSON.stringify({ question_id: 1, user_code: 'Answer' }) });
  assert.equal(result.status, 503);
  assert.equal(aiCalls, 0);
});
test('production JWT refuses missing/example secrets without exposing secret values', () => {
  for (const secret of ['', 'your-secret-key-here-change-in-production']) {
    const result = spawnSync(process.execPath, ['-e', "require('./utils/jwt')"], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: secret }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JWT_SECRET/);
  }
});
