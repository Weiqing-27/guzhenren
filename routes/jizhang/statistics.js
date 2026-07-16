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

async function loadSettings(supabase, userId) {
  const { data } = await supabase
    .from('jz_user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

function sumByType(list, type) {
  return list.filter((t) => t.type === type).reduce((s, t) => s + Number(t.amount), 0);
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

/** 收支结余：仅 income/expense，还款 transfer 不计入（避免与信用消费重复） */
function flowOnly(list) {
  return (list || []).filter((t) => t.type === 'income' || t.type === 'expense');
}

function sumExpense(list) {
  return (list || [])
    .filter((t) => isFlowExpense(t.type))
    .reduce((s, t) => s + Number(t.amount), 0);
}

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

async function loadCategoryMap(supabase, userId) {
  const { data } = await supabase
    .from('jz_categories')
    .select('id, icon, color')
    .or(`user_id.is.null,user_id.eq.${userId}`);
  const map = new Map();
  (data || []).forEach((c) => map.set(c.id, c));
  return map;
}

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
