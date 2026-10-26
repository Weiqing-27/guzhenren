const express = require('express');
const { authenticate } = require('../middleware/auth');
const { serverClient, pagination, replyError, badRequest, notFound } = require('../utils/webAccess');
const router = express.Router();
router.use(authenticate);
const mapTask = (item) => ({
  id: item.id, title: item.title, description: item.description,
  category: item.category, priority: item.priority, progress: item.progress,
  startDate: item.start_date, endDate: item.end_date, status: item.status,
  createTime: item.created_at, updateTime: item.updated_at,
});
function filtered(req, query, includeStatus = true) {
  query = query.eq('user_id', req.user.userId);
  for (const key of ['category', ...(includeStatus ? ['status', 'priority'] : [])]) {
    if (req.query[key]) query = query.eq(key, req.query[key]);
  }
  const { startTime, endTime } = req.query;
  if (startTime || endTime) {
    if (!startTime || !endTime || !Number.isFinite(Date.parse(startTime)) || !Number.isFinite(Date.parse(endTime)) || startTime > endTime) badRequest('请提供有效的开始与结束日期');
    query = query.lte('start_date', endTime).gte('end_date', startTime);
  }
  return query;
}
function taskFields(body, create = false) {
  const fields = {};
  for (const key of ['title', 'description', 'category', 'priority', 'progress', 'status']) {
    if (body[key] !== undefined) fields[key] = body[key];
  }
  if (body.startDate !== undefined) fields.start_date = body.startDate || null;
  if (body.endDate !== undefined) fields.end_date = body.endDate || null;
  if ((create || fields.title !== undefined) && (typeof fields.title !== 'string' || !fields.title.trim() || fields.title.length > 255)) badRequest('任务标题不能为空且不能超过255字');
  if (fields.title) fields.title = fields.title.trim();
  if (fields.category !== undefined && !['work', 'study', 'project'].includes(fields.category)) badRequest('无效的任务分类');
  if (fields.priority !== undefined && !['low', 'medium', 'high'].includes(fields.priority)) badRequest('无效的优先级');
  if (fields.status !== undefined && !['todo', 'in-progress', 'completed'].includes(fields.status)) badRequest('无效的任务状态');
  if (fields.progress !== undefined) {
    const progress = Number(fields.progress);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) badRequest('进度应为0至100的整数');
    fields.progress = progress;
  }
  for (const key of ['start_date', 'end_date']) {
    if (fields[key] && !/^\d{4}-\d{2}-\d{2}$/.test(fields[key])) badRequest('日期格式应为 YYYY-MM-DD');
    if (fields[key] && (!Number.isFinite(Date.parse(fields[key])) || new Date(fields[key]).toISOString().slice(0, 10) !== fields[key])) badRequest('无效的日期');
  }
  if (fields.start_date && fields.end_date && fields.start_date > fields.end_date) badRequest('结束日期不能早于开始日期');
  if (fields.description !== undefined && (typeof fields.description !== 'string' || fields.description.length > 100000)) badRequest('任务描述过长');
  return fields;
}
const success = (res, data, message = 'success') => res.json({ code: 200, message, data });
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const { data, count, error } = await filtered(req, serverClient(req).from('tasks').select('*', { count: 'exact' }))
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error;
    return success(res, { records: (data || []).map(mapTask), total: count || 0, current: page, page, size: limit, limit });
  } catch (error) { return replyError(res, error, '获取任务列表失败'); }
});
router.get('/stats', async (req, res) => {
  try {
    const client = serverClient(req);
    const countRows = async (key, value) => {
      let query = filtered(req, client.from('tasks').select('id', { count: 'exact', head: true }), false);
      if (key) query = query.eq(key, value);
      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    };
    const [total, completed, inProgress, workTasks, studyTasks, projectTasks] = await Promise.all([
      countRows(), countRows('status', 'completed'), countRows('status', 'in-progress'),
      countRows('category', 'work'), countRows('category', 'study'), countRows('category', 'project'),
    ]);
    return success(res, { total, completed, totalTasks: total, completedTasks: completed, inProgress, workTasks, studyTasks, projectTasks, completionRate: total ? Math.round(completed / total * 100) : 0 });
  } catch (error) { return replyError(res, error, '获取任务统计失败'); }
});
// Plans use the same task date ranges as the week/month/year calendar, so their statistics cannot drift.
router.get('/plans/stats', async (req, res) => {
  try {
    const client = serverClient(req);
    const counts = await Promise.all([null, 'completed', 'in-progress'].map(async (status) => {
      let query = filtered(req, client.from('tasks').select('id', { count: 'exact', head: true }), false);
      if (status) query = query.eq('status', status);
      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    }));
    return success(res, { totalPlans: counts[0], completedPlans: counts[1], inProgressPlans: counts[2] });
  } catch (error) { return replyError(res, error, '获取计划统计失败'); }
});
router.get('/time-range', async (req, res) => {
  try {
    if (!req.query.startTime || !req.query.endTime) badRequest('开始时间和结束时间不能为空');
    const { page, limit, offset } = pagination(req.query, 100, 500);
    const { data, error, count } = await filtered(req, serverClient(req).from('tasks').select('*', { count: 'exact' }))
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error;
    return res.json({ code: 200, message: 'success', data: (data || []).map(mapTask), pagination: { page, limit, total: count || 0 } });
  } catch (error) { return replyError(res, error, '获取计划失败'); }
});
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await serverClient(req).from('tasks').select('*').eq('user_id', req.user.userId).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) notFound();
    return success(res, mapTask(data));
  } catch (error) { return replyError(res, error, '获取任务失败'); }
});
router.post('/', async (req, res) => {
  try {
    const fields = taskFields(req.body, true);
    const { data, error } = await serverClient(req).from('tasks').insert([{ category: 'work', priority: 'medium', progress: 0, status: 'todo', ...fields, user_id: req.user.userId }]).select().single();
    if (error) throw error;
    return success(res, mapTask(data), '任务创建成功');
  } catch (error) { return replyError(res, error, '任务创建失败'); }
});
async function updateTask(req, res, statusOnly = false) {
  try {
    const body = statusOnly ? Object.fromEntries(['progress', 'status'].filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]])) : req.body;
    const fields = taskFields(body);
    if (!Object.keys(fields).length) badRequest('请提供要更新的任务字段');
    const client = serverClient(req);
    const { data: existing, error: readError } = await client.from('tasks').select('*').eq('user_id', req.user.userId).eq('id', req.params.id).maybeSingle();
    if (readError) throw readError;
    if (!existing) notFound();
    const mergedStart = Object.hasOwn(fields, 'start_date') ? fields.start_date : existing.start_date;
    const mergedEnd = Object.hasOwn(fields, 'end_date') ? fields.end_date : existing.end_date;
    if (mergedStart && mergedEnd && mergedStart > mergedEnd) badRequest('结束日期不能早于开始日期');
    const { data, error } = await client.from('tasks').update({ ...fields, updated_at: new Date().toISOString() }).eq('user_id', req.user.userId).eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) notFound();
    return success(res, mapTask(data), '任务更新成功');
  } catch (error) { return replyError(res, error, '任务更新失败'); }
}
router.put('/:id', (req, res) => updateTask(req, res));
router.patch('/:id/status', (req, res) => updateTask(req, res, true));
router.delete('/:id', async (req, res) => {
  try {
    // Do not delete dependent rows by a caller-supplied ID before checking the task owner.
    const { data, error } = await serverClient(req).from('tasks').delete().eq('user_id', req.user.userId).eq('id', req.params.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) notFound();
    return success(res, {}, '任务删除成功');
  } catch (error) { return replyError(res, error, '任务删除失败'); }
});
module.exports = router;
