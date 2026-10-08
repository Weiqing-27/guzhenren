const express = require('express');
const { authenticate } = require('../middleware/auth');
const seedMonths = require('./growth-seed');
const { buildStageTaskTemplates } = require('./growth-template');
const {
  createQuestionEvaluationGuide,
  generateGrowthPractice,
  generateReviewAdvice,
  gradeGrowthPractice,
} = require('../services/deepseek');
const { evaluateTaskMastery } = require('./growth-mastery');
const {
  assertDateKey,
  calculateStreak,
  createStageProgress,
  createReviewSnapshot,
  shiftDate,
  startOfMonth,
  startOfWeek,
  todayInTimeZone,
} = require('./growth-logic');

const router = express.Router();

const response = (res, data, meta = undefined, status = 200) => {
  const body = { data, error: null };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
};

const apiError = (status, code, message, details) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
};

const route = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    console.error(`[growth] ${req.method} ${req.originalUrl}:`, error.message);
    const status = error.status || 500;
    const publicMessage = error.code?.startsWith('AI_') || status < 500
      ? error.message
      : '成长系统暂时不可用，请稍后重试';
    res.status(status).json({
      data: null,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: publicMessage,
        ...(status < 500 && error.details ? { details: error.details } : {}),
      },
    });
  }
};

const getDb = (req) => {
  if (!req.app.get('hasSupabaseServiceRole')) {
    throw apiError(503, 'GROWTH_NOT_CONFIGURED', '成长系统服务端数据库凭证尚未配置');
  }
  return req.app.get('supabaseAdmin');
};

const ensureDbResult = (result, fallback = '数据库操作失败') => {
  if (result.error) {
    const { code, message, details, hint } = result.error;
    console.error('[growth][database]', {
      operation: fallback,
      code,
      message,
      details,
      hint,
    });
    throw apiError(500, 'DATABASE_ERROR', fallback);
  }
  return result.data;
};

const requiredText = (value, field) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw apiError(400, 'VALIDATION_ERROR', `${field}不能为空`, { field });
  return text;
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

async function resolveRoadmapTaskLink(db, userId, body, required = true) {
  if (!hasOwn(body, 'roadmap_task_id')) {
    if (!required) return undefined;
    throw apiError(400, 'VALIDATION_ERROR', '请选择关联路线任务或明确选择路线外学习');
  }
  const taskId = body.roadmap_task_id;
  if (taskId === null || taskId === '') return null;
  const result = await db.from('growth_roadmap_tasks')
    .select('id')
    .eq('id', taskId)
    .eq('user_id', userId)
    .maybeSingle();
  if (result.error) throw apiError(500, 'DATABASE_ERROR', '校验关联路线任务失败');
  if (!result.data) throw apiError(400, 'INVALID_ROADMAP_TASK', '关联路线任务不存在或不属于当前用户');
  return result.data.id;
}

async function loadRoadmapTask(db, userId, taskId) {
  const result = await db.from('growth_roadmap_tasks')
    .select('id,title,acceptance_criteria,task_type')
    .eq('id', taskId)
    .eq('user_id', userId)
    .maybeSingle();
  if (result.error) throw apiError(500, 'DATABASE_ERROR', '读取关联路线任务失败');
  if (!result.data) throw apiError(400, 'INVALID_ROADMAP_TASK', '关联路线任务不存在或不属于当前用户');
  return result.data;
}

const questionTypeForPractice = (practiceType) => (
  ['coding', 'debug', 'review'].includes(practiceType) ? 'coding' : 'theory'
);

const practiceTypeForQuestion = (questionType) => (questionType === 'coding' ? 'coding' : 'concept');

const resultForScore = (score) => (score >= 7 ? 'passed' : (score >= 4 ? 'partial' : 'failed'));

async function createGrowthPracticeFromQuestion(db, userId, task, question, source) {
  let referenceAnswer = question.reference_answer;
  let scoringRubric = question.scoring_rubric;
  if (!referenceAnswer || !scoringRubric) {
    const guide = await createQuestionEvaluationGuide({
      title: question.title,
      content: question.content,
      topic: task.title,
    });
    referenceAnswer = guide.reference_answer;
    scoringRubric = guide.scoring_rubric;
    const questionUpdate = await db.from('questions')
      .update({ ...guide, topic: question.topic || task.title })
      .eq('id', question.id);
    ensureDbResult(questionUpdate, '补充题库评分标准失败');
  }
  const result = await db.from('growth_practices').insert([{
    user_id: userId,
    roadmap_task_id: task.id,
    question_id: question.id,
    title: question.title,
    prompt: question.content,
    practice_type: practiceTypeForQuestion(question.type),
    difficulty: question.difficulty || 'medium',
    source,
    reference_answer: referenceAnswer,
    scoring_rubric: scoringRubric,
  }]).select('id,question_id,roadmap_task_id,title,practice_type,difficulty,prompt,source,status,created_at').single();
  return ensureDbResult(result, '创建题库练习失败');
}

async function evaluateMasteryForTasks(db, userId, tasks = []) {
  const knowledgeTasks = tasks.filter((item) => item.task_type === 'knowledge' && item.status !== 'skipped');
  const taskIds = knowledgeTasks.map((item) => item.id);
  if (!taskIds.length) return [];
  const [logsResult, cardsResult, practicesResult, projectsResult, existingResult] = await Promise.all([
    db.from('growth_learning_logs')
      .select('id,roadmap_task_id,duration_minutes,log_date')
      .eq('user_id', userId)
      .in('roadmap_task_id', taskIds),
    db.from('growth_knowledge_items')
      .select('id,roadmap_task_id,what_text,why_text,how_text,archived_at')
      .eq('user_id', userId)
      .in('roadmap_task_id', taskIds),
    db.from('growth_practices')
      .select('id,roadmap_task_id,practice_type,source')
      .eq('user_id', userId)
      .in('roadmap_task_id', taskIds)
      .neq('status', 'archived'),
    db.from('growth_projects')
      .select('id,roadmap_task_id,status,repository_url,demo_url')
      .eq('user_id', userId)
      .in('roadmap_task_id', taskIds)
      .neq('status', 'archived'),
    db.from('growth_mastery_assessments')
      .select('*')
      .eq('user_id', userId)
      .in('roadmap_task_id', taskIds),
  ]);
  const logs = ensureDbResult(logsResult, '读取掌握度日志证据失败') || [];
  const knowledgeItems = ensureDbResult(cardsResult, '读取掌握度知识卡片失败') || [];
  const practices = ensureDbResult(practicesResult, '读取掌握度练习失败') || [];
  const projects = ensureDbResult(projectsResult, '读取掌握度项目证据失败') || [];
  const existing = ensureDbResult(existingResult, '读取掌握度评估失败') || [];
  const practiceIds = practices.map((item) => item.id);
  let attempts = [];
  if (practiceIds.length) {
    const attemptsResult = await db.from('growth_practice_attempts')
      .select('id,practice_id,system_score,submitted_at')
      .eq('user_id', userId)
      .in('practice_id', practiceIds)
      .not('system_score', 'is', null);
    attempts = ensureDbResult(attemptsResult, '读取掌握度判卷证据失败') || [];
  }
  const existingByTask = new Map(existing.map((item) => [item.roadmap_task_id, item]));
  const now = new Date().toISOString();
  const assessments = knowledgeTasks.map((task) => {
    const evaluation = evaluateTaskMastery({ task, logs, knowledgeItems, practices, attempts, projects });
    const previous = existingByTask.get(task.id);
    return {
      user_id: userId,
      roadmap_task_id: task.id,
      level: evaluation.level,
      previous_level: !previous
        ? 0
        : (Number(previous.level) !== evaluation.level ? Number(previous.level) : Number(previous.previous_level || 0)),
      evidence: evaluation.evidence,
      next_requirement: evaluation.nextRequirement,
      evaluated_at: now,
      level_changed_at: !previous || Number(previous.level) !== evaluation.level
        ? now
        : previous.level_changed_at,
    };
  });
  const upsertResult = await db.from('growth_mastery_assessments')
    .upsert(assessments, { onConflict: 'user_id,roadmap_task_id' })
    .select();
  return ensureDbResult(upsertResult, '保存掌握度评估失败') || [];
}

const attachMastery = (tasks, assessments) => {
  const byTask = new Map(assessments.map((item) => [item.roadmap_task_id, item]));
  return tasks.map((task) => ({
    ...task,
    mastery: byTask.get(task.id) || null,
    mastery_level: Number(byTask.get(task.id)?.level || 0),
  })).sort((left, right) => (
    Number(right.recommendation_priority || 0) - Number(left.recommendation_priority || 0)
  ));
};

async function syncRoadmapTemplate(db, userId, roadmapId) {
  const roadmapResult = await db.from('growth_roadmaps')
    .select('id,template_version')
    .eq('id', roadmapId)
    .eq('user_id', userId)
    .maybeSingle();
  if (roadmapResult.error) throw apiError(500, 'DATABASE_ERROR', '读取路线模板版本失败');
  if (!roadmapResult.data) throw apiError(404, 'NOT_FOUND', '路线不存在');
  if (Number(roadmapResult.data.template_version) >= 2) return { created: 0, upgraded: 0, templateVersion: 2 };

  const monthsResult = await db.from('growth_roadmap_months')
    .select('id,month_number,ends_on')
    .eq('roadmap_id', roadmapId)
    .eq('user_id', userId)
    .order('sort_order');
  const months = ensureDbResult(monthsResult, '读取路线阶段失败') || [];
  const monthIds = months.map((item) => item.id);
  let existingTasks = [];
  if (monthIds.length) {
    const tasksResult = await db.from('growth_roadmap_tasks')
      .select('id,roadmap_month_id,title,task_type,status,seed_key')
      .eq('user_id', userId)
      .in('roadmap_month_id', monthIds);
    existingTasks = ensureDbResult(tasksResult, '读取路线任务失败') || [];
  }

  const inserts = [];
  let upgraded = 0;
  for (const month of months) {
    const seedMonth = seedMonths[Number(month.month_number) - 1];
    if (!seedMonth) continue;
    const templates = buildStageTaskTemplates(seedMonth);
    const monthTasks = existingTasks.filter((item) => item.roadmap_month_id === month.id);
    const seededKeys = new Set(monthTasks.map((item) => item.seed_key).filter(Boolean));

    for (const template of templates) {
      if (seededKeys.has(template.seed_key)) continue;
      const legacy = template.seed_key === 'knowledge-01'
        ? monthTasks.find((item) => !item.seed_key && item.task_type === 'knowledge' && item.title.startsWith('完成「'))
        : template.seed_key === 'project-deliverable'
          ? monthTasks.find((item) => !item.seed_key && item.task_type === 'project')
          : null;
      if (legacy) {
        const updateResult = await db.from('growth_roadmap_tasks')
          .update({ ...template, due_date: month.ends_on })
          .eq('id', legacy.id)
          .eq('user_id', userId);
        ensureDbResult(updateResult, '升级旧版路线任务失败');
        legacy.seed_key = template.seed_key;
        upgraded += 1;
      } else {
        inserts.push({
          ...template,
          user_id: userId,
          roadmap_month_id: month.id,
          due_date: month.ends_on,
        });
      }
    }
  }

  if (inserts.length) {
    const insertResult = await db.from('growth_roadmap_tasks').insert(inserts);
    ensureDbResult(insertResult, '补全细化路线任务失败');
  }
  const versionResult = await db.from('growth_roadmaps')
    .update({ template_version: 2 })
    .eq('id', roadmapId)
    .eq('user_id', userId);
  ensureDbResult(versionResult, '更新路线模板版本失败');
  return { created: inserts.length, upgraded, templateVersion: 2 };
}

const clampPage = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
};

const pagination = (query) => {
  const page = clampPage(query.page, 1, 100000);
  const pageSize = clampPage(query.pageSize || query.size || query.limit, 20, 100);
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
};

const endOfMonth = (dateKey) => shiftDate(addMonths(`${dateKey.slice(0, 7)}-01`, 1), -1);

function addMonths(dateKey, count) {
  assertDateKey(dateKey);
  const [year, month, day] = dateKey.split('-').map(Number);
  const targetFirst = new Date(Date.UTC(year, month - 1 + count, 1));
  const targetLast = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetFirst.getUTCFullYear(),
    targetFirst.getUTCMonth(),
    Math.min(day, targetLast),
  )).toISOString().slice(0, 10);
}

async function loadStatistics(db, userId, from, to, options = {}) {
  assertDateKey(from, 'from');
  assertDateKey(to, 'to');
  if (from > to) throw apiError(400, 'VALIDATION_ERROR', 'from 不能晚于 to');

  const activityTo = options.activityTo || to;
  const periodTo = options.periodTo || to;
  assertDateKey(activityTo, 'activityTo');
  assertDateKey(periodTo, 'periodTo');

  let tasksQuery = db.from('growth_roadmap_tasks')
    .select('status,weight,due_date')
    .eq('user_id', userId);
  tasksQuery = options.roadmapMonthId
    ? tasksQuery.eq('roadmap_month_id', options.roadmapMonthId)
    : tasksQuery.gte('due_date', from).lte('due_date', periodTo);

  const [logsResult, tasksResult, attemptsResult, milestonesResult] = await Promise.all([
    db.from('growth_learning_logs')
      .select('log_date,duration_minutes')
      .eq('user_id', userId)
      .gte('log_date', from)
      .lte('log_date', activityTo),
    tasksQuery,
    db.from('growth_practice_attempts')
      .select('result,submitted_at')
      .eq('user_id', userId)
      .gte('submitted_at', `${from}T00:00:00.000Z`)
      .lte('submitted_at', `${activityTo}T23:59:59.999Z`),
    db.from('growth_project_milestones')
      .select('status,due_date')
      .eq('user_id', userId)
      .gte('due_date', from)
      .lte('due_date', periodTo),
  ]);

  const logs = ensureDbResult(logsResult) || [];
  const tasks = ensureDbResult(tasksResult) || [];
  const practices = ensureDbResult(attemptsResult) || [];
  const milestones = ensureDbResult(milestonesResult) || [];
  return {
    ...createReviewSnapshot({ logs, tasks, practices, milestones }),
    from,
    to,
  };
}

async function buildReviewPreview(db, userId, from, to, reviewType = 'weekly', includeAdvice = true) {
  assertDateKey(from, 'periodStart');
  assertDateKey(to, 'periodEnd');
  if (from > to) throw apiError(400, 'VALIDATION_ERROR', '复盘开始日期不能晚于结束日期');
  const stats = await loadStatistics(db, userId, from, to);
  const monthsResult = await db.from('growth_roadmap_months')
    .select('id,month_number,title')
    .eq('user_id', userId)
    .lte('starts_on', to)
    .gte('ends_on', from)
    .order('sort_order');
  const months = ensureDbResult(monthsResult, '读取复盘路线阶段失败') || [];
  const monthIds = months.map((item) => item.id);
  let tasks = [];
  if (monthIds.length) {
    const tasksResult = await db.from('growth_roadmap_tasks')
      .select('*')
      .eq('user_id', userId)
      .in('roadmap_month_id', monthIds)
      .neq('status', 'skipped')
      .order('recommendation_priority', { ascending: false });
    tasks = ensureDbResult(tasksResult, '读取复盘计划任务失败') || [];
  }
  const [logsResult, attemptsResult, milestonesResult] = await Promise.all([
    db.from('growth_learning_logs')
      .select('id,roadmap_task_id,log_date,duration_minutes,topic')
      .eq('user_id', userId)
      .gte('log_date', from)
      .lte('log_date', to)
      .order('log_date'),
    db.from('growth_practice_attempts')
      .select('id,practice_id,system_score,system_feedback,submitted_at')
      .eq('user_id', userId)
      .gte('submitted_at', `${from}T00:00:00.000Z`)
      .lte('submitted_at', `${to}T23:59:59.999Z`)
      .not('system_score', 'is', null)
      .order('submitted_at'),
    db.from('growth_project_milestones')
      .select('id,project_id,title,status,completed_at')
      .eq('user_id', userId)
      .eq('status', 'done')
      .gte('completed_at', `${from}T00:00:00.000Z`)
      .lte('completed_at', `${to}T23:59:59.999Z`),
  ]);
  const logs = ensureDbResult(logsResult, '读取复盘学习记录失败') || [];
  const attempts = ensureDbResult(attemptsResult, '读取复盘练习记录失败') || [];
  const milestones = ensureDbResult(milestonesResult, '读取复盘项目记录失败') || [];
  let practices = [];
  const practiceIds = [...new Set(attempts.map((item) => item.practice_id))];
  if (practiceIds.length) {
    const practicesResult = await db.from('growth_practices')
      .select('id,roadmap_task_id,title,source,practice_type')
      .eq('user_id', userId)
      .in('id', practiceIds);
    practices = ensureDbResult(practicesResult, '读取复盘练习题失败') || [];
  }
  const practiceById = new Map(practices.map((item) => [item.id, item]));
  const assessments = await evaluateMasteryForTasks(db, userId, tasks);
  const masteryGains = assessments
    .filter((item) => item.level_changed_at?.slice(0, 10) >= from && item.level_changed_at?.slice(0, 10) <= to && Number(item.level) > Number(item.previous_level))
    .sort((left, right) => (Number(right.level) - Number(right.previous_level)) - (Number(left.level) - Number(left.previous_level)))
    .slice(0, 3);
  const taskById = new Map(tasks.map((item) => [item.id, item]));
  const lowAttempts = attempts.filter((item) => Number(item.system_score) < 7);
  const weakTaskIds = [...new Set(lowAttempts.map((item) => practiceById.get(item.practice_id)?.roadmap_task_id).filter(Boolean))];

  const planned = tasks.length
    ? tasks.map((item) => `- ${item.title}（${item.status === 'done' ? '已完成' : '计划中'}，要求 L${item.required_mastery_level || 3}）`).join('\n')
    : '本周期没有匹配到路线计划任务。';
  const completionLines = [
    ...logs.map((item) => `- ${item.log_date} 学习「${item.topic}」${item.duration_minutes} 分钟`),
    ...attempts.map((item) => `- 练习「${practiceById.get(item.practice_id)?.title || '未知题目'}」得分 ${item.system_score}/10`),
    ...milestones.map((item) => `- 完成项目里程碑「${item.title}」`),
  ];
  const completed = completionLines.length ? completionLines.join('\n') : '本周期暂无有效学习、练习或项目里程碑记录。';
  const wins = masteryGains.length
    ? masteryGains.map((item) => `- ${taskById.get(item.roadmap_task_id)?.title || '知识点'}：L${item.previous_level} → L${item.level}`).join('\n')
    : '本周期暂无知识等级提升记录。';
  const incompleteTasks = tasks.filter((item) => item.status !== 'done');
  const problemLines = [
    ...lowAttempts.map((item) => `- 「${practiceById.get(item.practice_id)?.title || '练习'}」仅 ${item.system_score}/10：${item.system_feedback || '需要重新练习'}`),
    ...incompleteTasks.map((item) => `- 路线任务「${item.title}」尚未完成`),
  ];
  const problems = problemLines.length ? problemLines.join('\n') : '本周期未发现明显低分练习或未完成任务。';
  let nextPlan = weakTaskIds.length
    ? `优先复习：${weakTaskIds.map((id) => taskById.get(id)?.title).filter(Boolean).join('、')}，完成一次针对性学习和一次新练习。`
    : '保持当前节奏，选择下一个未达标知识点完成学习、练习和证据闭环。';
  let adviceWarning = null;
  if (includeAdvice) {
    try {
      nextPlan = await generateReviewAdvice({ reviewType, planned, completed, wins, problems });
    } catch (error) {
      adviceWarning = error.message;
    }
  }
  return {
    ...stats,
    autoFill: { planned, completed, wins, problems, next_plan: nextPlan },
    masteryGains,
    lowScoreCount: lowAttempts.length,
    incompleteTaskCount: incompleteTasks.length,
    weakTaskIds,
    adviceWarning,
  };
}

router.get('/health', (req, res) => response(res, { status: 'ok', module: 'growth-v1' }));

router.use(authenticate);

router.get('/me', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const profileResult = await db.from('growth_profiles').select('*').eq('user_id', userId).maybeSingle();
  if (profileResult.error) throw apiError(500, 'DATABASE_ERROR', '读取成长设置失败');
  if (!profileResult.data) {
    const created = await db.from('growth_profiles')
      .insert([{ user_id: userId }])
      .select()
      .single();
    ensureDbResult(created, '初始化成长设置失败');
    return response(res, { user: req.user, profile: created.data }, undefined, 201);
  }
  return response(res, { user: req.user, profile: profileResult.data });
}));

router.get('/dashboard', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const today = req.query.date || todayInTimeZone();
  assertDateKey(today, 'date');
  const requestedScope = req.query.scope || 'stage';
  if (!['stage', 'calendar_month'].includes(requestedScope)) {
    throw apiError(400, 'VALIDATION_ERROR', 'scope 必须是 stage 或 calendar_month');
  }

  const roadmapResult = await db.from('growth_roadmaps')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (roadmapResult.error) throw apiError(500, 'DATABASE_ERROR', '读取路线失败');
  const roadmap = roadmapResult.data || null;

  let currentMonth = null;
  let monthTasks = [];
  let masteryAssessments = [];
  if (roadmap) {
    const monthsResult = await db.from('growth_roadmap_months')
      .select('*')
      .eq('user_id', userId)
      .eq('roadmap_id', roadmap.id)
      .order('sort_order');
    const months = ensureDbResult(monthsResult, '读取路线月份失败') || [];
    currentMonth = months.find((item) => item.starts_on <= today && item.ends_on >= today)
      || months.find((item) => item.starts_on > today)
      || months.at(-1)
      || null;
    if (currentMonth) {
      const tasksResult = await db.from('growth_roadmap_tasks')
        .select('*')
        .eq('user_id', userId)
        .eq('roadmap_month_id', currentMonth.id)
        .order('due_date');
      monthTasks = ensureDbResult(tasksResult, '读取路线任务失败') || [];
      masteryAssessments = await evaluateMasteryForTasks(db, userId, monthTasks);
      monthTasks = attachMastery(monthTasks, masteryAssessments);
    }
  }

  const weekFrom = startOfWeek(today);
  const calendarMonthFrom = startOfMonth(today);
  const calendarMonthTo = endOfMonth(today);
  const scope = requestedScope === 'stage' && currentMonth ? 'stage' : 'calendar_month';
  const summaryFrom = scope === 'stage' ? currentMonth.starts_on : calendarMonthFrom;
  const summaryTo = scope === 'stage' ? currentMonth.ends_on : calendarMonthTo;
  const observedTo = today < summaryFrom ? summaryFrom : (today > summaryTo ? summaryTo : today);
  const summaryOptions = scope === 'stage'
    ? { activityTo: observedTo, periodTo: summaryTo, roadmapMonthId: currentMonth.id }
    : { activityTo: observedTo, periodTo: summaryTo };
  const [recentLogsResult, activeProjectsResult, streakLogsResult, weekStats, summaryStats] = await Promise.all([
    db.from('growth_learning_logs').select('*').eq('user_id', userId).order('log_date', { ascending: false }).limit(5),
    db.from('growth_projects').select('*').eq('user_id', userId).in('status', ['planned', 'active', 'paused']).order('updated_at', { ascending: false }).limit(5),
    db.from('growth_learning_logs').select('log_date,duration_minutes').eq('user_id', userId).gt('duration_minutes', 0).lte('log_date', today).order('log_date', { ascending: false }).limit(366),
    loadStatistics(db, userId, weekFrom, today),
    loadStatistics(db, userId, summaryFrom, summaryTo, summaryOptions),
  ]);

  const recentLogs = ensureDbResult(recentLogsResult, '读取学习日志失败') || [];
  const projects = ensureDbResult(activeProjectsResult, '读取项目失败') || [];
  const streakLogs = ensureDbResult(streakLogsResult, '读取连续学习数据失败') || [];
  const streak = calculateStreak(streakLogs.map((item) => item.log_date), today);

  response(res, {
    today,
    roadmap,
    currentMonth: currentMonth ? {
      ...currentMonth,
      progress_metrics: createStageProgress(currentMonth, monthTasks, today, masteryAssessments),
    } : null,
    monthTasks,
    recentLogs,
    projects,
    streak,
    week: weekStats,
    summary: {
      ...summaryStats,
      scope,
      scopeLabel: scope === 'stage'
        ? `当前路线阶段 M${String(currentMonth.month_number).padStart(2, '0')}`
        : `${today.slice(0, 4)} 年 ${Number(today.slice(5, 7))} 月`,
      period: { from: summaryFrom, to: summaryTo, observedTo },
    },
    reviewDue: {
      weekly: new Date(`${today}T00:00:00Z`).getUTCDay() === 0,
      monthly: today === endOfMonth(today),
    },
  });
}));

router.get('/roadmaps', route(async (req, res) => {
  const db = getDb(req);
  const result = await db.from('growth_roadmaps').select('*').eq('user_id', req.user.userId).order('created_at', { ascending: false });
  response(res, ensureDbResult(result, '读取路线失败') || []);
}));

router.get('/roadmap-tasks/options', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const today = req.query.date || todayInTimeZone();
  assertDateKey(today, 'date');
  const roadmapResult = await db.from('growth_roadmaps')
    .select('id,title')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (roadmapResult.error) throw apiError(500, 'DATABASE_ERROR', '读取当前路线失败');
  if (!roadmapResult.data) return response(res, []);

  const monthsResult = await db.from('growth_roadmap_months')
    .select('id,month_number,title,starts_on,ends_on')
    .eq('roadmap_id', roadmapResult.data.id)
    .eq('user_id', userId)
    .order('sort_order');
  const months = ensureDbResult(monthsResult, '读取路线阶段失败') || [];
  const currentMonth = months.find((item) => item.starts_on <= today && item.ends_on >= today)
    || months.find((item) => item.starts_on > today)
    || months.at(-1);
  if (!currentMonth) return response(res, []);

  const tasksResult = await db.from('growth_roadmap_tasks')
    .select('id,title,task_type,status,weight,acceptance_criteria,roadmap_month_id')
    .eq('user_id', userId)
    .eq('roadmap_month_id', currentMonth.id)
    .neq('status', 'skipped')
    .order('created_at');
  const tasks = ensureDbResult(tasksResult, '读取当前阶段任务失败') || [];
  response(res, tasks.map((task) => ({
    ...task,
    month_number: currentMonth.month_number,
    month_title: currentMonth.title,
  })));
}));

router.post('/roadmaps/initialize', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const startDate = req.body.startDate || todayInTimeZone();
  assertDateKey(startDate, 'startDate');
  const existing = await db.from('growth_roadmaps').select('id').eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (existing.error) throw apiError(500, 'DATABASE_ERROR', '检查路线失败');
  if (existing.data) throw apiError(409, 'ACTIVE_ROADMAP_EXISTS', '已经存在一条进行中的成长路线');

  const roadmapResult = await db.from('growth_roadmaps').insert([{
    user_id: userId,
    title: req.body.title?.trim() || '前端工程师 12 个月成长路线',
    description: '以知识、练习、项目和复盘形成可验证的成长闭环。',
    start_date: startDate,
    status: 'active',
    template_version: 2,
  }]).select().single();
  const roadmap = ensureDbResult(roadmapResult, '创建路线失败');

  try {
    const monthsPayload = seedMonths.map((month, index) => {
      const startsOn = addMonths(startDate, index);
      return {
        user_id: userId,
        roadmap_id: roadmap.id,
        month_number: index + 1,
        title: month.title,
        goal: `掌握 ${month.title} 的核心能力，并形成可展示证据。`,
        core_learning: month.coreLearning,
        deliverable: month.deliverable,
        starts_on: startsOn,
        ends_on: shiftDate(addMonths(startDate, index + 1), -1),
        sort_order: index + 1,
      };
    });
    const monthsResult = await db.from('growth_roadmap_months').insert(monthsPayload).select();
    const months = ensureDbResult(monthsResult, '创建路线月份失败');
    const taskPayload = months.flatMap((month, index) => buildStageTaskTemplates(seedMonths[index])
      .map((template) => ({
        ...template,
        user_id: userId,
        roadmap_month_id: month.id,
        due_date: month.ends_on,
      })));
    const tasksResult = await db.from('growth_roadmap_tasks').insert(taskPayload).select();
    ensureDbResult(tasksResult, '创建路线任务失败');
    response(res, { ...roadmap, months: months.length, tasks: taskPayload.length }, undefined, 201);
  } catch (error) {
    await db.from('growth_roadmaps').delete().eq('id', roadmap.id).eq('user_id', userId);
    throw error;
  }
}));

router.post('/roadmaps/:id/sync-template', route(async (req, res) => {
  response(res, await syncRoadmapTemplate(getDb(req), req.user.userId, req.params.id));
}));

router.get('/roadmaps/:id', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const targetDate = req.query.date || todayInTimeZone();
  assertDateKey(targetDate, 'date');
  const roadmapResult = await db.from('growth_roadmaps').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
  if (roadmapResult.error) throw apiError(500, 'DATABASE_ERROR', '读取路线失败');
  if (!roadmapResult.data) throw apiError(404, 'NOT_FOUND', '路线不存在');
  const monthsResult = await db.from('growth_roadmap_months').select('*').eq('roadmap_id', req.params.id).eq('user_id', userId).order('sort_order');
  const months = ensureDbResult(monthsResult) || [];
  const monthIds = months.map((item) => item.id);
  let tasks = [];
  if (monthIds.length) {
    const tasksResult = await db.from('growth_roadmap_tasks').select('*').eq('user_id', userId).in('roadmap_month_id', monthIds).order('due_date');
    tasks = ensureDbResult(tasksResult) || [];
  }
  const masteryAssessments = await evaluateMasteryForTasks(db, userId, tasks);
  tasks = attachMastery(tasks, masteryAssessments);
  const firstMonth = months[0] || null;
  const lastMonth = months.at(-1) || null;
  response(res, {
    ...roadmapResult.data,
    progress_metrics: firstMonth && lastMonth
      ? createStageProgress({ starts_on: firstMonth.starts_on, ends_on: lastMonth.ends_on }, tasks, targetDate, masteryAssessments)
      : null,
    months: months.map((month) => {
      const monthTasks = tasks.filter((task) => task.roadmap_month_id === month.id);
      return {
        ...month,
        tasks: monthTasks,
        progress_metrics: createStageProgress(
          month,
          monthTasks,
          targetDate,
          masteryAssessments.filter((item) => monthTasks.some((task) => task.id === item.roadmap_task_id)),
        ),
      };
    }),
  });
}));

router.patch('/roadmap-tasks/:id', route(async (req, res) => {
  const db = getDb(req);
  const allowed = ['title', 'description', 'task_type', 'status', 'weight', 'planned_minutes', 'due_date'];
  const updates = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
  if (!Object.keys(updates).length) throw apiError(400, 'VALIDATION_ERROR', '没有可更新的任务字段');
  if (updates.status) {
    const statuses = ['todo', 'doing', 'done', 'skipped'];
    if (!statuses.includes(updates.status)) throw apiError(400, 'VALIDATION_ERROR', '任务状态无效');
    updates.completed_at = updates.status === 'done' ? new Date().toISOString() : null;
  }
  const result = await db.from('growth_roadmap_tasks').update(updates).eq('id', req.params.id).eq('user_id', req.user.userId).select().maybeSingle();
  if (result.error) throw apiError(500, 'DATABASE_ERROR', '更新任务失败');
  if (!result.data) throw apiError(404, 'NOT_FOUND', '任务不存在');
  response(res, result.data);
}));

router.get('/mastery', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const roadmapResult = await db.from('growth_roadmaps')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (roadmapResult.error) throw apiError(500, 'DATABASE_ERROR', '读取当前路线失败');
  if (!roadmapResult.data) return response(res, []);
  const monthsResult = await db.from('growth_roadmap_months')
    .select('id,month_number,title,starts_on,ends_on')
    .eq('user_id', userId)
    .eq('roadmap_id', roadmapResult.data.id)
    .order('sort_order');
  const months = ensureDbResult(monthsResult, '读取路线阶段失败') || [];
  const monthIds = months.map((item) => item.id);
  if (!monthIds.length) return response(res, []);
  const tasksResult = await db.from('growth_roadmap_tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('task_type', 'knowledge')
    .in('roadmap_month_id', monthIds)
    .neq('status', 'skipped')
    .order('due_date');
  const tasks = ensureDbResult(tasksResult, '读取知识任务失败') || [];
  const assessments = await evaluateMasteryForTasks(db, userId, tasks);
  const monthById = new Map(months.map((item) => [item.id, item]));
  response(res, attachMastery(tasks, assessments).map((task) => ({
    ...task,
    month: monthById.get(task.roadmap_month_id) || null,
  })));
}));

router.get('/knowledge', route(async (req, res) => {
  const db = getDb(req);
  const { page, pageSize, from, to } = pagination(req.query);
  let query = db.from('growth_knowledge_items').select('*', { count: 'exact' }).eq('user_id', req.user.userId).is('archived_at', null);
  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.q) query = query.ilike('title', `%${req.query.q.trim()}%`);
  const result = await query.order('updated_at', { ascending: false }).range(from, to);
  const data = ensureDbResult(result, '读取知识库失败') || [];
  response(res, data, { page, pageSize, total: result.count || 0 });
}));

router.post('/knowledge', route(async (req, res) => {
  const db = getDb(req);
  const roadmapTaskId = await resolveRoadmapTaskLink(db, req.user.userId, req.body);
  const payload = {
    user_id: req.user.userId,
    roadmap_task_id: roadmapTaskId,
    title: requiredText(req.body.title, '知识标题'),
    status: req.body.status || 'learning',
    what_text: req.body.what_text || '',
    why_text: req.body.why_text || '',
    how_text: req.body.how_text || '',
    when_text: req.body.when_text || '',
    when_not_text: req.body.when_not_text || '',
    examples: req.body.examples || '',
    my_summary: req.body.my_summary || '',
    last_studied_at: new Date().toISOString(),
  };
  const result = await db.from('growth_knowledge_items').insert([payload]).select().single();
  response(res, ensureDbResult(result, '创建知识条目失败'), undefined, 201);
}));

router.patch('/knowledge/:id', route(async (req, res) => {
  const db = getDb(req);
  const allowed = ['title', 'status', 'what_text', 'why_text', 'how_text', 'when_text', 'when_not_text', 'examples', 'my_summary'];
  const updates = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
  const roadmapTaskId = await resolveRoadmapTaskLink(db, req.user.userId, req.body, false);
  if (roadmapTaskId !== undefined) updates.roadmap_task_id = roadmapTaskId;
  updates.last_studied_at = new Date().toISOString();
  const result = await db.from('growth_knowledge_items').update(updates).eq('id', req.params.id).eq('user_id', req.user.userId).select().maybeSingle();
  if (result.error) throw apiError(500, 'DATABASE_ERROR', '更新知识条目失败');
  if (!result.data) throw apiError(404, 'NOT_FOUND', '知识条目不存在');
  response(res, result.data);
}));

router.delete('/knowledge/:id', route(async (req, res) => {
  const result = await getDb(req).from('growth_knowledge_items').update({ archived_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.user.userId).select('id').maybeSingle();
  if (result.error) throw apiError(500, 'DATABASE_ERROR', '归档知识条目失败');
  if (!result.data) throw apiError(404, 'NOT_FOUND', '知识条目不存在');
  response(res, { id: result.data.id, archived: true });
}));

router.get('/learning-logs', route(async (req, res) => {
  const db = getDb(req);
  const { page, pageSize, from, to } = pagination(req.query);
  let query = db.from('growth_learning_logs').select('*', { count: 'exact' }).eq('user_id', req.user.userId);
  if (req.query.from) query = query.gte('log_date', req.query.from);
  if (req.query.to) query = query.lte('log_date', req.query.to);
  const result = await query.order('log_date', { ascending: false }).range(from, to);
  response(res, ensureDbResult(result, '读取学习日志失败') || [], { page, pageSize, total: result.count || 0 });
}));

router.post('/learning-logs', route(async (req, res) => {
  const db = getDb(req);
  assertDateKey(req.body.log_date, 'log_date');
  const duration = Number(req.body.duration_minutes);
  if (!Number.isFinite(duration) || duration < 0) throw apiError(400, 'VALIDATION_ERROR', '学习时长不能小于 0');
  const payload = {
    user_id: req.user.userId,
    roadmap_task_id: await resolveRoadmapTaskLink(db, req.user.userId, req.body),
    log_date: req.body.log_date,
    duration_minutes: Math.round(duration),
    topic: requiredText(req.body.topic, '学习主题'),
    learned: req.body.learned || '',
    problem: req.body.problem || '',
    solution: req.body.solution || '',
    tomorrow_plan: req.body.tomorrow_plan || '',
  };
  const result = await db.from('growth_learning_logs').insert([payload]).select().single();
  response(res, ensureDbResult(result, '创建学习日志失败'), undefined, 201);
}));

router.patch('/learning-logs/:id', route(async (req, res) => {
  const db = getDb(req);
  const allowed = ['log_date', 'duration_minutes', 'topic', 'learned', 'problem', 'solution', 'tomorrow_plan'];
  const updates = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
  const roadmapTaskId = await resolveRoadmapTaskLink(db, req.user.userId, req.body, false);
  if (roadmapTaskId !== undefined) updates.roadmap_task_id = roadmapTaskId;
  const result = await db.from('growth_learning_logs').update(updates).eq('id', req.params.id).eq('user_id', req.user.userId).select().maybeSingle();
  if (result.error) throw apiError(500, 'DATABASE_ERROR', '更新学习日志失败');
  if (!result.data) throw apiError(404, 'NOT_FOUND', '学习日志不存在');
  response(res, result.data);
}));

router.delete('/learning-logs/:id', route(async (req, res) => {
  const result = await getDb(req).from('growth_learning_logs').delete().eq('id', req.params.id).eq('user_id', req.user.userId).select('id').maybeSingle();
  if (result.error) throw apiError(500, 'DATABASE_ERROR', '删除学习日志失败');
  if (!result.data) throw apiError(404, 'NOT_FOUND', '学习日志不存在');
  response(res, { id: result.data.id, deleted: true });
}));

router.get('/practices', route(async (req, res) => {
  const { page, pageSize, from, to } = pagination(req.query);
  let query = getDb(req).from('growth_practices')
    .select('id,user_id,knowledge_item_id,roadmap_task_id,question_id,title,practice_type,difficulty,prompt,source,status,created_at,updated_at', { count: 'exact' })
    .eq('user_id', req.user.userId)
    .neq('status', 'archived');
  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.difficulty) query = query.eq('difficulty', req.query.difficulty);
  if (req.query.source) query = query.eq('source', req.query.source);
  const result = await query.order('updated_at', { ascending: false }).range(from, to);
  response(res, ensureDbResult(result, '读取练习失败') || [], { page, pageSize, total: result.count || 0 });
}));

router.post('/practices', route(async (req, res) => {
  const db = getDb(req);
  const sources = ['external', 'user_created'];
  const source = req.body.source || 'user_created';
  if (!sources.includes(source)) throw apiError(400, 'VALIDATION_ERROR', '手动创建练习只能选择外部导入或用户自建来源');
  const payload = {
    user_id: req.user.userId,
    roadmap_task_id: await resolveRoadmapTaskLink(db, req.user.userId, req.body),
    title: requiredText(req.body.title, '练习标题'),
    prompt: requiredText(req.body.prompt, '练习题目'),
    practice_type: req.body.practice_type || 'concept',
    difficulty: req.body.difficulty || 'medium',
    source,
    reference_answer: req.body.reference_answer || null,
    scoring_rubric: req.body.scoring_rubric || null,
    knowledge_item_id: req.body.knowledge_item_id || null,
  };
  const result = await db.from('growth_practices').insert([payload]).select('id,roadmap_task_id,title,practice_type,difficulty,prompt,source,status,created_at').single();
  response(res, ensureDbResult(result, '创建练习失败'), undefined, 201);
}));

router.post('/practices/from-question-bank', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const taskId = await resolveRoadmapTaskLink(db, userId, req.body);
  if (!taskId) throw apiError(400, 'VALIDATION_ERROR', '题库练习必须关联具体路线任务');
  const task = await loadRoadmapTask(db, userId, taskId);
  const difficulty = ['easy', 'medium', 'hard'].includes(req.body.difficulty) ? req.body.difficulty : 'medium';
  const questionType = req.body.question_type === 'coding' ? 'coding' : 'theory';

  const [questionsResult, usedResult] = await Promise.all([
    db.from('questions')
      .select('id,title,content,type,difficulty,topic,reference_answer,scoring_rubric,source')
      .eq('difficulty', difficulty)
      .eq('type', questionType)
      .order('created_at', { ascending: false })
      .limit(300),
    db.from('growth_practices')
      .select('question_id')
      .eq('user_id', userId)
      .not('question_id', 'is', null),
  ]);
  const questions = ensureDbResult(questionsResult, '读取现有题库失败') || [];
  const usedIds = new Set((ensureDbResult(usedResult, '读取练习历史失败') || []).map((item) => item.question_id));
  const candidates = questions.filter((item) => !usedIds.has(item.id));
  if (!candidates.length) {
    throw apiError(409, 'NO_UNSEEN_QUESTION', '当前筛选条件下没有未做过的题目，请更换难度或使用 AI 生成');
  }

  const terms = task.title.toLowerCase().split(/[\s、，：:；;「」+()（）/]+/).filter((item) => item.length > 1);
  const ranked = candidates.map((question) => {
    const text = `${question.topic || ''} ${question.title} ${question.content}`.toLowerCase();
    return { question, score: terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0) };
  }).sort((left, right) => right.score - left.score);
  const bestScore = ranked[0].score;
  const best = ranked.filter((item) => item.score === bestScore);
  const selected = best[Math.floor(Math.random() * best.length)].question;
  const source = ['system', 'ai_generated', 'external'].includes(selected.source) ? selected.source : 'system';
  response(res, await createGrowthPracticeFromQuestion(db, userId, task, selected, source), undefined, 201);
}));

router.post('/practices/generate', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const taskId = await resolveRoadmapTaskLink(db, userId, req.body);
  if (!taskId) throw apiError(400, 'VALIDATION_ERROR', 'AI 练习必须关联具体路线任务');
  const task = await loadRoadmapTask(db, userId, taskId);
  const generated = await generateGrowthPractice({
    topic: task.title,
    acceptanceCriteria: task.acceptance_criteria,
    difficulty: req.body.difficulty,
    practiceType: req.body.practice_type,
  });

  const questionResult = await db.from('questions').insert([{
    title: generated.title,
    content: generated.content,
    type: questionTypeForPractice(generated.practice_type),
    difficulty: generated.difficulty,
    code_template: '',
    topic: task.title,
    reference_answer: generated.reference_answer,
    scoring_rubric: generated.scoring_rubric,
    source: 'ai_generated',
  }]).select('id,title,content,type,difficulty,topic,reference_answer,scoring_rubric,source').single();
  const question = ensureDbResult(questionResult, '保存 AI 题目到题库失败');
  const practiceResult = await db.from('growth_practices').insert([{
    user_id: userId,
    roadmap_task_id: task.id,
    question_id: question.id,
    title: generated.title,
    prompt: generated.content,
    practice_type: generated.practice_type,
    difficulty: generated.difficulty,
    source: 'ai_generated',
    reference_answer: generated.reference_answer,
    scoring_rubric: generated.scoring_rubric,
  }]).select('id,question_id,roadmap_task_id,title,practice_type,difficulty,prompt,source,status,created_at').single();
  response(res, ensureDbResult(practiceResult, '创建 AI 练习失败'), undefined, 201);
}));

router.get('/practices/:id', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const practiceResult = await db.from('growth_practices')
    .select('id,knowledge_item_id,roadmap_task_id,question_id,title,practice_type,difficulty,prompt,source,status,created_at,updated_at')
    .eq('id', req.params.id).eq('user_id', userId).maybeSingle();
  if (practiceResult.error) throw apiError(500, 'DATABASE_ERROR', '读取练习失败');
  if (!practiceResult.data) throw apiError(404, 'NOT_FOUND', '练习不存在');
  const attemptsResult = await db.from('growth_practice_attempts').select('*').eq('practice_id', req.params.id).eq('user_id', userId).order('submitted_at', { ascending: false });
  const attempts = ensureDbResult(attemptsResult) || [];
  let referenceAnswer = null;
  let scoringRubric = null;
  if (attempts.length) {
    const answerResult = await db.from('growth_practices').select('reference_answer,scoring_rubric').eq('id', req.params.id).eq('user_id', userId).single();
    referenceAnswer = ensureDbResult(answerResult)?.reference_answer || null;
    scoringRubric = answerResult.data?.scoring_rubric || null;
  }
  response(res, { ...practiceResult.data, attempts, reference_answer: referenceAnswer, scoring_rubric: scoringRubric });
}));

router.post('/practices/:id/attempts', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const practice = await db.from('growth_practices')
    .select('id,question_id,roadmap_task_id,title,prompt,source,reference_answer,scoring_rubric')
    .eq('id', req.params.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (practice.error) throw apiError(500, 'DATABASE_ERROR', '检查练习失败');
  if (!practice.data) throw apiError(404, 'NOT_FOUND', '练习不存在');
  const answer = requiredText(req.body.answer, '作答内容');
  const selfAssessment = req.body.self_assessment || ({ passed: 'mastered', partial: 'partial', failed: 'not_mastered' })[req.body.result];
  if (!['mastered', 'partial', 'not_mastered'].includes(selfAssessment)) {
    throw apiError(400, 'VALIDATION_ERROR', '请选择用户自评结果');
  }
  let referenceAnswer = practice.data.reference_answer;
  let scoringRubric = practice.data.scoring_rubric;
  if (!referenceAnswer || !scoringRubric) {
    const task = practice.data.roadmap_task_id
      ? await loadRoadmapTask(db, userId, practice.data.roadmap_task_id)
      : null;
    const guide = await createQuestionEvaluationGuide({
      title: practice.data.title,
      content: practice.data.prompt,
      topic: task?.title || '',
    });
    referenceAnswer = guide.reference_answer;
    scoringRubric = guide.scoring_rubric;
    ensureDbResult(await db.from('growth_practices').update(guide).eq('id', practice.data.id).eq('user_id', userId), '保存评分标准失败');
    if (practice.data.question_id) {
      ensureDbResult(await db.from('questions').update(guide).eq('id', practice.data.question_id), '同步题库评分标准失败');
    }
  }
  const task = practice.data.roadmap_task_id
    ? await loadRoadmapTask(db, userId, practice.data.roadmap_task_id)
    : null;
  const grade = await gradeGrowthPractice({
    topic: task?.title || '',
    title: practice.data.title,
    content: practice.data.prompt,
    referenceAnswer,
    scoringRubric,
    userAnswer: answer,
  });
  const resultValue = resultForScore(grade.score);
  const attemptResult = await db.from('growth_practice_attempts').insert([{
    user_id: userId,
    practice_id: req.params.id,
    answer,
    result: resultValue,
    self_assessment: selfAssessment,
    self_reflection: req.body.self_reflection || '',
    system_score: grade.score,
    system_feedback: grade.feedback,
    evaluator: 'deepseek',
    graded_at: new Date().toISOString(),
  }]).select().single();
  ensureDbResult(attemptResult, '提交练习失败');
  ensureDbResult(await db.from('growth_practices').update({ status: 'done' }).eq('id', req.params.id).eq('user_id', userId), '更新练习状态失败');
  response(res, { attempt: attemptResult.data, reference_answer: referenceAnswer, scoring_rubric: scoringRubric }, undefined, 201);
}));

router.get('/projects', route(async (req, res) => {
  let query = getDb(req).from('growth_projects').select('*').eq('user_id', req.user.userId).is('archived_at', null);
  if (req.query.status) query = query.eq('status', req.query.status);
  const result = await query.order('updated_at', { ascending: false });
  response(res, ensureDbResult(result, '读取项目失败') || []);
}));

router.post('/projects', route(async (req, res) => {
  const db = getDb(req);
  const techStack = Array.isArray(req.body.tech_stack)
    ? req.body.tech_stack.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
  const result = await db.from('growth_projects').insert([{
    user_id: req.user.userId,
    roadmap_task_id: await resolveRoadmapTaskLink(db, req.user.userId, req.body),
    title: requiredText(req.body.title, '项目名称'),
    description: req.body.description || '',
    status: req.body.status || 'planned',
    tech_stack: techStack,
    repository_url: req.body.repository_url || null,
    demo_url: req.body.demo_url || null,
    lessons: req.body.lessons || '',
    started_on: req.body.started_on || null,
  }]).select().single();
  response(res, ensureDbResult(result, '创建项目失败'), undefined, 201);
}));

router.patch('/projects/:id', route(async (req, res) => {
  const db = getDb(req);
  const allowed = ['title', 'description', 'status', 'tech_stack', 'repository_url', 'demo_url', 'lessons', 'started_on', 'completed_on'];
  const updates = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
  const roadmapTaskId = await resolveRoadmapTaskLink(db, req.user.userId, req.body, false);
  if (roadmapTaskId !== undefined) updates.roadmap_task_id = roadmapTaskId;
  const result = await db.from('growth_projects').update(updates).eq('id', req.params.id).eq('user_id', req.user.userId).select().maybeSingle();
  if (result.error) throw apiError(500, 'DATABASE_ERROR', '更新项目失败');
  if (!result.data) throw apiError(404, 'NOT_FOUND', '项目不存在');
  response(res, result.data);
}));

router.delete('/projects/:id', route(async (req, res) => {
  const result = await getDb(req).from('growth_projects').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.user.userId).select('id').maybeSingle();
  if (result.error) throw apiError(500, 'DATABASE_ERROR', '归档项目失败');
  if (!result.data) throw apiError(404, 'NOT_FOUND', '项目不存在');
  response(res, { id: result.data.id, archived: true });
}));

router.post('/projects/:id/milestones', route(async (req, res) => {
  const db = getDb(req);
  const project = await db.from('growth_projects').select('id').eq('id', req.params.id).eq('user_id', req.user.userId).maybeSingle();
  if (project.error) throw apiError(500, 'DATABASE_ERROR', '检查项目失败');
  if (!project.data) throw apiError(404, 'NOT_FOUND', '项目不存在');
  const result = await db.from('growth_project_milestones').insert([{
    user_id: req.user.userId,
    project_id: req.params.id,
    title: requiredText(req.body.title, '里程碑名称'),
    due_date: req.body.due_date || null,
  }]).select().single();
  response(res, ensureDbResult(result, '创建里程碑失败'), undefined, 201);
}));

router.patch('/project-milestones/:id', route(async (req, res) => {
  const allowed = ['title', 'status', 'due_date', 'sort_order'];
  const updates = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
  if (updates.status) updates.completed_at = updates.status === 'done' ? new Date().toISOString() : null;
  const result = await getDb(req).from('growth_project_milestones').update(updates).eq('id', req.params.id).eq('user_id', req.user.userId).select().maybeSingle();
  if (result.error) throw apiError(500, 'DATABASE_ERROR', '更新里程碑失败');
  if (!result.data) throw apiError(404, 'NOT_FOUND', '里程碑不存在');
  response(res, result.data);
}));

router.get('/projects/:id', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const projectResult = await db.from('growth_projects').select('*').eq('id', req.params.id).eq('user_id', userId).maybeSingle();
  if (projectResult.error) throw apiError(500, 'DATABASE_ERROR', '读取项目失败');
  if (!projectResult.data) throw apiError(404, 'NOT_FOUND', '项目不存在');
  const milestonesResult = await db.from('growth_project_milestones').select('*').eq('project_id', req.params.id).eq('user_id', userId).order('sort_order');
  response(res, { ...projectResult.data, milestones: ensureDbResult(milestonesResult) || [] });
}));

router.get('/reviews', route(async (req, res) => {
  let query = getDb(req).from('growth_reviews').select('*').eq('user_id', req.user.userId);
  if (req.query.type) query = query.eq('review_type', req.query.type);
  const result = await query.order('period_start', { ascending: false });
  response(res, ensureDbResult(result, '读取复盘失败') || []);
}));

router.get('/reviews/preview', route(async (req, res) => {
  const from = req.query.periodStart;
  const to = req.query.periodEnd;
  const type = req.query.reviewType || 'weekly';
  if (!['weekly', 'monthly'].includes(type)) throw apiError(400, 'VALIDATION_ERROR', '复盘类型无效');
  response(res, await buildReviewPreview(getDb(req), req.user.userId, from, to, type, true));
}));

router.post('/reviews', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const from = req.body.period_start;
  const to = req.body.period_end;
  const type = req.body.review_type;
  if (!['weekly', 'monthly'].includes(type)) throw apiError(400, 'VALIDATION_ERROR', '复盘类型无效');
  const snapshot = await buildReviewPreview(db, userId, from, to, type, false);
  const autoFill = snapshot.autoFill;
  const result = await db.from('growth_reviews').insert([{
    user_id: userId,
    review_type: type,
    period_start: from,
    period_end: to,
    planned: req.body.planned || autoFill.planned,
    completed: req.body.completed || autoFill.completed,
    problems: req.body.problems || autoFill.problems,
    wins: req.body.wins || autoFill.wins,
    next_plan: req.body.next_plan || autoFill.next_plan,
    metrics_snapshot: snapshot,
  }]).select().single();
  const review = ensureDbResult(result, '创建复盘失败');
  if (snapshot.weakTaskIds.length) {
    const adjustmentResult = await db.from('growth_roadmap_tasks')
      .update({
        recommendation_priority: 100,
        adjustment_reason: `复盘 ${from} 至 ${to}：存在低于 7 分的客观练习`,
      })
      .eq('user_id', userId)
      .in('id', snapshot.weakTaskIds);
    ensureDbResult(adjustmentResult, '更新路线推荐顺序失败');
  }
  response(res, { ...review, adjustedTaskCount: snapshot.weakTaskIds.length }, undefined, 201);
}));

router.get('/statistics/overview', route(async (req, res) => {
  const db = getDb(req);
  const userId = req.user.userId;
  const today = req.query.date || todayInTimeZone();
  assertDateKey(today, 'date');
  const scope = req.query.scope || 'custom';
  if (!['custom', 'calendar_month', 'stage'].includes(scope)) {
    throw apiError(400, 'VALIDATION_ERROR', 'scope 必须是 custom、calendar_month 或 stage');
  }

  let from = req.query.from || shiftDate(today, -29);
  let to = req.query.to || today;
  let observedTo = to;
  let scopeLabel = '自定义范围';
  let statisticsOptions = {};

  if (scope === 'calendar_month') {
    from = startOfMonth(today);
    to = endOfMonth(today);
    observedTo = today;
    scopeLabel = `${today.slice(0, 4)} 年 ${Number(today.slice(5, 7))} 月`;
    statisticsOptions = { activityTo: observedTo, periodTo: to };
  }

  if (scope === 'stage') {
    const roadmapResult = await db.from('growth_roadmaps')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (roadmapResult.error) throw apiError(500, 'DATABASE_ERROR', '读取当前路线失败');
    if (!roadmapResult.data) throw apiError(404, 'ACTIVE_STAGE_NOT_FOUND', '尚未启用成长路线');

    const monthsResult = await db.from('growth_roadmap_months')
      .select('id,month_number,starts_on,ends_on')
      .eq('user_id', userId)
      .eq('roadmap_id', roadmapResult.data.id)
      .order('sort_order');
    const months = ensureDbResult(monthsResult, '读取当前路线阶段失败') || [];
    const stage = months.find((item) => item.starts_on <= today && item.ends_on >= today)
      || months.find((item) => item.starts_on > today)
      || months.at(-1);
    if (!stage) throw apiError(404, 'ACTIVE_STAGE_NOT_FOUND', '当前路线没有可统计的阶段');

    from = stage.starts_on;
    to = stage.ends_on;
    observedTo = today < from ? from : (today > to ? to : today);
    scopeLabel = `当前路线阶段 M${String(stage.month_number).padStart(2, '0')}`;
    statisticsOptions = { activityTo: observedTo, periodTo: to, roadmapMonthId: stage.id };
  }

  const stats = await loadStatistics(db, userId, from, to, statisticsOptions);
  const logsResult = await db.from('growth_learning_logs')
    .select('log_date,duration_minutes')
    .eq('user_id', userId)
    .gte('log_date', from)
    .lte('log_date', observedTo)
    .order('log_date');
  const logs = ensureDbResult(logsResult) || [];
  const byDate = new Map();
  for (const log of logs) byDate.set(log.log_date, (byDate.get(log.log_date) || 0) + Number(log.duration_minutes || 0));
  response(res, {
    ...stats,
    scope,
    scopeLabel,
    period: { from, to, observedTo },
    learningTrend: [...byDate.entries()].map(([date, minutes]) => ({ date, minutes })),
  });
}));

module.exports = router;
