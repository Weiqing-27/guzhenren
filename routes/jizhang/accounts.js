const express = require('express');
const { authenticate } = require('../../middleware/auth');
const {
  computeAccountEffects,
  summarizeAccountBalances,
} = require('../../utils/jizhangHelpers');
const router = express.Router();

router.use(authenticate);

const ACCOUNT_TYPES = ['cash', 'bank', 'credit', 'other'];

/**
 * 【功能描述】
 * 加载用户全部流水，按 date、created_at 升序（用于余额重算）。
 *
 * 【业务逻辑】
 * 1. rebuild-balances 与手动改余额时需完整流水序列计算净变动。
 *
 * 【技术实现】
 * - 涉及方法：loadUserTransactions
 * - 涉及知识点：jz_transactions select + order
 */
async function loadUserTransactions(supabase, userId) {
  const { data, error } = await supabase
    .from('jz_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * 【功能描述】
 * GET / — 获取账户列表及总资产/负债/净资产汇总。
 *
 * 【业务逻辑】
 * 1. 返回用户全部 jz_accounts。
 * 2. 用 summarizeAccountBalances 计算 totalAssets、totalLiabilities、netAssets。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/')
 * - 涉及知识点：summarizeAccountBalances
 */
router.get('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { data, error } = await supabase
    .from('jz_accounts')
    .select('*')
    .eq('user_id', req.user.userId)
    .order('created_at', { ascending: true });

  if (error) {
    return res.status(500).json({ code: 500, message: '获取失败', error: error.message });
  }

  const summary = summarizeAccountBalances(data || []);

  return res.json({
    code: 200,
    message: '获取成功',
    data: {
      list: data || [],
      total: summary.netAssets,
      totalAssets: summary.totalAssets,
      totalLiabilities: summary.totalLiabilities,
    },
  });
});

/**
 * 【功能描述】
 * POST / — 创建新账户。
 *
 * 【业务逻辑】
 * 1. name 必填；type 默认 other；balance 默认 0。
 * 2. 新建账户期初 initial_balance 默认等于当前 balance（尚无流水）。
 * 3. 未执行 initial_balance 迁移时降级插入不含该列。
 *
 * 【技术实现】
 * - 涉及方法：router.post('/')
 * - 涉及知识点：ACCOUNT_TYPES、insert 兼容降级
 */
router.post('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { name, type, balance, icon, initial_balance, initialBalance } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ code: 400, message: '账户名称不能为空' });
  }

  const accountType = ACCOUNT_TYPES.includes(type) ? type : 'other';
  const bal = parseFloat(balance || 0) || 0;
  // 新建账户：期初 = 当前余额（尚未有流水）
  const initial =
    initial_balance !== undefined || initialBalance !== undefined
      ? parseFloat(initial_balance ?? initialBalance) || 0
      : bal;

  const row = {
    user_id: req.user.userId,
    name: name.trim(),
    type: accountType,
    balance: bal,
    initial_balance: initial,
    icon: icon || '💳',
  };

  let { data, error } = await supabase.from('jz_accounts').insert(row).select().single();

  // 兼容未执行 alter-jizhang-account-initial-balance.sql
  if (error && /initial_balance/i.test(error.message || '')) {
    delete row.initial_balance;
    ({ data, error } = await supabase.from('jz_accounts').insert(row).select().single());
  }

  if (error) {
    return res.status(500).json({ code: 500, message: '创建失败', error: error.message });
  }

  return res.status(201).json({ code: 201, message: '创建成功', data });
});

/**
 * 【功能描述】
 * PUT /:id — 更新账户名称、类型、图标或手动余额。
 *
 * 【业务逻辑】
 * 1. 手动改 balance 时回推 initial_balance = 新余额 - 流水净变动。
 * 2. 保证 rebuild 后余额仍等于用户设定值。
 *
 * 【技术实现】
 * - 涉及方法：router.put('/:id')
 * - 涉及知识点：computeAccountEffects、initial_balance 兼容
 */
router.put('/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;
  const { name, type, balance, icon } = req.body;

  const updatePayload = {};
  if (name !== undefined) {
    if (!String(name).trim()) {
      return res.status(400).json({ code: 400, message: '账户名称不能为空' });
    }
    updatePayload.name = String(name).trim();
  }
  if (type !== undefined) {
    if (!ACCOUNT_TYPES.includes(type)) {
      return res.status(400).json({ code: 400, message: '账户类型无效' });
    }
    updatePayload.type = type;
  }
  if (icon !== undefined) updatePayload.icon = icon;

  // 手动改余额：回推期初 = 新余额 - 流水净变动，保证重算后仍等于该值
  if (balance !== undefined) {
    const nextBal = parseFloat(balance);
    if (!Number.isFinite(nextBal)) {
      return res.status(400).json({ code: 400, message: '金额无效' });
    }
    updatePayload.balance = nextBal;
    try {
      const { data: allAccounts } = await supabase
        .from('jz_accounts')
        .select('*')
        .eq('user_id', req.user.userId);
      const txs = await loadUserTransactions(supabase, req.user.userId);
      const effects = computeAccountEffects(allAccounts || [], txs);
      updatePayload.initial_balance = nextBal - Number(effects[id] || 0);
    } catch {
      updatePayload.initial_balance = nextBal;
    }
  }

  let { data, error } = await supabase
    .from('jz_accounts')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', req.user.userId)
    .select()
    .single();

  if (error && /initial_balance/i.test(error.message || '') && updatePayload.initial_balance !== undefined) {
    delete updatePayload.initial_balance;
    ({ data, error } = await supabase
      .from('jz_accounts')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .select()
      .single());
  }

  if (error || !data) {
    return res.status(404).json({ code: 404, message: '账户不存在' });
  }

  return res.json({ code: 200, message: '更新成功', data });
});

/**
 * 【功能描述】
 * POST /rebuild-balances — 按「期初 + 流水净变动」重算全部账户余额。
 *
 * 【业务逻辑】
 * 1. balance = initial_balance + Σ流水影响；无期初时用当前余额反推。
 * 2. 信用账户欠款不允许为负（多还部分不记负债）。
 * 3. 未执行 initial_balance 迁移时仅写 balance。
 *
 * 【技术实现】
 * - 涉及方法：router.post('/rebuild-balances')
 * - 涉及知识点：computeAccountEffects、summarizeAccountBalances
 */
router.post('/rebuild-balances', async (req, res) => {
  const supabase = req.app.get('supabase');
  const userId = req.user.userId;

  const { data: accounts, error: accErr } = await supabase
    .from('jz_accounts')
    .select('*')
    .eq('user_id', userId);

  if (accErr) {
    return res.status(500).json({ code: 500, message: '读取账户失败', error: accErr.message });
  }

  let txs;
  try {
    txs = await loadUserTransactions(supabase, userId);
  } catch (e) {
    return res.status(500).json({ code: 500, message: '读取流水失败', error: e.message });
  }

  const effects = computeAccountEffects(accounts || [], txs);

  for (const acc of accounts || []) {
    const effect = Number(effects[acc.id] || 0);
    let initial = Number(acc.initial_balance);
    if (!Number.isFinite(initial)) {
      // 无期初字段时：用当前余额反推，避免把期初欠款清零
      initial = Number(acc.balance || 0) - effect;
    }
    // 信用账户余额表示欠款，不允许为负（多还部分不记负债）
    let next = initial + effect;
    const isCredit = String(acc.type || '').toLowerCase() === 'credit';
    if (isCredit && next < 0) next = 0;
    const patch = { balance: next, initial_balance: initial };
    let { error } = await supabase
      .from('jz_accounts')
      .update(patch)
      .eq('id', acc.id)
      .eq('user_id', userId);
    if (error && /initial_balance/i.test(error.message || '')) {
      ({ error } = await supabase
        .from('jz_accounts')
        .update({ balance: next })
        .eq('id', acc.id)
        .eq('user_id', userId));
    }
    if (error) {
      return res.status(500).json({ code: 500, message: '写回余额失败', error: error.message });
    }
  }

  const { data: fresh } = await supabase
    .from('jz_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const summary = summarizeAccountBalances(fresh || []);

  return res.json({
    code: 200,
    message: '已按期初+流水重算账户余额',
    data: {
      list: fresh || [],
      ...summary,
    },
  });
});

/**
 * 【功能描述】
 * 删除账户（供 DELETE 与 POST delete 共用）。
 *
 * 【业务逻辑】
 * 1. 须 confirm=1/true；至少保留 1 个账户。
 * 2. 有关联流水时默认拒绝；force=1 时先解除 account_id/to_account_id 再删。
 *
 * 【技术实现】
 * - 涉及方法：handleDeleteAccount
 * - 涉及知识点：query/body 参数解析、流水关联解除
 */
async function handleDeleteAccount(req, res) {
  const supabase = req.app.get('supabase');
  const { id } = req.params;
  const confirm =
    req.query.confirm === '1' ||
    req.query.confirm === 'true' ||
    req.body?.confirm === true ||
    req.body?.confirm === 1 ||
    req.body?.confirm === '1';
  const force =
    req.query.force === '1' ||
    req.query.force === 'true' ||
    req.body?.force === true ||
    req.body?.force === 1 ||
    req.body?.force === '1';

  if (!confirm) {
    return res.status(400).json({
      code: 400,
      message: '请确认删除：传 confirm=1',
    });
  }

  const { data: account } = await supabase
    .from('jz_accounts')
    .select('*')
    .eq('id', id)
    .eq('user_id', req.user.userId)
    .maybeSingle();

  if (!account) {
    return res.status(404).json({ code: 404, message: '账户不存在' });
  }

  const { count: accountCount } = await supabase
    .from('jz_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user.userId);

  if ((accountCount || 0) <= 1) {
    return res.status(400).json({ code: 400, message: '至少保留一个账户，无法删除' });
  }

  const { count: asFrom } = await supabase
    .from('jz_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user.userId)
    .eq('account_id', id);

  const { count: asTo } = await supabase
    .from('jz_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user.userId)
    .eq('to_account_id', id);

  const linkedCount = (asFrom || 0) + (asTo || 0);

  if (linkedCount > 0 && !force) {
    return res.status(400).json({
      code: 400,
      message: `该账户已关联 ${linkedCount} 笔流水，确认后可解除关联并删除`,
      data: { linkedCount, needForce: true },
    });
  }

  if (linkedCount > 0 && force) {
    await supabase
      .from('jz_transactions')
      .update({ account_id: null })
      .eq('user_id', req.user.userId)
      .eq('account_id', id);

    await supabase
      .from('jz_transactions')
      .update({ to_account_id: null })
      .eq('user_id', req.user.userId)
      .eq('to_account_id', id);
  }

  const { error } = await supabase
    .from('jz_accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.userId);

  if (error) {
    return res.status(500).json({ code: 500, message: '删除失败', error: error.message });
  }

  return res.json({
    code: 200,
    message: linkedCount > 0 ? '已解除关联并删除账户' : '删除成功',
    data: { unlinked: linkedCount },
  });
}

// 小程序 / 部分网关对 DELETE 支持不佳，同时提供 POST 删除
router.post('/:id/delete', handleDeleteAccount);
router.delete('/:id', handleDeleteAccount);

module.exports = router;
