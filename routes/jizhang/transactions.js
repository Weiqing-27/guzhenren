const express = require('express');
const { authenticate } = require('../../middleware/auth');
const {
  monthRange,
  resolveLedgerFilter,
  resolveLedgerScope,
  applyLedgerScope,
  isFlowExpense,
} = require('../../utils/jizhangHelpers');
const router = express.Router();

router.use(authenticate);

async function getWriteLedgerId(supabase, userId, ledgerId) {
  const explicit = resolveLedgerFilter(ledgerId);
  if (explicit) return explicit;
  const { data } = await supabase
    .from('jz_user_settings')
    .select('current_ledger_id')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.current_ledger_id;
}

/** 空字符串不能写入 UUID 列（Postgres: invalid input syntax for type uuid: ""） */
function toUuidOrNull(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v || v === 'undefined' || v === 'null') return null;
  return v;
}

function normalizeAccountType(type) {
  return String(type || 'other').trim().toLowerCase();
}

function isCreditAccount(account) {
  return normalizeAccountType(account?.type) === 'credit';
}

async function getAccount(supabase, userId, accountId) {
  if (!accountId) return null;
  const { data } = await supabase
    .from('jz_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

/** 每次写入前重新读取余额，避免脏写 */
async function adjustAccountBalance(supabase, userId, accountId, delta) {
  if (!accountId || !delta) return;
  const account = await getAccount(supabase, userId, accountId);
  if (!account) {
    throw new Error('账户不存在');
  }
  const next = Number(account.balance || 0) + delta;
  const { error } = await supabase
    .from('jz_accounts')
    .update({ balance: next })
    .eq('id', accountId)
    .eq('user_id', userId);
  if (error) {
    throw new Error(error.message || '更新账户余额失败');
  }
}

/**
 * 根据流水调整账户余额：
 * - income + account_id：资产账户 +amount；信用账户视为还款 -amount
 * - expense + account_id：资产账户 -amount；信用账户为借款 +amount
 * - transfer：from -amount；to 若 credit 则负债 -amount，否则 +amount
 */
async function applyBalanceDelta(supabase, userId, tx, direction = 1) {
  const amount = Number(tx.amount) * direction;
  if (!amount) return;

  if (tx.type === 'transfer') {
    if (!tx.account_id || !tx.to_account_id) {
      throw new Error('转账还款缺少转出或还入账户，无法更新余额');
    }
    const from = await getAccount(supabase, userId, tx.account_id);
    const to = await getAccount(supabase, userId, tx.to_account_id);
    if (!from || !to) {
      throw new Error('转出或还入账户不存在');
    }
    await adjustAccountBalance(supabase, userId, from.id, -amount);
    // 还入信用账户：减少欠款；还入普通账户：增加资产
    const toDelta = isCreditAccount(to) ? -amount : amount;
    await adjustAccountBalance(supabase, userId, to.id, toDelta);
    return;
  }

  if (!tx.account_id) return;
  const account = await getAccount(supabase, userId, tx.account_id);
  if (!account) return;

  if (tx.type === 'income') {
    const delta = isCreditAccount(account) ? -amount : amount;
    await adjustAccountBalance(supabase, userId, account.id, delta);
  } else if (tx.type === 'expense') {
    const delta = isCreditAccount(account) ? amount : -amount;
    await adjustAccountBalance(supabase, userId, account.id, delta);
  }
}

router.get('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, date, year, month, page = 1, page_size = 50 } = req.query;
  const ledgerIds = await resolveLedgerScope(supabase, req.user.userId, ledger_id);

  let query = supabase
    .from('jz_transactions')
    .select('*', { count: 'exact' })
    .eq('user_id', req.user.userId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  query = applyLedgerScope(query, ledgerIds);
  if (date) query = query.eq('date', date);
  if (year && month) {
    const { start, end } = monthRange(year, month);
    query = query.gte('date', start).lte('date', end);
  }

  const start = (parseInt(page, 10) - 1) * parseInt(page_size, 10);
  query = query.range(start, start + parseInt(page_size, 10) - 1);

  const { data, error, count } = await query;

  if (error) {
    return res.status(500).json({ code: 500, message: '获取失败', error: error.message });
  }

  return res.json({
    code: 200,
    message: '获取成功',
    data: {
      list: data || [],
      total: count || 0,
      page: parseInt(page, 10),
      page_size: parseInt(page_size, 10),
      scope: ledgerIds ? 'ledger' : 'account',
    },
  });
});

router.get('/grouped', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, limit = 50 } = req.query;
  const ledgerIds = await resolveLedgerScope(supabase, req.user.userId, ledger_id);

  let query = supabase
    .from('jz_transactions')
    .select('*')
    .eq('user_id', req.user.userId)
    .order('date', { ascending: false })
    .limit(parseInt(limit, 10));

  query = applyLedgerScope(query, ledgerIds);

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ code: 500, message: '获取失败', error: error.message });
  }

  const map = new Map();
  (data || []).forEach((t) => {
    if (!map.has(t.date)) map.set(t.date, []);
    map.get(t.date).push(t);
  });

  const groups = Array.from(map.entries()).map(([date, items]) => {
    const income = items
      .filter((i) => i.type === 'income')
      .reduce((s, i) => s + Number(i.amount), 0);
    const expense = items
      .filter((i) => isFlowExpense(i.type))
      .reduce((s, i) => s + Number(i.amount), 0);
    return { date, income, expense, items };
  });

  return res.json({
    code: 200,
    message: '获取成功',
    data: groups,
    meta: { scope: ledgerIds ? 'ledger' : 'account' },
  });
});
router.post('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const {
    ledger_id,
    type,
    category_id,
    category_name,
    amount,
    note,
    icon,
    date,
    account_id,
    to_account_id,
  } = req.body;

  if (!type || !amount || !date) {
    return res.status(400).json({ code: 400, message: '类型、金额、日期为必填' });
  }

  if (!['income', 'expense', 'transfer'].includes(type)) {
    return res.status(400).json({ code: 400, message: '类型无效' });
  }

  if (type === 'transfer' && (!toUuidOrNull(account_id) || !toUuidOrNull(to_account_id))) {
    return res.status(400).json({ code: 400, message: '转账需指定转出和转入账户' });
  }

  const lid = await getWriteLedgerId(supabase, req.user.userId, ledger_id);
  if (!lid) {
    return res.status(400).json({ code: 400, message: '请先选择账本' });
  }

  const row = {
    user_id: req.user.userId,
    ledger_id: lid,
    type,
    category_id: type === 'transfer' ? null : toUuidOrNull(category_id),
    category_name: type === 'transfer' ? category_name || '转账还款' : category_name,
    amount: parseFloat(amount),
    note: note || category_name || (type === 'transfer' ? '转账还款' : ''),
    icon: icon || (type === 'transfer' ? '🔁' : null),
    date,
    account_id: toUuidOrNull(account_id),
    to_account_id: type === 'transfer' ? toUuidOrNull(to_account_id) : null,
  };

  const { data, error } = await supabase
    .from('jz_transactions')
    .insert(row)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ code: 500, message: '创建失败', error: error.message });
  }

  try {
    await applyBalanceDelta(supabase, req.user.userId, data, 1);
  } catch (e) {
    // 余额更新失败则回滚流水，避免「有还款记录但欠款不变」
    await supabase.from('jz_transactions').delete().eq('id', data.id).eq('user_id', req.user.userId);
    return res.status(500).json({
      code: 500,
      message: e.message || '账户余额更新失败，请检查转出/还入账户',
    });
  }

  return res.status(201).json({ code: 201, message: '记账成功', data });
});

router.put('/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;
  const {
    type,
    category_id,
    category_name,
    amount,
    note,
    icon,
    date,
    account_id,
    to_account_id,
  } = req.body;

  const { data: existing } = await supabase
    .from('jz_transactions')
    .select('*')
    .eq('id', id)
    .eq('user_id', req.user.userId)
    .maybeSingle();

  if (!existing) {
    return res.status(404).json({ code: 404, message: '记录不存在' });
  }

  try {
    await applyBalanceDelta(supabase, req.user.userId, existing, -1);
  } catch (e) {
    console.warn('回滚账户余额失败:', e.message);
  }

  const updatePayload = { updated_at: new Date().toISOString() };
  if (type !== undefined) updatePayload.type = type;
  if (category_id !== undefined) {
    updatePayload.category_id =
      (type || existing.type) === 'transfer' ? null : toUuidOrNull(category_id);
  }
  if (category_name !== undefined) updatePayload.category_name = category_name;
  if (amount !== undefined) updatePayload.amount = parseFloat(amount);
  if (note !== undefined) updatePayload.note = note;
  if (icon !== undefined) updatePayload.icon = icon;
  if (date !== undefined) updatePayload.date = date;
  if (account_id !== undefined) updatePayload.account_id = toUuidOrNull(account_id);
  if (to_account_id !== undefined) {
    updatePayload.to_account_id =
      (type || existing.type) === 'transfer' ? toUuidOrNull(to_account_id) : null;
  }

  const { data, error } = await supabase
    .from('jz_transactions')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', req.user.userId)
    .select()
    .single();

  if (error || !data) {
    return res.status(error ? 500 : 404).json({
      code: error ? 500 : 404,
      message: error ? '更新失败' : '记录不存在',
      error: error?.message,
    });
  }

  try {
    await applyBalanceDelta(supabase, req.user.userId, data, 1);
  } catch (e) {
    return res.status(500).json({
      code: 500,
      message: e.message || '账户余额更新失败',
    });
  }

  return res.json({ code: 200, message: '更新成功', data });
});

router.delete('/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;

  const { data: existing } = await supabase
    .from('jz_transactions')
    .select('*')
    .eq('id', id)
    .eq('user_id', req.user.userId)
    .maybeSingle();

  if (existing) {
    try {
      await applyBalanceDelta(supabase, req.user.userId, existing, -1);
    } catch (e) {
      console.warn('删除回滚账户余额失败:', e.message);
    }
  }

  const { error } = await supabase
    .from('jz_transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.userId);

  if (error) {
    return res.status(500).json({ code: 500, message: '删除失败', error: error.message });
  }

  return res.json({ code: 200, message: '删除成功' });
});

module.exports = router;
