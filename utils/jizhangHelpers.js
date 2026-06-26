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

function monthRange(year, month) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function yearRange(year) {
  const y = parseInt(year, 10);
  return { start: `${y}-01-01`, end: `${y}-12-31` };
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
  yearRange,
  last7DayLabels,
  ensureJizhangUser,
};
