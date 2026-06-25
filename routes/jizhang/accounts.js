const express = require('express');
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

router.use(authenticate);

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

  const total = (data || []).reduce((s, a) => s + Number(a.balance), 0);

  return res.json({ code: 200, message: '获取成功', data: { list: data || [], total } });
});

router.post('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { name, type, balance, icon } = req.body;

  if (!name) {
    return res.status(400).json({ code: 400, message: '账户名称不能为空' });
  }

  const { data, error } = await supabase
    .from('jz_accounts')
    .insert({
      user_id: req.user.userId,
      name,
      type: type || 'other',
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

module.exports = router;
