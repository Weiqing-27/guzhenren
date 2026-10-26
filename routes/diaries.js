const express = require('express');
const XLSX = require('xlsx');
const { authenticate } = require('../middleware/auth');
const { serverClient, pagination, replyError, badRequest, notFound } = require('../utils/webAccess');
const router = express.Router();
// This router is mounted at /api alongside public routes; scope authentication to /diaries only.
router.use('/diaries', authenticate);
const success = (res, data, message = '成功', status = 200) => res.status(status).json({ code: status, message, data });
const selectFields = 'id,title,type,content,created_at,updated_at';
function diaryFields(body, create = false) {
  const result = {};
  for (const key of ['title', 'type', 'content']) {
    if (body[key] !== undefined) result[key] = String(body[key]);
    if ((create || result[key] !== undefined) && !result[key]?.trim()) badRequest('标题、类型和内容不能为空');
  }
  if (result.title?.length > 255 || result.content?.length > 2000000) badRequest('日记内容超出长度限制');
  return result;
}
router.get('/diaries', async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    let query = serverClient(req).from('diaries').select(selectFields, { count: 'exact' }).eq('user_id', req.user.userId);
    if (req.query.scope === 'work') query = query.in('type', ['2', '3', '5']);
    else if (req.query.type) query = query.eq('type', req.query.type);
    const { data, count, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error;
    return success(res, { diaries: data || [], pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) } });
  } catch (error) { return replyError(res, error, '获取日记列表失败'); }
});
router.get('/diaries/stats', async (req, res) => {
  try {
    const client = serverClient(req);
    const stats = { totalRecords: 0, totalCharacters: 0, typeStats: {} };
    // Supabase defaults to 1000 rows: walk pages rather than silently truncating totals.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from('diaries').select('id,content,type').eq('user_id', req.user.userId).order('id').range(offset, offset + 499);
      if (error) throw error;
      for (const diary of data || []) {
        const length = String(diary.content || '').replace(/<[^>]*>/g, '').length;
        stats.totalRecords++;
        stats.totalCharacters += length;
        const type = String(diary.type || 'other');
        stats.typeStats[type] ||= { count: 0, characters: 0 };
        stats.typeStats[type].count++;
        stats.typeStats[type].characters += length;
      }
      if ((data || []).length < 500) break;
    }
    return success(res, stats);
  } catch (error) { return replyError(res, error, '获取日记统计失败'); }
});
router.get('/diaries/:id', async (req, res) => {
  try {
    const { data, error } = await serverClient(req).from('diaries').select(selectFields).eq('user_id', req.user.userId).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) notFound();
    return success(res, data);
  } catch (error) { return replyError(res, error, '获取日记失败'); }
});
router.post('/diaries', async (req, res) => {
  try {
    const fields = diaryFields(req.body, true);
    const { data, error } = await serverClient(req).from('diaries').insert([{ ...fields, user_id: req.user.userId }]).select(selectFields).single();
    if (error) throw error;
    return success(res, data, '日记创建成功', 201);
  } catch (error) { return replyError(res, error, '创建日记失败'); }
});
router.put('/diaries/:id', async (req, res) => {
  try {
    const fields = diaryFields(req.body);
    if (!Object.keys(fields).length) badRequest('请提供要更新的日记字段');
    const { data, error } = await serverClient(req).from('diaries').update({ ...fields, updated_at: new Date().toISOString() }).eq('user_id', req.user.userId).eq('id', req.params.id).select(selectFields).maybeSingle();
    if (error) throw error;
    if (!data) notFound();
    return success(res, data, '日记更新成功');
  } catch (error) { return replyError(res, error, '更新日记失败'); }
});
router.delete('/diaries/:id', async (req, res) => {
  try {
    const { data, error } = await serverClient(req).from('diaries').delete().eq('user_id', req.user.userId).eq('id', req.params.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) notFound();
    return success(res, data, '日记删除成功');
  } catch (error) { return replyError(res, error, '删除日记失败'); }
});
router.post('/diaries/import-excel', async (req, res) => {
  try {
    const { fileData } = req.body;
    if (typeof fileData !== 'string' || !fileData || fileData.length > 7 * 1024 * 1024) badRequest('请上传不超过5MB的Excel文件');
    let workbook;
    try { workbook = XLSX.read(fileData, { type: 'base64', cellDates: true }); }
    catch { badRequest('Excel文件无法解析'); }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) badRequest('Excel文件没有工作表');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (rows.length > 2001) badRequest('每次最多导入2000条日记');
    const headers = rows[0] || [];
    const dateIndex = Math.max(0, headers.indexOf('日期'));
    const contentIndex = headers.indexOf('工作内容') >= 0 ? headers.indexOf('工作内容') : 1;
    const entries = rows.slice(1).filter((row) => row[dateIndex] && row[contentIndex]).map((row) => {
      const date = row[dateIndex];
      const title = date instanceof Date ? date.toISOString().slice(0, 10) : String(date);
      return { ...diaryFields({ title, content: row[contentIndex], type: '2' }, true), user_id: req.user.userId };
    });
    if (!entries.length) badRequest('Excel文件中没有有效数据');
    const { data, error } = await serverClient(req).from('diaries').insert(entries).select('id');
    if (error) throw error;
    return success(res, data, `成功导入${data.length}条日记`, 201);
  } catch (error) { return replyError(res, error, '导入日记失败'); }
});
module.exports = router;
