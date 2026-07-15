const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { resolveLedgerFilter } = require('../../utils/jizhangHelpers');
const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { month } = req.query;
  const lid = resolveLedgerFilter(req.query.ledger_id);

  if (!month) {
    return res.status(400).json({ code: 400, message: 'month 为必填' });
  }

  let query = supabase
    .from('jz_budgets')
    .select('*')
    .eq('user_id', req.user.userId)
    .eq('month', month);

  if (lid) query = query.eq('ledger_id', lid);

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ code: 500, message: '获取失败', error: error.message });
  }

  return res.json({ code: 200, message: '获取成功', data: data || [] });
});

router.post('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { ledger_id, category_id, category_name, amount, month } = req.body;

  if (!category_id || !amount || !month) {
    return res.status(400).json({ code: 400, message: '分类、金额、月份为必填' });
  }

  let lid = ledger_id;
  if (!lid) {
    const { data: settings } = await supabase
      .from('jz_user_settings')
      .select('current_ledger_id')
      .eq('user_id', req.user.userId)
      .maybeSingle();
    lid = settings?.current_ledger_id;
  }

  const { data: existing } = await supabase
    .from('jz_budgets')
    .select('id')
    .eq('user_id', req.user.userId)
    .eq('ledger_id', lid)
    .eq('category_id', category_id)
    .eq('month', month)
    .maybeSingle();

  let data;
  let error;

  if (existing) {
    ({ data, error } = await supabase
      .from('jz_budgets')
      .update({ amount: parseFloat(amount), category_name })
      .eq('id', existing.id)
      .select()
      .single());
  } else {
    ({ data, error } = await supabase
      .from('jz_budgets')
      .insert({
        user_id: req.user.userId,
        ledger_id: lid,
        category_id,
        category_name,
        amount: parseFloat(amount),
        month,
      })
      .select()
      .single());
  }

  if (error) {
    return res.status(500).json({ code: 500, message: '设置失败', error: error.message });
  }

  return res.json({ code: 200, message: '设置成功', data });
});

module.exports = router;
