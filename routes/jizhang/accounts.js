const express = require('express');
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

router.use(authenticate);

const ACCOUNT_TYPES = ['cash', 'bank', 'credit', 'other'];

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

  let assets = 0;
  let liabilities = 0;
  (data || []).forEach((a) => {
    const bal = Number(a.balance);
    if (a.type === 'credit') liabilities += Math.max(0, bal);
    else assets += Math.max(0, bal);
  });

  return res.json({
    code: 200,
    message: '获取成功',
    data: {
      list: data || [],
      total: assets - liabilities,
      totalAssets: assets,
      totalLiabilities: liabilities,
    },
  });
});

router.post('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { name, type, balance, icon } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ code: 400, message: '账户名称不能为空' });
  }

  const accountType = ACCOUNT_TYPES.includes(type) ? type : 'other';

  const { data, error } = await supabase
    .from('jz_accounts')
    .insert({
      user_id: req.user.userId,
      name: name.trim(),
      type: accountType,
      balance: parseFloat(balance || 0),
      icon: icon || '💳',
    })
    .select()
    .single();

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
  if (balance !== undefined) updatePayload.balance = parseFloat(balance);
  if (icon !== undefined) updatePayload.icon = icon;

  const { data, error } = await supabase
    .from('jz_accounts')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', req.user.userId)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ code: 404, message: '账户不存在' });
  }

  return res.json({ code: 200, message: '更新成功', data });
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
