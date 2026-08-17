const express = require('express');
const { authenticate } = require('../../middleware/auth');
const {
  monthRangeBySalary,
  currentSalaryPeriod,
  normalizeSalaryDay,
  resolveLedgerScope,
  applyLedgerScope,
  isFlowExpense,
  summarizeAccountBalances,
} = require('../../utils/jizhangHelpers');
const router = express.Router();

router.use(authenticate);

/**
 * 【功能描述】
 * 加载用户记账设置（发薪日、总预算等）。
 *
 * 【业务逻辑】
 * 1. 供 overview 计算发薪周期与预算剩余。
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
 * 按流水 type 对列表求金额合计。
 *
 * 【业务逻辑】
 * 1. 严格 type 相等过滤后 reduce。
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
 * 返回今日 ISO 日期字符串 YYYY-MM-DD。
 *
 * 【业务逻辑】
 * 1. 用于截断统计区间不超过今天。
 *
 * 【技术实现】
 * - 涉及方法：todayStr
 * - 涉及知识点：toISOString split
 */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

/**
 * 【功能描述】
 * 计算指定日期区间内的周期收支结余（流量口径，按账本流水）。
 *
 * 【业务逻辑】
 * 1. 收入 = income 合计；支出 = expense 合计（不含 transfer 还款）。
 * 2. 结余 = 收入 - 支出；与净资产（账户存量）是两套口径。
 *
 * 【技术实现】
 * - 涉及方法：periodSummary
 * - 涉及知识点：isFlowExpense、日期区间 filter
 */
function periodSummary(list, start, end) {
  const filtered = (list || []).filter((t) => t.date >= start && t.date <= end);
  const income = sumByType(filtered, 'income');
  const expense = filtered
    .filter((t) => isFlowExpense(t.type))
    .reduce((s, t) => s + Number(t.amount), 0);
  return { income, expense, balance: income - expense };
}

/**
 * 【功能描述】
 * GET /overview — 资产总览：净资产、周期收支、趋势与预算。
 *
 * 【业务逻辑】
 * 1. 净资产/总资产/负债：全账户实时余额（与账本无关）。
 * 2. 今日/本月/本年收支：当前账本（及共享关联）流水，不含还款。
 * 3. 返回近 6 个发薪月趋势、savingsRate、avgDailyExpense 等。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/overview')
 * - 涉及知识点：resolveLedgerScope、summarizeAccountBalances、monthRangeBySalary
 */
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

  // 不查询 initial_balance，避免未执行迁移时 500
  const { data: accounts, error: accErr } = await supabase
    .from('jz_accounts')
    .select('id, name, type, balance, icon')
    .eq('user_id', req.user.userId)
    .order('created_at', { ascending: true });

  if (accErr) {
    return res.status(500).json({ code: 500, message: '查询账户失败', error: accErr.message });
  }

  const accountList = accounts || [];
  const { totalAssets, totalLiabilities, netAssets } = summarizeAccountBalances(accountList);

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
      accounts: accountList,
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
      rules: {
        netAssets: '净资产=非信用账户余额之和−信用账户欠款；随记账实时变，不是月底结算',
        periodBalance: '周期结余=收入−支出；还款(transfer)不计入，避免与信用消费重复',
        note: '结余是流量，净资产是存量，二者不必相等',
      },
    },
  });
});

module.exports = router;
