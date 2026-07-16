const express = require('express');
const { authenticate } = require('../../middleware/auth');
const {
  computeAccountEffects,
  summarizeAccountBalances,
} = require('../../utils/jizhangHelpers');
const router = express.Router();

router.use(authenticate);

const ACCOUNT_TYPES = ['cash', 'bank', 'credit', 'other'];

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
 * 按「期初 + 流水净变动」重算余额。
 * balance = initial_balance + Σ流水影响
 * 若尚未有 initial_balance 列/值：用 当前余额 - 流水影响 回推期初后再写回。
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
 * 删除账户
 * - 至少保留 1 个账户
 * - 默认拒绝删除有流水关联的账户；传 force=1/true 时先解除关联再删
 * - 需 confirm=1/true，防止误调用
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
