const express = require('express');
const { authenticate } = require('../../middleware/auth');
const {
  monthRangeBySalary,
  yearRange,
  last7DayLabels,
  normalizeSalaryDay,
  resolveLedgerScope,
  applyLedgerScope,
  currentSalaryPeriod,
  formatDateISO,
  matchesFlowType,
  matchesCategoryType,
  isFlowExpense,
} = require('../../utils/jizhangHelpers');
const router = express.Router();

router.use(authenticate);

/**
 * 【功能描述】
 * 加载用户记账设置。
 *
 * 【业务逻辑】
 * 1. 读取发薪日、monthly_budget_total 等统计依赖配置。
 *
 * 【技术实现】
 * - 涉及方法：loadSettings
 * - 涉及知识点：jz_user_settings maybeSingle
 */
async function loadSettings(supabase, userId) {
  const { data } = await supabase
    .from('jz_user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

/**
 * 【功能描述】
 * 按 type 对流水列表求金额合计。
 *
 * 【业务逻辑】
 * 1. 严格 type 匹配后累加 amount。
 *
 * 【技术实现】
 * - 涉及方法：sumByType
 * - 涉及知识点：filter + reduce
 */
function sumByType(list, type) {
  return list.filter((t) => t.type === type).reduce((s, t) => s + Number(t.amount), 0);
}

/**
 * 【功能描述】
 * 返回今日 ISO 日期字符串。
 *
 * 【业务逻辑】
 * 1. 用于截断统计区间不超过当前日。
 *
 * 【技术实现】
 * - 涉及方法：todayStr
 * - 涉及知识点：toISOString
 */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

/**
 * 【功能描述】
 * 过滤出计入收支结余的流水（仅 income/expense，不含 transfer）。
 *
 * 【业务逻辑】
 * 1. 还款 transfer 不计入 flow 统计，避免与信用消费重复。
 *
 * 【技术实现】
 * - 涉及方法：flowOnly
 * - 涉及知识点：type 口径 filter
 */
function flowOnly(list) {
  return (list || []).filter((t) => t.type === 'income' || t.type === 'expense');
}

/**
 * 【功能描述】
 * 按 flow 口径汇总支出金额。
 *
 * 【业务逻辑】
 * 1. 仅 isFlowExpense（expense）计入。
 *
 * 【技术实现】
 * - 涉及方法：sumExpense
 * - 涉及知识点：isFlowExpense
 */
function sumExpense(list) {
  return (list || [])
    .filter((t) => isFlowExpense(t.type))
    .reduce((s, t) => s + Number(t.amount), 0);
}

/**
 * 【功能描述】
 * 按分类聚合流水金额并计算占比。
 *
 * 【业务逻辑】
 * 1. 用 matchesCategoryType 过滤（支出类可含 transfer）。
 * 2. 按 category_id/name 分组，补全 icon/color，计算 percent。
 *
 * 【技术实现】
 * - 涉及方法：buildCategoryStats
 * - 涉及知识点：Map 分组、matchesCategoryType
 */
function buildCategoryStats(list, type, categoryMap = new Map()) {
  const filtered = list.filter((t) => matchesCategoryType(t.type, type));
  const total = filtered.reduce((s, t) => s + Number(t.amount), 0);
  const map = new Map();

  filtered.forEach((t) => {
    const key = t.category_id || t.category_name || (t.type === 'transfer' ? '转账还款' : '未分类');
    const existing = map.get(key);
    const catMeta = categoryMap.get(t.category_id);
    if (existing) {
      existing.amount += Number(t.amount);
    } else {
      map.set(key, {
        categoryId: t.category_id || '',
        categoryName: t.category_name || (t.type === 'transfer' ? '转账还款' : '未分类'),
        icon: catMeta?.icon || t.icon || (t.type === 'transfer' ? '🔁' : '📦'),
        color: catMeta?.color || (t.type === 'transfer' ? '#3B82F6' : '#9CA3AF'),
        amount: Number(t.amount),
        percent: 0,
      });
    }
  });

  const stats = Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  stats.forEach((s) => {
    s.percent = total > 0 ? Math.round((s.amount / total) * 100) : 0;
  });

  return { total, stats };
}

/**
 * 【功能描述】
 * 加载分类 id → { icon, color } 映射。
 *
 * 【业务逻辑】
 * 1. 含系统分类与用户自定义分类。
 *
 * 【技术实现】
 * - 涉及方法：loadCategoryMap
 * - 涉及知识点：or user_id 过滤、Map 构建
 */
async function loadCategoryMap(supabase, userId) {
  const { data } = await supabase
    .from('jz_categories')
    .select('id, icon, color')
    .or(`user_id.is.null,user_id.eq.${userId}`);
  const map = new Map();
  (data || []).forEach((c) => map.set(c.id, c));
  return map;
}

/**
 * 【功能描述】
 * 构建发薪月内每日标签与 ISO 日期数组。
 *
 * 【业务逻辑】
 * 1. 从 start 到 end 逐日递增，label 为日号字符串。
 *
 * 【技术实现】
 * - 涉及方法：buildMonthDayLabels
 * - 涉及知识点：Date 循环、formatDateISO
 */
function buildMonthDayLabels(start, end) {
  const labels = [];
  const dates = [];
  const cur = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cur <= last) {
    const iso = formatDateISO(cur);
    dates.push(iso);
    labels.push(String(cur.getDate()));
    cur.setDate(cur.getDate() + 1);
  }
  return { labels, dates };
}

/**
 * 【功能描述】
 * 构建自然年 12 个月的标签与 { year, month } 范围键。
 *
 * 【业务逻辑】
 * 1. 供 period=year 的 last7days 接口按月聚合。
 *
 * 【技术实现】
 * - 涉及方法：buildYearMonthLabels
 * - 涉及知识点：for 循环 1–12
 */
function buildYearMonthLabels(year) {
  const y = parseInt(year, 10);
  const labels = [];
  const ranges = [];
  for (let m = 1; m <= 12; m++) {
    labels.push(`${m}月`);
    ranges.push({ year: y, month: m });
  }
  return { labels, ranges };
}

/**
 * 【功能描述】
 * GET /overview — 指定年月的收支概览与预算剩余。
 *
 * 【业务逻辑】
 * 1. year、month 必填；按发薪日切分周期。
 * 2. 仅统计 income/expense flow；返回 totalBudget、remainingBudget。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/overview')
 * - 涉及知识点：monthRangeBySalary、flowOnly、applyLedgerScope
 */
router.get('/overview', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { year, month } = req.query;
  const ledgerIds = await resolveLedgerScope(supabase, req.user.userId, req.query.ledger_id);

  if (!year || !month) {
    return res.status(400).json({ code: 400, message: 'year 和 month 为必填' });
  }

  const settings = await loadSettings(supabase, req.user.userId);
  const salaryDay = normalizeSalaryDay(settings?.salary_day);
  const { start, end } = monthRangeBySalary(year, month, salaryDay);

  let query = supabase
    .from('jz_transactions')
    .select('amount, type')
    .eq('user_id', req.user.userId)
    .gte('date', start)
    .lte('date', end);
  query = applyLedgerScope(query, ledgerIds);

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }

  const list = flowOnly(data);
  const totalIncome = sumByType(list, 'income');
  const totalExpense = sumExpense(list);
  const totalBudget = Number(settings?.monthly_budget_total || 3500);

  return res.json({
    code: 200,
    message: '获取成功',
    data: {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      totalBudget,
      remainingBudget: totalBudget - totalExpense,
      periodStart: start,
      periodEnd: end,
      salaryDay,
      scope: ledgerIds ? 'ledger' : 'account',
    },
  });
});

/**
 * 【功能描述】
 * GET /last7days — 近 7 日/本月/本年按日或按月金额序列。
 *
 * 【业务逻辑】
 * 1. query type 默认 expense；period 支持 day/month/year。
 * 2. 返回 list、total、average 及发薪日、账本 scope。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/last7days')
 * - 涉及知识点：last7DayLabels、currentSalaryPeriod、matchesFlowType
 */
router.get('/last7days', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { type = 'expense', period = 'day' } = req.query;
  const ledgerIds = await resolveLedgerScope(supabase, req.user.userId, req.query.ledger_id);
  const settings = await loadSettings(supabase, req.user.userId);
  const salaryDay = normalizeSalaryDay(settings?.salary_day);

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const today = todayStr();

  let labels = [];
  let dates = [];
  let monthKeys = null;
  let divisor = 7;
  let rangeStart;
  let rangeEnd;

  if (period === 'year') {
    const built = buildYearMonthLabels(y);
    labels = built.labels;
    monthKeys = built.ranges;
    divisor = m;
    ({ start: rangeStart, end: rangeEnd } = yearRange(y));
    if (rangeEnd > today) rangeEnd = today;
  } else if (period === 'month') {
    const { start, end } = currentSalaryPeriod(now, salaryDay);
    rangeStart = start;
    rangeEnd = end > today ? today : end;
    const built = buildMonthDayLabels(rangeStart, rangeEnd);
    labels = built.labels;
    dates = built.dates;
    divisor = dates.length || 1;
  } else {
    const built = last7DayLabels();
    labels = built.labels;
    dates = built.dates;
    divisor = 7;
    rangeStart = dates[0];
    rangeEnd = dates[dates.length - 1];
  }

  let query = supabase
    .from('jz_transactions')
    .select('amount, type, date')
    .eq('user_id', req.user.userId)
    .gte('date', rangeStart)
    .lte('date', rangeEnd);
  query = applyLedgerScope(query, ledgerIds);

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }

  const list = flowOnly(data);
  let result;
  if (monthKeys) {
    result = monthKeys.map(({ year: my, month: mm }, idx) => {
      const { start, end } = monthRangeBySalary(my, mm, salaryDay);
      const amount = list
        .filter((t) => t.date >= start && t.date <= end && matchesFlowType(t.type, type))
        .reduce((s, t) => s + Number(t.amount), 0);
      return { label: labels[idx], date: start, amount };
    });
  } else {
    result = dates.map((date, idx) => ({
      label: labels[idx],
      date,
      amount: list
        .filter((t) => t.date === date && matchesFlowType(t.type, type))
        .reduce((s, t) => s + Number(t.amount), 0),
    }));
  }

  const total = result.reduce((s, i) => s + i.amount, 0);
  const average = divisor > 0 ? total / divisor : 0;

  return res.json({
    code: 200,
    message: '获取成功',
    data: {
      list: result,
      total,
      average,
      period,
      salaryDay,
      scope: ledgerIds ? 'ledger' : 'account',
    },
  });
});

/**
 * 【功能描述】
 * GET /category — 指定周期内按分类的金额占比统计。
 *
 * 【业务逻辑】
 * 1. period 支持 month/year/day；day 为近 7 日。
 * 2. type 默认 expense；含 transfer 于分类口径。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/category')
 * - 涉及知识点：buildCategoryStats、loadCategoryMap
 */
router.get('/category', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { year, month, type = 'expense', period = 'month' } = req.query;
  const ledgerIds = await resolveLedgerScope(supabase, req.user.userId, req.query.ledger_id);
  const settings = await loadSettings(supabase, req.user.userId);
  const salaryDay = normalizeSalaryDay(settings?.salary_day);

  let start;
  let end;
  if (period === 'year') {
    if (!year) {
      return res.status(400).json({ code: 400, message: 'year 为必填' });
    }
    ({ start, end } = yearRange(year));
  } else if (period === 'day') {
    const { dates } = last7DayLabels();
    start = dates[0];
    end = dates[dates.length - 1];
  } else {
    if (!year || !month) {
      return res.status(400).json({ code: 400, message: 'year 和 month 为必填' });
    }
    ({ start, end } = monthRangeBySalary(year, month, salaryDay));
  }

  let query = supabase
    .from('jz_transactions')
    .select('*')
    .eq('user_id', req.user.userId)
    .gte('date', start)
    .lte('date', end);
  query = applyLedgerScope(query, ledgerIds);

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }

  const categoryMap = await loadCategoryMap(supabase, req.user.userId);
  const { stats } = buildCategoryStats(data || [], type, categoryMap);

  return res.json({
    code: 200,
    message: '获取成功',
    data: stats,
    meta: { periodStart: start, periodEnd: end, salaryDay, scope: ledgerIds ? 'ledger' : 'account' },
  });
});

/**
 * 【功能描述】
 * GET /yearly — 指定自然年按发薪月拆分的 12 月收支表。
 *
 * 【业务逻辑】
 * 1. year 必填；每月用 monthRangeBySalary 切周期后聚合 income/expense。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/yearly')
 * - 涉及知识点：flowOnly、monthRangeBySalary 循环
 */
router.get('/yearly', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { year } = req.query;
  const ledgerIds = await resolveLedgerScope(supabase, req.user.userId, req.query.ledger_id);

  if (!year) {
    return res.status(400).json({ code: 400, message: 'year 为必填' });
  }

  const settings = await loadSettings(supabase, req.user.userId);
  const salaryDay = normalizeSalaryDay(settings?.salary_day);
  const { start, end } = yearRange(year);

  let query = supabase
    .from('jz_transactions')
    .select('amount, type, date')
    .eq('user_id', req.user.userId)
    .gte('date', start)
    .lte('date', end);
  query = applyLedgerScope(query, ledgerIds);

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }

  const list = flowOnly(data);
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    income: 0,
    expense: 0,
    balance: 0,
  }));

  monthly.forEach((row) => {
    const range = monthRangeBySalary(year, row.month, salaryDay);
    const inRange = list.filter((t) => t.date >= range.start && t.date <= range.end);
    row.income = sumByType(inRange, 'income');
    row.expense = sumExpense(inRange);
    row.balance = row.income - row.expense;
  });

  const totalIncome = monthly.reduce((s, row) => s + row.income, 0);
  const totalExpense = monthly.reduce((s, row) => s + row.expense, 0);

  return res.json({
    code: 200,
    message: '获取成功',
    data: {
      year: parseInt(year, 10),
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      monthly,
      salaryDay,
      scope: ledgerIds ? 'ledger' : 'account',
    },
  });
});

/**
 * 【功能描述】
 * GET /budget — 指定月份预算执行进度（总预算 + 分类预算）。
 *
 * 【业务逻辑】
 * 1. month 必填 YYYY-MM；按发薪日切周期统计 expense。
 * 2. 返回各分类 spent/percent/remain 及总 usedPercent。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/budget')
 * - 涉及知识点：jz_budgets + jz_transactions 联合聚合
 */
router.get('/budget', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { month } = req.query;
  const ledgerIds = await resolveLedgerScope(supabase, req.user.userId, req.query.ledger_id);

  if (!month) {
    return res.status(400).json({ code: 400, message: 'month 为必填 (YYYY-MM)' });
  }

  const settings = await loadSettings(supabase, req.user.userId);
  const salaryDay = normalizeSalaryDay(settings?.salary_day);
  const [y, m] = month.split('-');
  const { start, end } = monthRangeBySalary(y, m, salaryDay);

  let budgetQuery = supabase
    .from('jz_budgets')
    .select('*')
    .eq('user_id', req.user.userId)
    .eq('month', month);
  budgetQuery = applyLedgerScope(budgetQuery, ledgerIds);

  const { data: budgets } = await budgetQuery;

  let txQuery = supabase
    .from('jz_transactions')
    .select('amount, category_id, type')
    .eq('user_id', req.user.userId)
    .eq('type', 'expense')
    .gte('date', start)
    .lte('date', end);
  txQuery = applyLedgerScope(txQuery, ledgerIds);

  const { data: txs } = await txQuery;

  const totalBudget = Number(settings?.monthly_budget_total || 3500);
  const totalExpense = (txs || []).reduce((s, t) => s + Number(t.amount), 0);

  const budgetList = (budgets || []).map((b) => {
    const spent = (txs || [])
      .filter((t) => t.category_id === b.category_id)
      .reduce((s, t) => s + Number(t.amount), 0);
    const percent = b.amount > 0 ? Math.min(100, Math.round((spent / b.amount) * 100)) : 0;
    return { ...b, spent, percent, remain: b.amount - spent };
  });

  return res.json({
    code: 200,
    message: '获取成功',
    data: {
      totalBudget,
      totalExpense,
      remainingBudget: totalBudget - totalExpense,
      usedPercent: totalBudget > 0 ? Math.min(100, Math.round((totalExpense / totalBudget) * 100)) : 0,
      budgets: budgetList,
      periodStart: start,
      periodEnd: end,
      salaryDay,
      scope: ledgerIds ? 'ledger' : 'account',
    },
  });
});

module.exports = router;
