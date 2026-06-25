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

function buildCategoryStats(list, type) {
  const filtered = list.filter((t) => t.type === type);
  const total = filtered.reduce((s, t) => s + Number(t.amount), 0);
  const map = new Map();

  filtered.forEach((t) => {
    const key = t.category_id || t.category_name;
    const existing = map.get(key);
    if (existing) {
      existing.amount += Number(t.amount);
    } else {
      map.set(key, {
        categoryId: t.category_id,
        categoryName: t.category_name,
        icon: t.icon || '📦',
        color: '#9CA3AF',
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
  const { ledger_id, type = 'expense' } = req.query;

  const { ledgerId: lid } = await resolveLedgerAndSettings(supabase, req.user.userId, ledger_id);
  if (!lid) {
    return res.status(400).json({ code: 400, message: '请先选择账本' });
  }
  const { labels, dates } = last7DayLabels();

  const { data, error } = await supabase
    .from('jz_transactions')
    .select('amount, type, date')
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid)
    .gte('date', dates[0])
    .lte('date', dates[dates.length - 1]);

  if (error) {
    return res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }

  const result = dates.map((date, idx) => ({
    label: labels[idx],
    date,
    amount: (data || [])
      .filter((t) => t.date === date && t.type === type)
      .reduce((s, t) => s + Number(t.amount), 0),
  }));

  const total = result.reduce((s, i) => s + i.amount, 0);

  return res.json({
    code: 200,
    message: '获取成功',
    data: { list: result, total, average: total / 7 },
  });
});

router.get('/category', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, year, month, type = 'expense' } = req.query;

  if (!year || !month) {
    return res.status(400).json({ code: 400, message: 'year 和 month 为必填' });
  }

  const { ledgerId: lid } = await resolveLedgerAndSettings(supabase, req.user.userId, ledger_id);
  const { start, end } = monthRange(year, month);

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

  const { stats } = buildCategoryStats(data || [], type);

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

  const totalBudget = Number(settings?.monthly_budget_total || 0);
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
