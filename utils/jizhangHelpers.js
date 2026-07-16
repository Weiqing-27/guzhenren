/**
 * 记账模块 - 用户初始化与通用工具
 */
const DEFAULT_CATEGORIES = [
  { id: 'cat_food', name: '食品餐饮', type: 'expense', icon: '🍜', color: '#F59E0B' },
  { id: 'cat_grocery', name: '日用百货', type: 'expense', icon: '🛒', color: '#10B981' },
  { id: 'cat_transport', name: '交通出行', type: 'expense', icon: '🚇', color: '#3B82F6' },
  { id: 'cat_shopping', name: '购物消费', type: 'expense', icon: '🛍️', color: '#EC4899' },
  { id: 'cat_entertain', name: '休闲娱乐', type: 'expense', icon: '🎮', color: '#8B5CF6' },
  { id: 'cat_housing', name: '住房物业', type: 'expense', icon: '🏠', color: '#6366F1' },
  { id: 'cat_medical', name: '医疗健康', type: 'expense', icon: '💊', color: '#EF4444' },
  { id: 'cat_charity', name: '慈善捐助', type: 'expense', icon: '💝', color: '#F472B6' },
  { id: 'cat_other_exp', name: '其他支出', type: 'expense', icon: '📦', color: '#9CA3AF' },
  { id: 'cat_salary', name: '工资薪金', type: 'income', icon: '💰', color: '#10B981' },
  { id: 'cat_bonus', name: '奖金补贴', type: 'income', icon: '🎁', color: '#F59E0B' },
  { id: 'cat_invest', name: '理财收益', type: 'income', icon: '📈', color: '#3B82F6' },
  { id: 'cat_other_inc', name: '其他收入', type: 'income', icon: '💵', color: '#9CA3AF' },
];

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** 中国大陆手机号（11 位，1 开头） */
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone).trim());
}

function normalizePhone(phone) {
  return String(phone).trim().replace(/\s+/g, '');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normalizeSalaryDay(salaryDay) {
  const d = parseInt(salaryDay, 10);
  if (!Number.isFinite(d) || d < 1) return 1;
  return Math.min(28, d);
}

function monthRange(year, month) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const start = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
  return { start, end };
}

/**
 * 按发薪日切分的「月」区间。
 * salary_day=1 时与自然月一致；salary_day=15 时，7 月 = 7/15～8/14。
 */
function monthRangeBySalary(year, month, salaryDay = 1) {
  const day = normalizeSalaryDay(salaryDay);
  if (day === 1) return monthRange(year, month);

  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const start = `${y}-${pad2(m)}-${pad2(day)}`;
  let endY = y;
  let endM = m + 1;
  if (endM > 12) {
    endM = 1;
    endY += 1;
  }
  const endDate = new Date(endY, endM - 1, day);
  endDate.setDate(endDate.getDate() - 1);
  return { start, end: formatDateISO(endDate) };
}

/** 包含指定日期的当前发薪周期 */
function currentSalaryPeriod(refDate = new Date(), salaryDay = 1) {
  const day = normalizeSalaryDay(salaryDay);
  const y = refDate.getFullYear();
  const m = refDate.getMonth() + 1;
  const d = refDate.getDate();

  if (day === 1) {
    return monthRange(y, m);
  }

  if (d >= day) {
    return monthRangeBySalary(y, m, day);
  }

  let py = y;
  let pm = m - 1;
  if (pm < 1) {
    pm = 12;
    py -= 1;
  }
  return monthRangeBySalary(py, pm, day);
}

function yearRange(year) {
  const y = parseInt(year, 10);
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

/**
 * 解析单个 ledger_id 参数。
 * all / 空 / undefined / null → null（交由上层决定默认当前账本或全账号）
 */
function resolveLedgerFilter(ledgerId) {
  if (
    ledgerId == null ||
    ledgerId === '' ||
    ledgerId === 'all' ||
    ledgerId === 'undefined' ||
    ledgerId === 'null'
  ) {
    return null;
  }
  return String(ledgerId);
}

/** 还款(transfer)计入支出口径 */
function isExpenseLike(type) {
  return type === 'expense' || type === 'transfer';
}

function matchesFlowType(type, want) {
  if (want === 'expense') return isExpenseLike(type);
  return type === want;
}

function sumByFlowType(list, type) {
  return (list || [])
    .filter((t) => matchesFlowType(t.type, type))
    .reduce((s, t) => s + Number(t.amount), 0);
}

/**
 * 解析账本可见范围：自身 + 共享关联账本（双向）。
 * 返回 ledger id 数组；null 表示不限制（全账号）。
 * 未传 ledger_id 时默认取用户当前账本（不再跨账本汇总）。
 */
async function resolveLedgerScope(supabase, userId, ledgerId) {
  let lid = resolveLedgerFilter(ledgerId);
  if (!lid) {
    if (ledgerId === 'all') return null;
    const { data: settings } = await supabase
      .from('jz_user_settings')
      .select('current_ledger_id')
      .eq('user_id', userId)
      .maybeSingle();
    lid = settings?.current_ledger_id ? String(settings.current_ledger_id) : null;
  }
  if (!lid) return null;

  let { data: ledgers, error } = await supabase
    .from('jz_ledgers')
    .select('id, share_from_ledger_id')
    .eq('user_id', userId);

  // 未执行 alter-jizhang-ledger-share.sql 时退化为单账本
  if (error) {
    return [lid];
  }

  const list = ledgers || [];
  const ids = new Set([lid]);
  const self = list.find((l) => l.id === lid);
  const root = self?.share_from_ledger_id || lid;
  ids.add(root);
  list.forEach((l) => {
    if (l.id === root || l.share_from_ledger_id === root || l.share_from_ledger_id === lid || l.id === lid) {
      ids.add(l.id);
      if (l.share_from_ledger_id) ids.add(l.share_from_ledger_id);
    }
  });
  return Array.from(ids);
}

function applyLedgerScope(query, ledgerIds) {
  if (!ledgerIds || ledgerIds.length === 0) return query;
  if (ledgerIds.length === 1) return query.eq('ledger_id', ledgerIds[0]);
  return query.in('ledger_id', ledgerIds);
}

function last7DayLabels() {
  const labels = ['六', '日', '一', '二', '三', '四', '今'];
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return { labels, dates };
}

async function ensureJizhangUser(supabase, authUser, options = {}) {
  const userId = authUser.id;
  const email = authUser.email || options.pseudoEmail || null;

  const { data: profile } = await supabase
    .from('jz_user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (profile) return profile;

  const insertRow = {
    id: userId,
    email,
    nickname: options.nickname || null,
    avatar_url: options.avatar_url || null,
    profile_completed: false,
  };
  if (options.wechat_openid) insertRow.wechat_openid = options.wechat_openid;
  if (options.wechat_unionid) insertRow.wechat_unionid = options.wechat_unionid;

  const { data: newProfile, error: profileError } = await supabase
    .from('jz_user_profiles')
    .insert(insertRow)
    .select()
    .single();

  if (profileError) throw profileError;

  const { data: ledger, error: ledgerError } = await supabase
    .from('jz_ledgers')
    .insert({
      user_id: userId,
      name: '日常账本',
      icon: '📗',
      color: '#10B981',
      is_default: true,
    })
    .select()
    .single();

  if (ledgerError) throw ledgerError;

  await supabase.from('jz_user_settings').insert({
    user_id: userId,
    current_ledger_id: ledger.id,
    monthly_budget_total: 3500,
    salary_day: 1,
  });

  const defaultAccounts = [
    { user_id: userId, name: '现金', type: 'cash', balance: 0, icon: '💵' },
    { user_id: userId, name: '支付宝', type: 'other', balance: 0, icon: '📱' },
    { user_id: userId, name: '银行卡', type: 'bank', balance: 0, icon: '🏦' },
  ];
  await supabase.from('jz_accounts').insert(defaultAccounts);

  const { count } = await supabase
    .from('jz_categories')
    .select('*', { count: 'exact', head: true })
    .is('user_id', null);

  if (!count) {
    await supabase.from('jz_categories').insert(
      DEFAULT_CATEGORIES.map((c) => ({
        user_id: null,
        name: c.name,
        type: c.type,
        icon: c.icon,
        color: c.color,
      }))
    );
  }

  return newProfile;
}

module.exports = {
  DEFAULT_CATEGORIES,
  isValidEmail,
  isValidPhone,
  normalizePhone,
  monthRange,
  monthRangeBySalary,
  currentSalaryPeriod,
  normalizeSalaryDay,
  yearRange,
  last7DayLabels,
  resolveLedgerFilter,
  resolveLedgerScope,
  applyLedgerScope,
  isExpenseLike,
  matchesFlowType,
  sumByFlowType,
  formatDateISO,
  ensureJizhangUser,
};
