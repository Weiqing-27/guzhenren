const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * 【功能描述】
 * 从 Express 应用获取 Supabase 客户端（优先 service role）
 *
 * 【业务逻辑】
 * 1. 优先读取 supabaseAdmin 以绕过 RLS
 * 2. 降级使用普通 supabase 实例
 *
 * 【技术实现】
 * - 涉及方法：req.app.get()
 * - 涉及知识点：Supabase 多客户端、RLS 策略
 */
const getSupabase = (req) => req.app.get('supabaseAdmin') || req.app.get('supabase');

/**
 * 【功能描述】
 * 统一成功响应封装
 *
 * 【业务逻辑】
 * 1. 按 HTTP 状态码设置响应
 * 2. 返回 { code, message, data } 结构，201 时 code 为 201
 *
 * 【技术实现】
 * - 涉及方法：res.status().json()
 * - 涉及知识点：REST API 响应约定
 */
function ok(res, data, message = '成功', status = 200) {
  return res.status(status).json({ code: status === 201 ? 201 : 200, message, data });
}

/**
 * 【功能描述】
 * 统一失败响应封装
 *
 * 【业务逻辑】
 * 1. 设置 HTTP 错误状态码
 * 2. 返回 code、message、data:null 及可选 error 详情
 *
 * 【技术实现】
 * - 涉及方法：res.status().json()
 * - 涉及知识点：错误响应标准化
 */
function fail(res, status, message, error) {
  return res.status(status).json({
    code: status,
    message,
    data: null,
    error: error?.message || error || undefined,
  });
}

/**
 * 【功能描述】
 * 获取本地时区今天的日期字符串 YYYY-MM-DD
 *
 * 【业务逻辑】
 * 1. 读取当前 Date
 * 2. 格式化为零填充的年月日
 *
 * 【技术实现】
 * - 涉及方法：Date、padStart()
 * - 涉及知识点：日期字符串用于打卡比对
 */
function todayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 【功能描述】
 * 规范化选择题答案便于比对（去空格、大写、排序）
 *
 * 【业务逻辑】
 * 1. null/undefined 转为空串
 * 2. 仅保留 A-Z 字母并排序（支持多选无序比对）
 *
 * 【技术实现】
 * - 涉及方法：String.trim/toUpperCase/replace/split/sort/join
 * - 涉及知识点：多选答案 canonical form
 */
function normalizeAnswer(ans) {
  if (ans == null) return '';
  return String(ans)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('')
    .sort()
    .join('');
}

/**
 * 【功能描述】
 * 判断两个答案是否等价（经 normalizeAnswer 后比较）
 *
 * 【业务逻辑】
 * 1. 分别规范化 a、b
 * 2. 字符串相等即为正确
 *
 * 【技术实现】
 * - 涉及方法：normalizeAnswer()
 * - 涉及知识点：答题判分逻辑
 */
function answersEqual(a, b) {
  return normalizeAnswer(a) === normalizeAnswer(b);
}

/**
 * 【功能描述】
 * 根据答题结果更新错题本 ruankao_wrong_book
 *
 * 【业务逻辑】
 * 1. 答错：已有记录则 wrong_count+1 并重置 mastered；无记录则新建
 * 2. 答对：不自动删除错题记录，保留供复习
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().update().insert().maybeSingle()
 * - 涉及知识点：错题本增量维护、掌握状态
 */
async function upsertWrongBook(supabase, userId, questionId, isCorrect) {
  const { data: existing } = await supabase
    .from('ruankao_wrong_book')
    .select('id, wrong_count, mastered')
    .eq('user_id', userId)
    .eq('question_id', questionId)
    .maybeSingle();

  if (!isCorrect) {
    if (existing) {
      await supabase
        .from('ruankao_wrong_book')
        .update({
          wrong_count: (existing.wrong_count || 0) + 1,
          last_wrong_at: new Date().toISOString(),
          mastered: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('ruankao_wrong_book').insert([
        {
          user_id: userId,
          question_id: questionId,
          wrong_count: 1,
          mastered: false,
        },
      ]);
    }
    return;
  }

  // 答对：若已在错题本且未掌握，可保留供复习；不自动删除
}

/**
 * 【功能描述】
 * 计算用户连续打卡天数
 *
 * 【业务逻辑】
 * 1. 取最近 120 条打卡日期
 * 2. 若今天未打卡则从昨天起算
 * 3. 逐日向前检查直到断档
 *
 * 【技术实现】
 * - 涉及方法：supabase 查询、Set 日期集合、Date 游标递减
 * - 涉及知识点：连续签到 streak 算法
 */
async function calcStreak(supabase, userId) {
  const { data, error } = await supabase
    .from('ruankao_checkins')
    .select('checkin_date')
    .eq('user_id', userId)
    .order('checkin_date', { ascending: false })
    .limit(120);

  if (error || !data?.length) return 0;

  const dates = data.map((r) => r.checkin_date);
  const set = new Set(dates);
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  // 若今天未打卡，从昨天开始计连续
  const today = todayDateStr();
  if (!set.has(today)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (true) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${d}`;
    if (!set.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * 【功能描述】
 * 软考学习概览统计（首页仪表盘）
 *
 * 【业务逻辑】
 * 1. 并行查询题库总量、答题记录、错题数、今日打卡、笔记数、知识卡数
 * 2. 计算总正确率、今日答题与正确数
 * 3. 计算连续打卡 streak 与近 7 日打卡明细
 *
 * 【技术实现】
 * - 涉及方法：Promise.all、calcStreak()、ok()/fail()
 * - 涉及知识点：authenticate 鉴权、多表聚合统计
 */
router.get('/overview', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const userId = req.user.userId;

    const [
      { count: questionTotal },
      { data: attempts },
      { count: wrongCount },
      { data: todayCheckin },
      { count: noteCount },
      { count: knowledgeCount },
    ] = await Promise.all([
      supabase.from('ruankao_questions').select('*', { count: 'exact', head: true }),
      supabase
        .from('ruankao_attempts')
        .select('is_correct, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('ruankao_wrong_book')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('mastered', false),
      supabase
        .from('ruankao_checkins')
        .select('id, study_minutes, note, checkin_date')
        .eq('user_id', userId)
        .eq('checkin_date', todayDateStr())
        .maybeSingle(),
      supabase
        .from('ruankao_notes')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase.from('ruankao_knowledge').select('*', { count: 'exact', head: true }),
    ]);

    const attemptList = attempts || [];
    const attemptTotal = attemptList.length;
    const correctTotal = attemptList.filter((a) => a.is_correct).length;
    const accuracy =
      attemptTotal > 0 ? Math.round((correctTotal / attemptTotal) * 100) : 0;

    const todayAttempts = attemptList.filter((a) => {
      const d = new Date(a.created_at);
      return (
        d.getFullYear() === new Date().getFullYear() &&
        d.getMonth() === new Date().getMonth() &&
        d.getDate() === new Date().getDate()
      );
    });

    const streak = await calcStreak(supabase, userId);

    // 近 7 日打卡
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    const weekStart = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
    const { data: weekCheckins } = await supabase
      .from('ruankao_checkins')
      .select('checkin_date, study_minutes')
      .eq('user_id', userId)
      .gte('checkin_date', weekStart)
      .order('checkin_date', { ascending: true });

    return ok(res, {
      questionTotal: questionTotal || 0,
      attemptTotal,
      correctTotal,
      accuracy,
      todayAttemptCount: todayAttempts.length,
      todayCorrectCount: todayAttempts.filter((a) => a.is_correct).length,
      wrongCount: wrongCount || 0,
      noteCount: noteCount || 0,
      knowledgeCount: knowledgeCount || 0,
      streak,
      todayCheckin: todayCheckin || null,
      weekCheckins: weekCheckins || [],
    });
  } catch (error) {
    console.error('获取软考概览失败:', error);
    return fail(res, 500, '获取概览失败', error);
  }
});

/**
 * 【功能描述】
 * 分页查询题目列表（不含答案，用于浏览）
 *
 * 【业务逻辑】
 * 1. 支持 subject/chapter/difficulty/keyword 筛选
 * 2. 分页参数 page、limit 校验与截断
 * 3. 返回列表、总数与分页信息
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().eq().ilike().range()
 * - 涉及知识点：分页查询、ilike 模糊搜索
 */
router.get('/questions', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const {
      subject,
      chapter,
      difficulty,
      keyword,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('ruankao_questions')
      .select('id, subject, chapter, qtype, stem, difficulty, tags, created_at', {
        count: 'exact',
      });

    if (subject) query = query.eq('subject', subject);
    if (chapter) query = query.eq('chapter', chapter);
    if (difficulty) query = query.eq('difficulty', difficulty);
    if (keyword) query = query.ilike('stem', `%${keyword}%`);

    const { data, error, count } = await query
      .order('id', { ascending: true })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    return ok(res, {
      list: data || [],
      total: count || 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error('获取软考题目失败:', error);
    return fail(res, 500, '获取题目失败', error);
  }
});

/**
 * 【功能描述】
 * 随机抽题练习（不含答案，提交后另接口返回解析）
 *
 * 【业务逻辑】
 * 1. 按筛选条件统计总量，随机 offset 取候选池（最多 80 题）
 * 2. Fisher-Yates 洗牌后截取 count 道题
 * 3. 无题时返回空列表
 *
 * 【技术实现】
 * - 涉及方法：count head 查询、range 随机窗口、数组 shuffle
 * - 涉及知识点：随机抽题避免固定前 N 条偏差
 */
router.get('/questions/practice', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { subject, chapter, difficulty, count = 1 } = req.query;
    const take = Math.min(20, Math.max(1, parseInt(count, 10) || 1));

    // 先取总量，再随机 offset，避免只从前 200 条抽
    let countQuery = supabase
      .from('ruankao_questions')
      .select('id', { count: 'exact', head: true });
    if (subject) countQuery = countQuery.eq('subject', subject);
    if (chapter) countQuery = countQuery.eq('chapter', chapter);
    if (difficulty) countQuery = countQuery.eq('difficulty', difficulty);
    const { count: total, error: cErr } = await countQuery;
    if (cErr) throw cErr;
    if (!total) {
      return ok(res, { list: [] }, '暂无题目');
    }

    const poolSize = Math.min(80, total);
    const maxStart = Math.max(0, total - poolSize);
    const start = Math.floor(Math.random() * (maxStart + 1));

    let query = supabase
      .from('ruankao_questions')
      .select('id, subject, chapter, qtype, stem, options, difficulty, tags');

    if (subject) query = query.eq('subject', subject);
    if (chapter) query = query.eq('chapter', chapter);
    if (difficulty) query = query.eq('difficulty', difficulty);

    const { data, error } = await query.range(start, start + poolSize - 1);
    if (error) throw error;

    const pool = data || [];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return ok(res, { list: pool.slice(0, take) });
  } catch (error) {
    console.error('抽题失败:', error);
    return fail(res, 500, '抽题失败', error);
  }
});

/**
 * 【功能描述】
 * 获取单题详情，默认隐藏答案与解析
 *
 * 【业务逻辑】
 * 1. 按 id 查询完整题目
 * 2. 不存在返回 404
 * 3. 仅当 query reveal=1 或 true 时返回答案与解析
 *
 * 【技术实现】
 * - 涉及方法：maybeSingle()、对象解构剔除敏感字段
 * - 涉及知识点：练习模式防泄题
 */
router.get('/questions/:id', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { data, error } = await supabase
      .from('ruankao_questions')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return fail(res, 404, '题目不存在');

    // 详情练习模式可不暴露答案：?reveal=1 才返回答案
    const reveal = req.query.reveal === '1' || req.query.reveal === 'true';
    if (!reveal) {
      const { answer, explanation, ...rest } = data;
      return ok(res, rest);
    }
    return ok(res, data);
  } catch (error) {
    console.error('获取题目详情失败:', error);
    return fail(res, 500, '获取题目详情失败', error);
  }
});

/**
 * 【功能描述】
 * 获取科目与章节筛选项（去重全集）
 *
 * 【业务逻辑】
 * 1. 分批每 1000 条拉取 subject/chapter，避免默认行数截断
 * 2. 用 Set 去重后排序返回
 *
 * 【技术实现】
 * - 涉及方法：supabase range 分页循环、Set
 * - 涉及知识点：Supabase 默认 limit 规避、元数据聚合
 */
router.get('/meta/filters', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    // 分批拉取，避免默认 1000 行截断导致章节不全
    const subjects = new Set();
    const chapters = new Set();
    let from = 0;
    const pageSize = 1000;
    for (let i = 0; i < 20; i++) {
      const { data, error } = await supabase
        .from('ruankao_questions')
        .select('subject, chapter')
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = data || [];
      rows.forEach((d) => {
        if (d.subject) subjects.add(d.subject);
        if (d.chapter) chapters.add(d.chapter);
      });
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    return ok(res, {
      subjects: [...subjects].sort(),
      chapters: [...chapters].sort(),
    });
  } catch (error) {
    console.error('获取筛选项失败:', error);
    return fail(res, 500, '获取筛选项失败', error);
  }
});

/**
 * 【功能描述】
 * 提交单题答案并判分
 *
 * 【业务逻辑】
 * 1. 校验 question_id 与 user_answer
 * 2. 查询标准答案，answersEqual 判对错
 * 3. 写入 ruankao_attempts 并更新错题本
 * 4. 返回判分结果、解析及题目信息（不含答案重复泄露策略由前端控制）
 *
 * 【技术实现】
 * - 涉及方法：answersEqual()、upsertWrongBook()、insert().select().single()
 * - 涉及知识点：答题流水、错题本联动
 */
router.post('/attempts', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const userId = req.user.userId;
    const { question_id, user_answer } = req.body;

    if (!question_id || user_answer == null || user_answer === '') {
      return fail(res, 400, '请提供题目与答案');
    }

    const { data: question, error: qErr } = await supabase
      .from('ruankao_questions')
      .select('id, answer, explanation, stem, options, subject, chapter, difficulty, qtype')
      .eq('id', question_id)
      .maybeSingle();

    if (qErr) throw qErr;
    if (!question) return fail(res, 404, '题目不存在');

    const isCorrect = answersEqual(user_answer, question.answer);

    const { data: attempt, error: aErr } = await supabase
      .from('ruankao_attempts')
      .insert([
        {
          user_id: userId,
          question_id,
          user_answer: String(user_answer).trim().toUpperCase(),
          is_correct: isCorrect,
        },
      ])
      .select()
      .single();

    if (aErr) throw aErr;

    await upsertWrongBook(supabase, userId, question_id, isCorrect);

    return ok(
      res,
      {
        attempt,
        is_correct: isCorrect,
        correct_answer: question.answer,
        explanation: question.explanation || '',
        question: {
          id: question.id,
          stem: question.stem,
          options: question.options,
          subject: question.subject,
          chapter: question.chapter,
          difficulty: question.difficulty,
          qtype: question.qtype,
        },
      },
      isCorrect ? '回答正确' : '回答错误'
    );
  } catch (error) {
    console.error('提交答案失败:', error);
    return fail(res, 500, '提交答案失败', error);
  }
});

/**
 * 【功能描述】
 * 分页获取当前用户错题本
 *
 * 【业务逻辑】
 * 1. 关联 ruankao_questions 返回题目详情
 * 2. mastered 参数：true/false/all 筛选掌握状态
 * 3. 按 last_wrong_at 倒序分页
 *
 * 【技术实现】
 * - 涉及方法：supabase 嵌套 select 关联查询、range 分页
 * - 涉及知识点：外键 embed、错题复习列表
 */
router.get('/wrong-book', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const userId = req.user.userId;
    const { mastered, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('ruankao_wrong_book')
      .select(
        `
        id, question_id, wrong_count, last_wrong_at, mastered, created_at, updated_at,
        question:ruankao_questions(id, subject, chapter, qtype, stem, options, difficulty, tags, answer, explanation)
      `,
        { count: 'exact' }
      )
      .eq('user_id', userId);

    if (mastered === 'true') query = query.eq('mastered', true);
    else if (mastered !== 'all') query = query.eq('mastered', false);

    const { data, error, count } = await query
      .order('last_wrong_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    return ok(res, {
      list: data || [],
      total: count || 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error('获取错题本失败:', error);
    return fail(res, 500, '获取错题本失败', error);
  }
});

/**
 * 【功能描述】
 * 标记或取消标记错题为已掌握
 *
 * 【业务逻辑】
 * 1. body.mastered 默认 true，显式 false 则取消掌握
 * 2. 仅更新当前用户的指定错题记录
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().update().eq().maybeSingle()
 * - 涉及知识点：错题掌握状态管理
 */
router.put('/wrong-book/:id/master', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const userId = req.user.userId;
    const mastered = req.body?.mastered !== false;

    const { data, error } = await supabase
      .from('ruankao_wrong_book')
      .update({ mastered, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return fail(res, 404, '错题记录不存在');

    return ok(res, data, mastered ? '已标记掌握' : '已取消掌握');
  } catch (error) {
    console.error('更新错题本失败:', error);
    return fail(res, 500, '更新错题本失败', error);
  }
});

/**
 * 【功能描述】
 * 从错题本移除指定记录
 *
 * 【业务逻辑】
 * 1. 按 id 与 user_id 删除 ruankao_wrong_book 行
 * 2. 成功返回「已移除」
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().delete().eq()
 * - 涉及知识点：用户数据隔离
 */
router.delete('/wrong-book/:id', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { error } = await supabase
      .from('ruankao_wrong_book')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.userId);

    if (error) throw error;
    return ok(res, null, '已移除');
  } catch (error) {
    console.error('删除错题失败:', error);
    return fail(res, 500, '删除错题失败', error);
  }
});

/**
 * 【功能描述】
 * 获取指定天数内的打卡记录及当前 streak
 *
 * 【业务逻辑】
 * 1. days 参数限制 1–90，默认 30
 * 2. 查询自起始日期以来的打卡列表
 * 3. 附带 calcStreak 连续天数
 *
 * 【技术实现】
 * - 涉及方法：gte 日期筛选、calcStreak()
 * - 涉及知识点：学习打卡历史
 */
router.get('/checkins', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { days = 30 } = req.query;
    const dayNum = Math.min(90, Math.max(1, parseInt(days, 10) || 30));
    const from = new Date();
    from.setDate(from.getDate() - (dayNum - 1));
    const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('ruankao_checkins')
      .select('*')
      .eq('user_id', req.user.userId)
      .gte('checkin_date', fromStr)
      .order('checkin_date', { ascending: false });

    if (error) throw error;

    const streak = await calcStreak(supabase, req.user.userId);
    return ok(res, { list: data || [], streak });
  } catch (error) {
    console.error('获取打卡失败:', error);
    return fail(res, 500, '获取打卡失败', error);
  }
});

/**
 * 【功能描述】
 * 每日学习打卡（新建或更新当日记录）
 *
 * 【业务逻辑】
 * 1. 校验 study_minutes 或 note 至少一项
 * 2. checkin_date 默认今天，可指定历史日期
 * 3. 同日已有记录则 update，否则 insert
 * 4. 返回打卡记录与最新 streak
 *
 * 【技术实现】
 * - 涉及方法：maybeSingle 查重、insert/update、calcStreak()
 * - 涉及知识点：upsert 语义、输入截断
 */
router.post('/checkins', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const userId = req.user.userId;
    const study_minutes = Math.max(0, parseInt(req.body?.study_minutes, 10) || 0);
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : '';
    const checkin_date = req.body?.checkin_date || todayDateStr();

    if (study_minutes <= 0 && !note) {
      return fail(res, 400, '请填写学习时长或备注');
    }

    const { data: existing } = await supabase
      .from('ruankao_checkins')
      .select('id')
      .eq('user_id', userId)
      .eq('checkin_date', checkin_date)
      .maybeSingle();

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('ruankao_checkins')
        .update({
          study_minutes,
          note,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('ruankao_checkins')
        .insert([{ user_id: userId, checkin_date, study_minutes, note }])
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    const streak = await calcStreak(supabase, userId);
    return ok(res, { checkin: result, streak }, '打卡成功');
  } catch (error) {
    console.error('打卡失败:', error);
    return fail(res, 500, '打卡失败', error);
  }
});

/**
 * 【功能描述】
 * 分页查询当前用户学习笔记
 *
 * 【业务逻辑】
 * 1. 支持 category 精确筛选、keyword 标题/正文模糊搜索
 * 2. 按 updated_at 倒序分页
 *
 * 【技术实现】
 * - 涉及方法：supabase.or() ilike、range 分页
 * - 涉及知识点：用户笔记 CRUD 之读
 */
router.get('/notes', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { category, keyword, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('ruankao_notes')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.userId);

    if (category) query = query.eq('category', category);
    if (keyword) query = query.or(`title.ilike.%${keyword}%,content.ilike.%${keyword}%`);

    const { data, error, count } = await query
      .order('updated_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;
    return ok(res, { list: data || [], total: count || 0, page: pageNum, limit: limitNum });
  } catch (error) {
    console.error('获取笔记失败:', error);
    return fail(res, 500, '获取笔记失败', error);
  }
});

/**
 * 【功能描述】
 * 创建学习笔记
 *
 * 【业务逻辑】
 * 1. 标题必填，内容可选，分类默认「综合」
 * 2. 截断 title/category 长度后插入
 *
 * 【技术实现】
 * - 涉及方法：insert().select().single()、201 响应
 * - 涉及知识点：用户内容创建
 */
router.post('/notes', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    const category = String(req.body?.category || '综合').trim() || '综合';

    if (!title) return fail(res, 400, '标题不能为空');

    const { data, error } = await supabase
      .from('ruankao_notes')
      .insert([
        {
          user_id: req.user.userId,
          title: title.slice(0, 200),
          content,
          category: category.slice(0, 50),
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return ok(res, data, '创建成功', 201);
  } catch (error) {
    console.error('创建笔记失败:', error);
    return fail(res, 500, '创建笔记失败', error);
  }
});

/**
 * 【功能描述】
 * 更新指定笔记（部分字段）
 *
 * 【业务逻辑】
 * 1. 仅更新 body 中提供的 title/content/category
 * 2. 标题不能为空字符串
 * 3. 必须属于当前用户
 *
 * 【技术实现】
 * - 涉及方法：动态 updates 对象、update().eq().maybeSingle()
 * - 涉及知识点：PATCH 语义、所有权校验
 */
router.put('/notes/:id', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const updates = { updated_at: new Date().toISOString() };
    if (req.body?.title != null) updates.title = String(req.body.title).trim().slice(0, 200);
    if (req.body?.content != null) updates.content = String(req.body.content);
    if (req.body?.category != null) {
      updates.category = String(req.body.category).trim().slice(0, 50) || '综合';
    }

    if (updates.title === '') return fail(res, 400, '标题不能为空');

    const { data, error } = await supabase
      .from('ruankao_notes')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.userId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return fail(res, 404, '笔记不存在');
    return ok(res, data, '更新成功');
  } catch (error) {
    console.error('更新笔记失败:', error);
    return fail(res, 500, '更新笔记失败', error);
  }
});

/**
 * 【功能描述】
 * 删除指定笔记
 *
 * 【业务逻辑】
 * 1. 按 id 与 user_id 硬删除
 * 2. 成功返回「删除成功」
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().delete().eq()
 * - 涉及知识点：用户数据隔离
 */
router.delete('/notes/:id', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { error } = await supabase
      .from('ruankao_notes')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.userId);

    if (error) throw error;
    return ok(res, null, '删除成功');
  } catch (error) {
    console.error('删除笔记失败:', error);
    return fail(res, 500, '删除笔记失败', error);
  }
});

/**
 * 【功能描述】
 * 获取知识卡片列表及分类汇总
 *
 * 【业务逻辑】
 * 1. 可选 category、keyword 筛选
 * 2. 按 sort_order 升序返回
 * 3. 从结果提取 categories 去重列表
 *
 * 【技术实现】
 * - 涉及方法：supabase.or() ilike、order、Set 去重
 * - 涉及知识点：全局知识库只读 API
 */
router.get('/knowledge', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { category, keyword } = req.query;

    let query = supabase.from('ruankao_knowledge').select('*');
    if (category) query = query.eq('category', category);
    if (keyword) {
      query = query.or(`title.ilike.%${keyword}%,content.ilike.%${keyword}%`);
    }

    const { data, error } = await query.order('sort_order', { ascending: true });
    if (error) throw error;

    const categories = [...new Set((data || []).map((d) => d.category))];
    return ok(res, { list: data || [], categories });
  } catch (error) {
    console.error('获取知识卡片失败:', error);
    return fail(res, 500, '获取知识卡片失败', error);
  }
});

/**
 * 【功能描述】
 * 手动录入/补充题目
 *
 * 【业务逻辑】
 * 1. 校验 stem、options 数组、answer 必填
 * 2. 答案规范化为大写字母，tags 追加 manual
 * 3. 生成 external_id 前缀 manual- 后插入
 *
 * 【技术实现】
 * - 涉及方法：insert().select().single()、字符串 sanitize
 * - 涉及知识点：UGC 题目、201 Created
 */
router.post('/questions', authenticate, async (req, res) => {
  try {
    const {
      subject = '综合知识',
      chapter = '',
      qtype = 'single',
      stem,
      options,
      answer,
      explanation = '',
      difficulty = 'medium',
      tags = [],
    } = req.body || {};

    if (!stem || !answer || !Array.isArray(options) || !options.length) {
      return fail(res, 400, '请提供题干、选项与答案');
    }

    const supabase = getSupabase(req);
    const { data, error } = await supabase
      .from('ruankao_questions')
      .insert([
        {
          subject,
          chapter,
          qtype,
          stem: String(stem).trim(),
          options,
          answer: String(answer).toUpperCase().replace(/[^A-Z]/g, ''),
          explanation,
          difficulty,
          tags: Array.isArray(tags) ? [...tags, 'manual'] : ['manual'],
          external_id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return ok(res, data, '题目已添加', 201);
  } catch (error) {
    console.error('添加题目失败:', error);
    return fail(res, 500, '添加题目失败', error);
  }
});

/**
 * 【功能描述】
 * 更新指定题目字段
 *
 * 【业务逻辑】
 * 1. 白名单字段 subject/chapter/qtype/stem/options/answer/explanation/difficulty/tags
 * 2. answer 再次规范化，stem trim
 * 3. 不存在返回 404
 *
 * 【技术实现】
 * - 涉及方法：动态 updates 循环、update().maybeSingle()
 * - 涉及知识点：题目维护、partial update
 */
router.put('/questions/:id', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const updates = { updated_at: new Date().toISOString() };
    const fields = [
      'subject',
      'chapter',
      'qtype',
      'stem',
      'options',
      'answer',
      'explanation',
      'difficulty',
      'tags',
    ];
    for (const key of fields) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.answer) {
      updates.answer = String(updates.answer).toUpperCase().replace(/[^A-Z]/g, '');
    }
    if (updates.stem) updates.stem = String(updates.stem).trim();

    const { data, error } = await supabase
      .from('ruankao_questions')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return fail(res, 404, '题目不存在');
    return ok(res, data, '更新成功');
  } catch (error) {
    console.error('更新题目失败:', error);
    return fail(res, 500, '更新题目失败', error);
  }
});

/**
 * 【功能描述】
 * 删除指定题目
 *
 * 【业务逻辑】
 * 1. 按 id 从 ruankao_questions 硬删除
 * 2. 成功返回「删除成功」
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().delete().eq()
 * - 涉及知识点：题目库维护
 */
router.delete('/questions/:id', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { error } = await supabase.from('ruankao_questions').delete().eq('id', req.params.id);
    if (error) throw error;
    return ok(res, null, '删除成功');
  } catch (error) {
    console.error('删除题目失败:', error);
    return fail(res, 500, '删除题目失败', error);
  }
});

/**
 * 【功能描述】
 * 调用 DeepSeek AI 批量生成高项练习题并入库
 *
 * 【业务逻辑】
 * 1. 校验 DEEPSEEK_API_KEY，解析 count/subject/chapter/focus
 * 2. 拉取同章节已有题干片段避免重复
 * 3. 构造 prompt 调用 DeepSeek chat/completions
 * 4. 解析 JSON 数组，映射为题目行 bulk insert
 * 5. 处理余额不足、Key 无效等 HTTP 错误提示
 *
 * 【技术实现】
 * - 涉及方法：fetch DeepSeek API、JSON.parse、markdown 代码块剥离、insert().select()
 * - 涉及知识点：LLM 出题、prompt engineering、external_id ai- 前缀
 */
router.post('/generate', authenticate, async (req, res) => {
  try {
    const apiKey = (process.env.DEEPSEEK_API_KEY || '').replace(/^['"]|['"]$/g, '');
    if (!apiKey) {
      return fail(res, 500, '未配置 DEEPSEEK_API_KEY，请先在后端 .env 配置');
    }

    const count = Math.min(10, Math.max(1, parseInt(req.body?.count, 10) || 5));
    const subject = String(req.body?.subject || '综合知识').slice(0, 50);
    const chapter = String(req.body?.chapter || '十大管理').slice(0, 80);
    const focus = String(req.body?.focus || '').slice(0, 200);

    const supabase = getSupabase(req);
    const { data: existing } = await supabase
      .from('ruankao_questions')
      .select('stem')
      .eq('chapter', chapter)
      .limit(30);
    const avoid = (existing || [])
      .map((q) => q.stem)
      .filter(Boolean)
      .slice(0, 15)
      .map((s, i) => `${i + 1}. ${String(s).slice(0, 60)}`)
      .join('\n');

    const prompt = `你是信息系统项目管理师（软考高项）出题专家。请原创生成 ${count} 道四选一单选题，用于备考练习（不是历年真题原文照搬）。

要求：
- 科目：${subject}
- 章节/主题：${chapter}
${focus ? `- 额外聚焦：${focus}` : ''}
- 贴合第4版教程常见考点：十大管理、ITTO、挣值、进度网络图、风险、质量、采购、敏捷、论文相关概念等
- 每题必须有且仅有一个正确答案
- 解析要说明考查点与易错点
- 避免与下列已有题干过于相似：
${avoid || '（暂无）'}

只返回 JSON 数组，不要 markdown，格式：
[
  {
    "stem": "题干",
    "options": [{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."},{"key":"D","text":"..."}],
    "answer": "C",
    "explanation": "解析",
    "difficulty": "easy|medium|hard",
    "tags": ["标签1","标签2"]
  }
]`;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.85,
        top_p: 0.95,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepSeek 错误:', errorText);
      let tip = `AI 调用失败: ${response.status}`;
      if (response.status === 402 || /balance|quota|insufficient|arrear/i.test(errorText)) {
        tip = 'DeepSeek 余额不足，请充值后再用 AI 出题；可先使用「手动录入」';
      } else if (response.status === 401) {
        tip = 'DeepSeek API Key 无效，请检查后端 .env 中的 DEEPSEEK_API_KEY';
      }
      return fail(res, 500, tip);
    }

    const aiData = await response.json();
    let content = aiData.choices?.[0]?.message?.content || '';
    content = content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let questions;
    try {
      questions = JSON.parse(content);
    } catch (e) {
      console.error('AI JSON 解析失败:', content.slice(0, 400));
      return fail(res, 500, 'AI 返回格式错误');
    }

    if (!Array.isArray(questions) || !questions.length) {
      return fail(res, 500, 'AI 未返回题目');
    }

    const rows = questions
      .map((q, idx) => {
        if (!q.stem || !q.answer || !Array.isArray(q.options)) return null;
        return {
          subject,
          chapter,
          qtype: 'single',
          stem: String(q.stem).trim(),
          options: q.options.map((o) => ({
            key: String(o.key || '').toUpperCase(),
            text: String(o.text || '').trim(),
          })),
          answer: String(q.answer).toUpperCase().replace(/[^A-Z]/g, ''),
          explanation: String(q.explanation || ''),
          difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
          tags: [
            'ai-generated',
            'deepseek',
            ...(Array.isArray(q.tags) ? q.tags.map(String) : []),
          ],
          external_id: `ai-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        };
      })
      .filter(Boolean);

    if (!rows.length) return fail(res, 500, '题目字段不完整');

    const { data, error } = await supabase.from('ruankao_questions').insert(rows).select();
    if (error) throw error;

    return ok(res, { list: data || [], count: (data || []).length }, 'AI 出题成功', 201);
  } catch (error) {
    console.error('AI 出题失败:', error);
    return fail(res, 500, 'AI 出题失败', error);
  }
});

module.exports = router;
