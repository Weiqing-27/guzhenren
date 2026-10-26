const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { serverClient, pagination, replyError, badRequest, notFound } = require('../utils/webAccess');
const { consumeAiQuota } = require('../utils/aiQuota');
const { callDeepSeekText, createQuestionEvaluationGuide, gradeGrowthPractice, parseJsonContent } = require('../services/deepseek');
const router = express.Router();
const publicFields = 'id,title,content,type,difficulty,code_template,topic,source,created_at';
const send = (res, data, msg = '操作成功', status = 200) => res.status(status).json({ code: status, data, msg, message: msg });
router.get('/questions', async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    let query = req.app.get('supabase').from('questions').select(publicFields, { count: 'exact' }).is('deleted_at', null);
    for (const key of ['type', 'difficulty']) if (req.query[key]) query = query.eq(key, req.query[key]);
    const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error;
    return send(res, { list: data || [], total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) });
  } catch (error) { return replyError(res, error, '获取题目列表失败'); }
});
router.get('/questions/:id', async (req, res) => {
  try {
    const { data, error } = await req.app.get('supabase').from('questions').select(publicFields).is('deleted_at', null).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) notFound();
    return send(res, data);
  } catch (error) { return replyError(res, error, '获取题目详情失败'); }
});
async function generateQuestions(req, res) {
  try {
    const client = serverClient(req);
    const count = Math.min(30, Math.max(1, parseInt(req.body?.count, 10) || 5));
    const topic = String(req.body?.topic || '').slice(0, 500).trim();
    if (req.body?.excludeTitles !== undefined && !Array.isArray(req.body.excludeTitles)) badRequest('excludeTitles应为数组');
    const { data: existing, error: existingError } = await client.from('questions').select('title').is('deleted_at', null).order('created_at', { ascending: false }).limit(30);
    if (existingError) throw existingError;
    const avoid = [...(existing || []).map((q) => q.title), ...(req.body?.excludeTitles || []).slice(0, 30).map((x) => String(x).slice(0, 255))].join('\n');
    await consumeAiQuota(req, 'generate', count);
    const content = await callDeepSeekText({
      messages: [{ role: 'user', content: `你是资深前端面试官，生成${count}道新的前端面试题。主题：${topic || 'JavaScript、Vue、HTTP、性能优化'}。避免已有题目：\n${avoid}\n只返回JSON数组，每项字段title、content、type(theory/coding)、difficulty(easy/medium/hard)、code_template、reference_answer、scoring_rubric（0-10分评分要点）。coding必须提供代码模板。` }],
      temperature: 0.9, topP: 0.95,
    });
    const generated = parseJsonContent(content);
    if (!Array.isArray(generated)) throw new Error('AI未返回题目数组');
    const titles = new Set((existing || []).map((q) => q.title));
    const rows = generated.slice(0, count).filter((q) => q && typeof q.title === 'string' && q.title.trim() && q.content && ['theory', 'coding'].includes(q.type) && ['easy', 'medium', 'hard'].includes(q.difficulty)).map((q) => ({
      title: q.title.trim().slice(0, 255), content: String(q.content).slice(0, 50000), type: q.type,
      difficulty: q.difficulty, code_template: String(q.code_template || '').slice(0, 50000),
      topic: topic || null, reference_answer: q.reference_answer || null, scoring_rubric: q.scoring_rubric || null, source: 'ai_generated',
    })).filter((q) => { if (titles.has(q.title)) return false; titles.add(q.title); return true; });
    if (!rows.length) return send(res, { count: 0, questions: [], duplicateCount: generated.length }, '没有可保存的新题目');
    const saved = [];
    let skippedCount = 0;
    for (const row of rows) {
      const { data, error } = await client.from('questions').insert([row]).select().single();
      if (error?.code === '23505') { skippedCount++; continue; }
      if (error) throw error;
      saved.push(data);
    }
    return send(res, { count: saved.length, questions: saved, skippedCount, duplicateCount: generated.length - rows.length }, '题目生成并保存成功');
  } catch (error) { return replyError(res, error, '生成题目失败'); }
}
router.post('/questions/generate', authenticate, requireAdmin, generateQuestions);
// Legacy GET must never perform a paid write; clients must use an authenticated POST.
router.get('/admin/generate-questions', authenticate, requireAdmin, (req, res) => send(res, null, '请使用 POST /api/questions/generate', 405));
router.post('/admin/generate-questions', authenticate, requireAdmin, generateQuestions);
function parsedResult(item) {
  let result = {};
  try { result = typeof item.ai_result === 'string' ? JSON.parse(item.ai_result) : (item.ai_result || {}); } catch { /* Historical prose carries no reliable numeric grade. */ }
  if (!result || typeof result !== 'object' || Array.isArray(result)) result = {};
  const rawScore = item.score ?? result.score;
  const score = rawScore !== null && rawScore !== undefined && rawScore !== '' && Number.isFinite(Number(rawScore)) ? Math.max(0, Math.min(10, Number(rawScore))) : null;
  return { ...item, score, feedback: item.feedback ?? result.feedback ?? (typeof item.ai_result === 'string' && !Object.keys(result).length ? item.ai_result : ''), correct_answer: item.correct_answer ?? result.correct_answer ?? null };
}
router.post('/judge', authenticate, async (req, res) => {
  try {
    const client = serverClient(req);
    const { question_id, user_code } = req.body;
    if (!question_id || typeof user_code !== 'string' || !user_code.trim() || user_code.length > 100000) badRequest('请提供题目与不超过10万字符的答案');
    const { data: question, error: questionError } = await client.from('questions').select('id,title,content,topic,reference_answer,scoring_rubric').is('deleted_at', null).eq('id', question_id).maybeSingle();
    if (questionError) throw questionError;
    if (!question) notFound();
    await consumeAiQuota(req, 'judge');
    let referenceAnswer = question.reference_answer;
    let scoringRubric = question.scoring_rubric;
    if (!referenceAnswer || !scoringRubric) {
      const guide = await createQuestionEvaluationGuide({ title: question.title, content: question.content, topic: question.topic || '' });
      referenceAnswer = guide.reference_answer;
      scoringRubric = guide.scoring_rubric;
      const { error } = await client.from('questions').update(guide).is('deleted_at', null).eq('id', question.id);
      if (error) throw error;
    }
    const grade = await gradeGrowthPractice({ topic: question.topic || '', title: question.title, content: question.content, referenceAnswer, scoringRubric, userAnswer: user_code });
    if (!Number.isFinite(Number(grade.score))) throw new Error('AI返回无效分数');
    const score = Math.max(0, Math.min(10, Number(grade.score)));
    const feedback = grade.feedback;
    const status = score >= 7 ? '正确' : '错误';
    const ai_result = JSON.stringify({ score, feedback, correct_answer: referenceAnswer });
    const { data, error } = await client.from('submissions').insert([{ question_id: question.id, user_id: req.user.userId, user_code, ai_result, status, score, feedback, correct_answer: referenceAnswer }]).select().single();
    if (error) throw error;
    return send(res, { submission_id: data.id, ai_result, status, score, feedback, correct_answer: referenceAnswer, created_at: data.created_at });
  } catch (error) { return replyError(res, error, '判题或保存提交记录失败'); }
});
router.get('/submissions', authenticate, async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    let query = serverClient(req).from('submissions').select('id,question_id,user_code,ai_result,status,score,feedback,correct_answer,created_at,questions(title)', { count: 'exact' }).eq('user_id', req.user.userId);
    if (req.query.question_id) query = query.eq('question_id', req.query.question_id);
    const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error;
    const list = (data || []).map((item) => { const { questions, ...row } = item; return parsedResult({ ...row, question_title: questions?.title || '已归档题目' }); });
    return send(res, { list, total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) });
  } catch (error) { return replyError(res, error, '获取提交记录失败'); }
});
router.delete('/submissions/:id', authenticate, async (req, res) => {
  try {
    const { data, error } = await serverClient(req).from('submissions').delete().eq('user_id', req.user.userId).eq('id', req.params.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) notFound();
    return send(res, { id: data.id }, '提交记录已删除');
  } catch (error) { return replyError(res, error, '删除提交记录失败'); }
});
module.exports = router;
