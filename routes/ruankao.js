const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const getSupabase = (req) => req.app.get('supabaseAdmin') || req.app.get('supabase');

function ok(res, data, message = '成功', status = 200) {
  return res.status(status).json({ code: status === 201 ? 201 : 200, message, data });
}

function fail(res, status, message, error) {
  return res.status(status).json({
    code: status,
    message,
    data: null,
    error: error?.message || error || undefined,
  });
}

function todayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

function answersEqual(a, b) {
  return normalizeAnswer(a) === normalizeAnswer(b);
}

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

// ========== 概览统计 ==========
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

// ========== 题目列表 ==========
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

// 随机抽题练习（不含答案，提交后再返回解析）
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

// 章节/科目筛选项
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

// ========== 提交答案 ==========
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

// ========== 错题本 ==========
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

// ========== 每日打卡 ==========
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

// ========== 学习笔记 ==========
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

// ========== 知识卡片 ==========
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

// 手动录入 / 补充题目（登录用户可用）
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

// 更新题目
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

// 删除题目
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
 * AI 生成高项练习题（DeepSeek）
 * body: { count?: number, chapter?: string, subject?: string, focus?: string }
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
