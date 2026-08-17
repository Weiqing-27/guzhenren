/**
 * 【功能描述】
 * 记账模块 - 用户初始化、日期/账本工具、账户余额计算等通用 helpers。
 *
 * 【业务逻辑】
 * 1. 新用户注册时初始化 profile、默认账本、账户、分类与设置。
 * 2. 提供发薪日周期、账本可见范围、收支口径等跨路由复用逻辑。
 *
 * 【技术实现】
 * - 涉及方法：ensureJizhangUser、resolveLedgerScope、computeAccountEffects 等
 * - 涉及知识点：Supabase 查询、日期区间计算、账户类型与流水联动规则
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

/**
 * 【功能描述】
 * 校验邮箱格式是否合法。
 *
 * 【业务逻辑】
 * 1. 用于 OTP 发送与登录前的输入校验。
 *
 * 【技术实现】
 * - 涉及方法：isValidEmail
 * - 涉及知识点：正则邮箱格式校验
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 【功能描述】
 * 校验中国大陆 11 位手机号。
 *
 * 【业务逻辑】
 * 1. 1 开头、第二位 3–9，共 11 位数字。
 *
 * 【技术实现】
 * - 涉及方法：isValidPhone
 * - 涉及知识点：手机号正则
 */
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone).trim());
}

/**
 * 【功能描述】
 * 规范化手机号：去空白。
 *
 * 【业务逻辑】
 * 1. 统一存储与查询用的 phone 字符串格式。
 *
 * 【技术实现】
 * - 涉及方法：normalizePhone
 * - 涉及知识点：trim、空白字符移除
 */
function normalizePhone(phone) {
  return String(phone).trim().replace(/\s+/g, '');
}

/**
 * 【功能描述】
 * 数字补零至两位字符串。
 *
 * 【业务逻辑】
 * 1. 构造 YYYY-MM-DD 日期字符串时使用。
 *
 * 【技术实现】
 * - 涉及方法：pad2
 * - 涉及知识点：String.padStart
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 【功能描述】
 * 将 Date 对象格式化为 ISO 日期字符串 YYYY-MM-DD。
 *
 * 【业务逻辑】
 * 1. 本地日期分量拼接，避免 toISOString 时区偏移。
 *
 * 【技术实现】
 * - 涉及方法：formatDateISO
 * - 涉及知识点：Date getFullYear/getMonth/getDate
 */
function formatDateISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 【功能描述】
 * 规范化发薪日：1–28 的整数，无效时默认 1。
 *
 * 【业务逻辑】
 * 1. 发薪日用于切分「记账月」周期，避免 29–31 日跨月歧义。
 *
 * 【技术实现】
 * - 涉及方法：normalizeSalaryDay
 * - 涉及知识点：parseInt、边界 clamp
 */
function normalizeSalaryDay(salaryDay) {
  const d = parseInt(salaryDay, 10);
  if (!Number.isFinite(d) || d < 1) return 1;
  return Math.min(28, d);
}

/**
 * 【功能描述】
 * 自然月日期区间 [start, end]。
 *
 * 【业务逻辑】
 * 1. 发薪日为 1 时与 monthRangeBySalary 结果一致。
 *
 * 【技术实现】
 * - 涉及方法：monthRange
 * - 涉及知识点：月份最后一天计算 new Date(y, m, 0)
 */
function monthRange(year, month) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const start = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
  return { start, end };
}

/**
 * 【功能描述】
 * 按发薪日切分的「记账月」区间。
 *
 * 【业务逻辑】
 * 1. salary_day=1 时与自然月一致。
 * 2. salary_day=15 时，7 月周期 = 7/15～8/14。
 *
 * 【技术实现】
 * - 涉及方法：monthRangeBySalary
 * - 涉及知识点：跨月日期推算、formatDateISO
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

/**
 * 【功能描述】
 * 求包含指定参考日期的当前发薪周期区间。
 *
 * 【业务逻辑】
 * 1. 若参考日 >= 发薪日，周期从本月发薪日起。
 * 2. 否则周期从上月发薪日起（跨自然月）。
 *
 * 【技术实现】
 * - 涉及方法：currentSalaryPeriod
 * - 涉及知识点：monthRangeBySalary 组合、年月回退
 */
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

/**
 * 【功能描述】
 * 自然年日期区间。
 *
 * 【业务逻辑】
 * 1. 返回 YYYY-01-01 至 YYYY-12-31。
 *
 * 【技术实现】
 * - 涉及方法：yearRange
 * - 涉及知识点：字符串日期区间
 */
function yearRange(year) {
  const y = parseInt(year, 10);
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

/**
 * 【功能描述】
 * 解析单个 ledger_id 查询参数。
 *
 * 【业务逻辑】
 * 1. all / 空 / undefined / null → null，交由上层决定默认账本或全账号。
 * 2. 有效 UUID 字符串原样返回。
 *
 * 【技术实现】
 * - 涉及方法：resolveLedgerFilter
 * - 涉及知识点：查询参数哨兵值处理
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

/**
 * 【功能描述】
 * 判断流水类型是否计入「收支结余」中的支出。
 *
 * 【业务逻辑】
 * 1. 仅 expense 计入；transfer（还款）不计，避免与信用消费重复。
 *
 * 【技术实现】
 * - 涉及方法：isFlowExpense
 * - 涉及知识点：流水 type 口径约定
 */
function isFlowExpense(type) {
  return type === 'expense';
}

/**
 * 【功能描述】
 * 判断流水类型是否计入「分类占比」中的支出类。
 *
 * 【业务逻辑】
 * 1. expense 与 transfer 均计入，便于展示还款类分类。
 *
 * 【技术实现】
 * - 涉及方法：isCategoryExpense
 * - 涉及知识点：统计口径与 flow 口径区分
 */
function isCategoryExpense(type) {
  return type === 'expense' || type === 'transfer';
}

/**
 * 【功能描述】
 * 流水 type 是否匹配请求的 flow 统计类型（income/expense）。
 *
 * 【业务逻辑】
 * 1. want=expense 时用 isFlowExpense；否则严格相等。
 *
 * 【技术实现】
 * - 涉及方法：matchesFlowType
 * - 涉及知识点：类型匹配委托
 */
function matchesFlowType(type, want) {
  if (want === 'expense') return isFlowExpense(type);
  return type === want;
}

/**
 * 【功能描述】
 * 流水 type 是否匹配请求的分类统计类型。
 *
 * 【业务逻辑】
 * 1. want=expense 时用 isCategoryExpense；否则严格相等。
 *
 * 【技术实现】
 * - 涉及方法：matchesCategoryType
 * - 涉及知识点：分类统计口径
 */
function matchesCategoryType(type, want) {
  if (want === 'expense') return isCategoryExpense(type);
  return type === want;
}

/**
 * 【功能描述】
 * 按 flow 口径对流水列表按 type 求金额合计。
 *
 * 【业务逻辑】
 * 1. 过滤 matchesFlowType 后 reduce 累加 amount。
 *
 * 【技术实现】
 * - 涉及方法：sumByFlowType
 * - 涉及知识点：数组 filter/reduce
 */
function sumByFlowType(list, type) {
  return (list || [])
    .filter((t) => matchesFlowType(t.type, type))
    .reduce((s, t) => s + Number(t.amount), 0);
}

/**
 * 【功能描述】
 * 解析账本可见范围：自身 + 共享关联账本（双向）。
 *
 * 【业务逻辑】
 * 1. 未传 ledger_id 时默认取用户当前账本（不再跨账本汇总）。
 * 2. ledger_id=all 返回 null 表示不限制（全账号流水）。
 * 3. 含 share_from_ledger_id 关联的账本组，列表/统计双向可见。
 *
 * 【技术实现】
 * - 涉及方法：resolveLedgerScope
 * - 涉及知识点：Supabase 查询 jz_ledgers、Set 去重、迁移降级
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

/**
 * 【功能描述】
 * 将账本 ID 列表应用到 Supabase 查询链。
 *
 * 【业务逻辑】
 * 1. null/空数组不追加过滤。
 * 2. 单个 ID 用 eq；多个用 in。
 *
 * 【技术实现】
 * - 涉及方法：applyLedgerScope
 * - 涉及知识点：Supabase query builder eq/in
 */
function applyLedgerScope(query, ledgerIds) {
  if (!ledgerIds || ledgerIds.length === 0) return query;
  if (ledgerIds.length === 1) return query.eq('ledger_id', ledgerIds[0]);
  return query.in('ledger_id', ledgerIds);
}

/**
 * 【功能描述】
 * 生成近 7 日标签与 ISO 日期数组（含「今」）。
 *
 * 【业务逻辑】
 * 1. 供 statistics/last7days 等接口按日聚合。
 *
 * 【技术实现】
 * - 涉及方法：last7DayLabels
 * - 涉及知识点：Date setDate 回溯、toISOString 取日期部分
 */
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

/**
 * 【功能描述】
 * 确保记账用户 profile 存在，不存在则完整初始化新用户数据。
 *
 * 【业务逻辑】
 * 1. 已有 profile 直接返回。
 * 2. 新建：jz_user_profiles、默认账本、设置、默认账户、系统分类（若全局无分类）。
 * 3. 支持微信 openid/unionid 与伪邮箱写入。
 *
 * 【技术实现】
 * - 涉及方法：ensureJizhangUser
 * - 涉及知识点：Supabase insert 链、DEFAULT_CATEGORIES 种子数据
 */
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

/**
 * 【功能描述】
 * 判断账户类型是否为信用账户（credit）。
 *
 * 【业务逻辑】
 * 1. 信用账户余额表示欠款，与资产账户增减方向相反。
 *
 * 【技术实现】
 * - 涉及方法：isCreditAccountType
 * - 涉及知识点：type 字符串 normalize
 */
function isCreditAccountType(type) {
  return String(type || '').trim().toLowerCase() === 'credit';
}

/**
 * 【功能描述】
 * 计算单笔流水对指定账户余额的增减量（与记账联动规则一致）。
 *
 * 【业务逻辑】
 * 1. income：资产 +amount；信用视为还款 -amount。
 * 2. expense：资产 -amount；信用视为借款 +amount。
 * 3. transfer：转出 -；还入信用 -；还入资产 +。
 *
 * 【技术实现】
 * - 涉及方法：balanceDeltaForAccount
 * - 涉及知识点：流水 type、account_id/to_account_id、信用账户符号
 */
function balanceDeltaForAccount(tx, accountId, accountTypeById) {
  const amount = Number(tx.amount) || 0;
  if (!amount || !accountId) return 0;

  if (tx.type === 'transfer') {
    if (String(tx.account_id) === String(accountId)) return -amount;
    if (String(tx.to_account_id) === String(accountId)) {
      return isCreditAccountType(accountTypeById.get(String(accountId))) ? -amount : amount;
    }
    return 0;
  }

  if (String(tx.account_id) !== String(accountId)) return 0;
  const credit = isCreditAccountType(accountTypeById.get(String(accountId)));
  if (tx.type === 'income') return credit ? -amount : amount;
  if (tx.type === 'expense') return credit ? amount : -amount;
  return 0;
}

/**
 * 【功能描述】
 * 汇总全部流水对各账户的净变动（用于 rebuild-balances）。
 *
 * 【业务逻辑】
 * 1. 遍历每笔流水 × 每个账户，累加 balanceDeltaForAccount。
 *
 * 【技术实现】
 * - 涉及方法：computeAccountEffects
 * - 涉及知识点：双重循环聚合、Map 存账户 type
 */
function computeAccountEffects(accounts, transactions) {
  const typeMap = new Map((accounts || []).map((a) => [String(a.id), a.type]));
  const effects = {};
  (accounts || []).forEach((a) => {
    effects[a.id] = 0;
  });
  (transactions || []).forEach((tx) => {
    (accounts || []).forEach((a) => {
      effects[a.id] += balanceDeltaForAccount(tx, a.id, typeMap);
    });
  });
  return effects;
}

/**
 * 【功能描述】
 * 按账户列表计算总资产、总负债与净资产（存量口径）。
 *
 * 【业务逻辑】
 * 1. 总资产 = Σ max(0, 非信用账户余额)；负余额不计入展示。
 * 2. 负债 = Σ max(0, 信用账户欠款)；净资产 = 总资产 - 负债。
 * 3. 与周期收支结余（流量）是两套口径，数值不必相等。
 *
 * 【技术实现】
 * - 涉及方法：summarizeAccountBalances
 * - 涉及知识点：isCreditAccountType、Math.max 截断
 */
function summarizeAccountBalances(accounts) {
  let totalAssets = 0;
  let totalLiabilities = 0;
  (accounts || []).forEach((a) => {
    const bal = Number(a.balance) || 0;
    if (isCreditAccountType(a.type)) {
      totalLiabilities += Math.max(0, bal);
    } else {
      totalAssets += Math.max(0, bal);
    }
  });
  return {
    totalAssets,
    totalLiabilities,
    netAssets: totalAssets - totalLiabilities,
  };
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
  isFlowExpense,
  isCategoryExpense,
  matchesFlowType,
  matchesCategoryType,
  sumByFlowType,
  isCreditAccountType,
  balanceDeltaForAccount,
  computeAccountEffects,
  summarizeAccountBalances,
  formatDateISO,
  ensureJizhangUser,
};
