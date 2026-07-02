const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { monthRange, yearRange, last7DayLabels } = require('../../utils/jizhangHelpers');
const router = express.Router();

router.use(authenticate);

async function resolveLedgerAndSettings(supabase, userId, ledgerId) {
  const { data: settings } = await supabase
    .from('jz_user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  const lid = ledgerId || settings?.current_ledger_id;
  return { ledgerId: lid, settings };
}

function sumByType(list, type) {
  return list.filter((t) => t.type === type).reduce((s, t) => s + Number(t.amount), 0);
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function buildCategoryStats(list, type, categoryMap = new Map()) {
  const filtered = list.filter((t) => t.type === type);
  const total = filtered.reduce((s, t) => s + Number(t.amount), 0);
  const map = new Map();

  filtered.forEach((t) => {
    const key = t.category_id || t.category_name;
    const existing = map.get(key);
    const catMeta = categoryMap.get(t.category_id);
    if (existing) {
      existing.amount += Number(t.amount);
    } else {
      map.set(key, {
        categoryId: t.category_id,
        categoryName: t.category_name,
        icon: catMeta?.icon || t.icon || '📦',
        color: catMeta?.color || '#9CA3AF',
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

function buildMonthDayLabels(year, month) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const daysInMonth = new Date(y, m, 0).getDate();
  const labels = [];
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    labels.push(String(d));
  }
  return { labels, dates };
}

function buildYearMonthLabels(year) {
  const y = parseInt(year, 10);
  const labels = [];
  const ranges = [];
  for (let m = 1; m <= 12; m++) {
    labels.push(`${m}月`);
    ranges.push(monthRange(y, m));
  }
  return { labels, ranges };
}

function aggregateByRanges(list, ranges, labels, type) {
  return ranges.map(({ start, end }, idx) => ({
    label: labels[idx],
    date: start,
    amount: list
      .filter((t) => t.date >= start && t.date <= end && t.type === type)
      .reduce((s, t) => s + Number(t.amount), 0),
  }));
}

router.get('/overview', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, year, month } = req.query;

  if (!year || !month) {
    return res.status(400).json({ code: 400, message: 'year 和 month 为必填' });
  }

  const { ledgerId: lid, settings } = await resolveLedgerAndSettings(
    supabase,
    req.user.userId,
    ledger_id
  );
  if (!lid) {
    return res.status(400).json({ code: 400, message: '请先选择账本' });
  }

  const { start, end } = monthRange(year, month);
  const { data, error } = await supabase
    .from('jz_transactions')
    .select('amount, type')
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid)
    .gte('date', start)
    .lte('date', end);

  if (error) {
    return res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }

  const totalIncome = sumByType(data || [], 'income');
  const totalExpense = sumByType(data || [], 'expense');
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
    },
  });
});

router.get('/last7days', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, type = 'expense', period = 'day' } = req.query;

  const { ledgerId: lid } = await resolveLedgerAndSettings(supabase, req.user.userId, ledger_id);
  if (!lid) {
    return res.status(400).json({ code: 400, message: '请先选择账本' });
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  let labels = [];
  let dates = [];
  let ranges = null;
  let divisor = 7;
  let rangeStart;
  let rangeEnd;

  if (period === 'year') {
    const built = buildYearMonthLabels(y);
    labels = built.labels;
    ranges = built.ranges;
    divisor = m;
    ({ start: rangeStart, end: rangeEnd } = yearRange(y));
  } else if (period === 'month') {
    const built = buildMonthDayLabels(y, m);
    labels = built.labels;
    dates = built.dates;
    divisor = now.getDate();
    rangeStart = dates[0];
    rangeEnd = todayStr();
    dates = dates.filter((d) => d <= rangeEnd);
    labels = labels.slice(0, dates.length);
  } else {
    const built = last7DayLabels();
    labels = built.labels;
    dates = built.dates;
    divisor = 7;
    rangeStart = dates[0];
    rangeEnd = dates[dates.length - 1];
  }

  const { data, error } = await supabase
    .from('jz_transactions')
    .select('amount, type, date')
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid)
    .gte('date', rangeStart)
    .lte('date', rangeEnd);

  if (error) {
    return res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }

  let result;
  if (ranges) {
    result = aggregateByRanges(data || [], ranges, labels, type);
  } else {
    result = dates.map((date, idx) => ({
      label: labels[idx],
      date,
      amount: (data || [])
        .filter((t) => t.date === date && t.type === type)
        .reduce((s, t) => s + Number(t.amount), 0),
    }));
  }

  const total = result.reduce((s, i) => s + i.amount, 0);
  const average = divisor > 0 ? total / divisor : 0;

  return res.json({
    code: 200,
    message: '获取成功',
    data: { list: result, total, average, period },
  });
});

router.get('/category', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, year, month, type = 'expense', period = 'month' } = req.query;

  const { ledgerId: lid } = await resolveLedgerAndSettings(supabase, req.user.userId, ledger_id);

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
    ({ start, end } = monthRange(year, month));
  }

  const { data, error } = await supabase
    .from('jz_transactions')
    .select('*')
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid)
    .gte('date', start)
    .lte('date', end);

  if (error) {
    return res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }

  const categoryMap = await loadCategoryMap(supabase, req.user.userId);
  const { stats } = buildCategoryStats(data || [], type, categoryMap);

  return res.json({ code: 200, message: '获取成功', data: stats });
});

router.get('/yearly', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, year } = req.query;

  if (!year) {
    return res.status(400).json({ code: 400, message: 'year 为必填' });
  }

  const { ledgerId: lid } = await resolveLedgerAndSettings(supabase, req.user.userId, ledger_id);
  const { start, end } = yearRange(year);

  const { data, error } = await supabase
    .from('jz_transactions')
    .select('amount, type, date')
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid)
    .gte('date', start)
    .lte('date', end);

  if (error) {
    return res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }

  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    income: 0,
    expense: 0,
    balance: 0,
  }));

  (data || []).forEach((t) => {
    const m = parseInt(t.date.split('-')[1], 10) - 1;
    if (t.type === 'income') monthly[m].income += Number(t.amount);
    else monthly[m].expense += Number(t.amount);
    monthly[m].balance = monthly[m].income - monthly[m].expense;
  });

  const totalIncome = monthly.reduce((s, m) => s + m.income, 0);
  const totalExpense = monthly.reduce((s, m) => s + m.expense, 0);

  return res.json({
    code: 200,
    message: '获取成功',
    data: {
      year: parseInt(year, 10),
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      monthly,
    },
  });
});

router.get('/budget', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, month } = req.query;

  if (!month) {
    return res.status(400).json({ code: 400, message: 'month 为必填 (YYYY-MM)' });
  }

  const { ledgerId: lid, settings } = await resolveLedgerAndSettings(
    supabase,
    req.user.userId,
    ledger_id
  );
  const [y, m] = month.split('-');
  const { start, end } = monthRange(y, m);

  const { data: budgets } = await supabase
    .from('jz_budgets')
    .select('*')
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid)
    .eq('month', month);

  const { data: txs } = await supabase
    .from('jz_transactions')
    .select('amount, category_id, type')
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid)
    .eq('type', 'expense')
    .gte('date', start)
    .lte('date', end);

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
    },
  });
});

module.exports = router;
