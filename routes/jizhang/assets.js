const express = require('express');
const { authenticate } = require('../../middleware/auth');
const {
  monthRangeBySalary,
  currentSalaryPeriod,
  normalizeSalaryDay,
  resolveLedgerScope,
  applyLedgerScope,
  isExpenseLike,
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

function periodSummary(list, start, end) {
  const filtered = (list || []).filter((t) => t.date >= start && t.date <= end);
  const income = sumByType(filtered, 'income');
  const expense = filtered
    .filter((t) => isExpenseLike(t.type))
    .reduce((s, t) => s + Number(t.amount), 0);
  return { income, expense, balance: income - expense };
}

/** 资产概览：收支按当前账本（及共享关联）；还款计入支出 */
router.get('/overview', async (req, res) => {
  const supabase = req.app.get('supabase');
  const ledgerIds = await resolveLedgerScope(supabase, req.user.userId, req.query.ledger_id);
  const settings = await loadSettings(supabase, req.user.userId);
  const salaryDay = normalizeSalaryDay(settings?.salary_day);

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const today = todayStr();
  const { start: monthStart, end: monthEndRaw } = currentSalaryPeriod(now, salaryDay);
  const monthEnd = monthEndRaw > today ? today : monthEndRaw;
  const yearStart = `${y}-01-01`;
  const yearEnd = today;

  let txQuery = supabase
    .from('jz_transactions')
    .select('amount, type, date')
    .eq('user_id', req.user.userId);

  txQuery = applyLedgerScope(txQuery, ledgerIds);

  const { data: txs, error: txErr } = await txQuery;
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

  let totalAssets = 0;
  let totalLiabilities = 0;
  (accounts || []).forEach((a) => {
    const bal = Number(a.balance);
    if (a.type === 'credit') {
      totalLiabilities += Math.max(0, bal);
    } else {
      totalAssets += Math.max(0, bal);
    }
  });

  const netAssets = totalAssets - totalLiabilities;

  const monthDaysElapsed = Math.max(
    1,
    Math.round(
      (new Date(monthEnd) - new Date(monthStart)) / (24 * 60 * 60 * 1000),
    ) + 1,
  );
  const daysCounted = Math.min(
    monthDaysElapsed,
    Math.round((new Date(today) - new Date(monthStart)) / (24 * 60 * 60 * 1000)) + 1,
  );
  const avgDailyExpense = daysCounted > 0 ? monthStats.expense / daysCounted : 0;
  const savingsRate =
    monthStats.income > 0
      ? Math.round(((monthStats.income - monthStats.expense) / monthStats.income) * 100)
      : 0;

  const monthlyTrend = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(y, m - 1 - i, 1);
    const ty = dt.getFullYear();
    const tm = dt.getMonth() + 1;
    const { start, end } = monthRangeBySalary(ty, tm, salaryDay);
    const stats = periodSummary(list, start, end > today ? today : end);
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
      salaryDay,
      periodStart: monthStart,
      periodEnd: monthEnd,
      scope: ledgerIds ? 'ledger' : 'account',
    },
  });
});

module.exports = router;
