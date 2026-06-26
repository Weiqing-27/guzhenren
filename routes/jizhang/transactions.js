const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { monthRange } = require('../../utils/jizhangHelpers');
const router = express.Router();

router.use(authenticate);

async function getCurrentLedgerId(supabase, userId, ledgerId) {
  const id = ledgerId && ledgerId !== 'undefined' && ledgerId !== 'null' ? ledgerId : null;
  if (id) return id;
  const { data } = await supabase
    .from('jz_user_settings')
    .select('current_ledger_id')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.current_ledger_id;
}

router.get('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, date, year, month, page = 1, page_size = 50 } = req.query;

  const lid = await getCurrentLedgerId(supabase, req.user.userId, ledger_id);
  if (!lid) {
    return res.status(400).json({ code: 400, message: '请先创建或选择账本' });
  }

  let query = supabase
    .from('jz_transactions')
    .select('*', { count: 'exact' })
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

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
    },
  });
});

router.get('/grouped', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, limit = 50 } = req.query;
  const lid = await getCurrentLedgerId(supabase, req.user.userId, ledger_id);

  if (!lid) {
    return res.status(400).json({ code: 400, message: '请先选择账本' });
  }

  const { data, error } = await supabase
    .from('jz_transactions')
    .select('*')
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid)
    .order('date', { ascending: false })
    .limit(parseInt(limit, 10));

  if (error) {
    return res.status(500).json({ code: 500, message: '获取失败', error: error.message });
  }

  const map = new Map();
  (data || []).forEach((t) => {
    if (!map.has(t.date)) map.set(t.date, []);
    map.get(t.date).push(t);
  });

  const groups = Array.from(map.entries()).map(([date, items]) => {
    const income = items.filter((i) => i.type === 'income').reduce((s, i) => s + Number(i.amount), 0);
    const expense = items.filter((i) => i.type === 'expense').reduce((s, i) => s + Number(i.amount), 0);
    return { date, income, expense, items };
  });

  return res.json({ code: 200, message: '获取成功', data: groups });
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
  } = req.body;

  if (!type || !amount || !date) {
    return res.status(400).json({ code: 400, message: '类型、金额、日期为必填' });
  }

  const lid = await getCurrentLedgerId(supabase, req.user.userId, ledger_id);
  if (!lid) {
    return res.status(400).json({ code: 400, message: '请先选择账本' });
  }

  const { data, error } = await supabase
    .from('jz_transactions')
    .insert({
      user_id: req.user.userId,
      ledger_id: lid,
      type,
      category_id,
      category_name,
      amount: parseFloat(amount),
      note: note || category_name || '',
      icon,
      date,
      account_id,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ code: 500, message: '创建失败', error: error.message });
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
  } = req.body;

  const updatePayload = { updated_at: new Date().toISOString() };
  if (type !== undefined) updatePayload.type = type;
  if (category_id !== undefined) updatePayload.category_id = category_id;
  if (category_name !== undefined) updatePayload.category_name = category_name;
  if (amount !== undefined) updatePayload.amount = parseFloat(amount);
  if (note !== undefined) updatePayload.note = note;
  if (icon !== undefined) updatePayload.icon = icon;
  if (date !== undefined) updatePayload.date = date;
  if (account_id !== undefined) updatePayload.account_id = account_id;

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

  return res.json({ code: 200, message: '更新成功', data });
});

router.delete('/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { error } = await supabase
    .from('jz_transactions')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.userId);

  if (error) {
    return res.status(500).json({ code: 500, message: '删除失败', error: error.message });
  }

  return res.json({ code: 200, message: '删除成功' });
});

module.exports = router;
