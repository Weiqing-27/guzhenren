const express = require('express');
const { randomUUID } = require('node:crypto');
const { authenticate } = require('../middleware/auth');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS = 'id,title,category,html,css,js,revision,created_at,updated_at';
const LIST_COLUMNS = 'id,title,category,revision,created_at,updated_at';

function validateContent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '代码内容格式无效';
  for (const field of ['title', 'category', 'html', 'css', 'js']) {
    if (typeof body[field] !== 'string') return `${field} 必须是文本`;
  }
  if (!body.title.trim() || body.title.length > 120) return '标题须为 1 至 120 个字符';
  if (body.category.length > 60) return '分类不能超过 60 个字符';
  for (const field of ['html', 'css', 'js']) {
    if (Buffer.byteLength(body[field], 'utf8') > 200000) return '单个代码文件不能超过 200 KB';
  }
  if (['html', 'css', 'js'].reduce((size, field) => size + Buffer.byteLength(body[field], 'utf8'), 0) > 500000) return '代码总量不能超过 500 KB';
  return null;
}

function serialize(row) {
  if (!row) return row;
  const { created_at, updated_at, ...record } = row;
  return { ...record, createdAt: created_at, updatedAt: updated_at };
}

function createRouter() {
  const router = express.Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    if (!UUID.test(req.user?.userId || '')) return res.status(401).json({ code: 401, message: '登录身份无效，请重新登录' });
    if (!req.app.get('hasSupabaseServiceRole')) return res.status(503).json({ code: 503, message: '代码工作台存储尚未配置，请联系管理员配置服务端数据库权限' });
    next();
  });
  router.param('id', (req, res, next, id) => {
    if (!UUID.test(id)) return res.status(400).json({ code: 400, message: '记录 ID 格式无效' });
    next();
  });
  const db = (req) => req.app.get('supabaseAdmin');
  const fail = (res, error) => {
    console.error('代码工作台存储失败:', error?.code || error?.message);
    const missing = error?.code === '42P01' || error?.code === 'PGRST205';
    return res.status(missing ? 503 : 500).json({ code: missing ? 503 : 500, message: missing ? '代码工作台数据表尚未初始化，请执行数据库迁移' : '代码存储失败，请稍后重试' });
  };
  router.get('/', async (req, res) => {
    const offset = Number(req.query.offset || 0);
    const limit = Number(req.query.limit || 100);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ code: 400, message: '分页参数无效' });
    try {
      const { data, error, count } = await db(req).from('code_workspaces').select(LIST_COLUMNS, { count: 'exact' }).eq('user_id', req.user.userId).order('updated_at', { ascending: false }).order('id').range(offset, offset + limit - 1);
      if (error) return fail(res, error);
      return res.json({ code: 200, data: data.map(serialize), total: count });
    } catch (error) { return fail(res, error); }
  });
  router.get('/:id', async (req, res) => {
    try {
      const { data, error } = await db(req).from('code_workspaces').select(COLUMNS).eq('id', req.params.id).eq('user_id', req.user.userId).maybeSingle();
      if (error) return fail(res, error);
      if (!data) return res.status(404).json({ code: 404, message: '记录不存在或无权访问' });
      return res.json({ code: 200, data: serialize(data) });
    } catch (error) { return fail(res, error); }
  });
  router.post('/', async (req, res) => {
    const invalid = validateContent(req.body);
    if (invalid) return res.status(400).json({ code: 400, message: invalid });
    const { title, category, html, css, js } = req.body;
    try {
      const { data, error } = await db(req).from('code_workspaces').insert({ id: randomUUID(), user_id: req.user.userId, title: title.trim(), category: category.trim() || '未分类', html, css, js, revision: 1 }).select(COLUMNS).single();
      if (error) return fail(res, error);
      return res.status(201).json({ code: 201, data: serialize(data) });
    } catch (error) { return fail(res, error); }
  });
  router.put('/:id', async (req, res) => {
    const invalid = validateContent(req.body);
    if (invalid) return res.status(400).json({ code: 400, message: invalid });
    if (!Number.isSafeInteger(req.body.revision) || req.body.revision < 1 || req.body.revision > 2147483646) return res.status(400).json({ code: 400, message: '缺少有效的记录版本，请重新载入' });
    const { title, category, html, css, js, revision } = req.body;
    try {
      const { data, error } = await db(req).from('code_workspaces').update({ title: title.trim(), category: category.trim() || '未分类', html, css, js, revision: revision + 1, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.user.userId).eq('revision', revision).select(COLUMNS).maybeSingle();
      if (error) return fail(res, error);
      if (!data) return res.status(409).json({ code: 409, message: '记录已被修改或删除，请先导出备份，再重新载入最新版本' });
      return res.json({ code: 200, data: serialize(data) });
    } catch (error) { return fail(res, error); }
  });
  router.delete('/:id', async (req, res) => {
    try {
      const { data, error } = await db(req).from('code_workspaces').delete().eq('id', req.params.id).eq('user_id', req.user.userId).select('id').maybeSingle();
      if (error) return fail(res, error);
      if (!data) return res.status(404).json({ code: 404, message: '记录不存在或无权访问' });
      return res.json({ code: 200, data: { id: data.id } });
    } catch (error) { return fail(res, error); }
  });
  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
module.exports.validateContent = validateContent;
