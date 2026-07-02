const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { monthRange, yearRange } = require('../../utils/jizhangHelpers');
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

function periodSummary(list, start, end) {
  const filtered = list.filter((t) => t.date >= start && t.date <= end);
  const income = sumByType(filtered, 'income');
  const expense = sumByType(filtered, 'expense');
  return { income, expense, balance: income - expense };
}

/** 资产概览：基于流水实时计算收支与净资产 */
router.get('/overview', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id } = req.query;

  const { ledgerId: lid, settings } = await resolveLedgerAndSettings(
    supabase,
    req.user.userId,
    ledger_id,
  );
  if (!lid) {
    return res.status(400).json({ code: 400, message: '请先选择账本' });
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const monthEnd = todayStr();
  const yearStart = `${y}-01-01`;
  const yearEnd = todayStr();
  const today = todayStr();

  const { data: txs, error: txErr } = await supabase
    .from('jz_transactions')
    .select('amount, type, date')
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid);

  if (txErr) {
    return res.status(500).json({ code: 500, message: '查询失败', error: txErr.message });
  }

  const list = txs || [];
  const todayStats = periodSummary(list, today, today);
  const monthStats = periodSummary(list, monthStart, monthEnd);
  const yearStats = periodSummary(list, yearStart, yearEnd);
  const allTimeStats = periodSummary(list, '1970-01-01', yearEnd);

  const { data: accounts } = await supabase
    .from('jz_accounts')
    .select('type, balance')
    .eq('user_id', req.user.userId);

  let accountAssets = 0;
  let accountLiabilities = 0;
  (accounts || []).forEach((a) => {
    const bal = Number(a.balance);
    if (a.type === 'credit') {
      accountLiabilities += Math.max(0, bal);
    } else {
      accountAssets += Math.max(0, bal);
    }
  });

  const flowNet = allTimeStats.balance;
  const totalAssets = accountAssets + Math.max(0, flowNet);
  const totalLiabilities = accountLiabilities + Math.max(0, -flowNet);
  const netAssets = totalAssets - totalLiabilities;

  const daysInMonth = d;
  const avgDailyExpense = daysInMonth > 0 ? monthStats.expense / daysInMonth : 0;
  const savingsRate =
    monthStats.income > 0
      ? Math.round(((monthStats.income - monthStats.expense) / monthStats.income) * 100)
      : 0;

  const monthlyTrend = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(y, m - 1 - i, 1);
    const ty = dt.getFullYear();
    const tm = dt.getMonth() + 1;
    const { start, end } = monthRange(ty, tm);
    const stats = periodSummary(list, start, end);
    monthlyTrend.push({
      label: `${tm}月`,
      year: ty,
      month: tm,
      income: stats.income,
      expense: stats.expense,
      balance: stats.balance,
    });
  }

  const totalBudget = Number(settings?.monthly_budget_total || 0);

  return res.json({
    code: 200,
    message: '获取成功',
    data: {
      netAssets,
      totalAssets,
      totalLiabilities,
      today: todayStats,
      month: monthStats,
      year: yearStats,
      allTime: allTimeStats,
      savingsRate,
      avgDailyExpense,
      monthlyTrend,
      totalBudget,
      remainingBudget: totalBudget - monthStats.expense,
    },
  });
});

module.exports = router;
