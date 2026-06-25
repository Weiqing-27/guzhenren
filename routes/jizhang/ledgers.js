const express = require('express');
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { data, error } = await supabase
    .from('jz_ledgers')
    .select('*')
    .eq('user_id', req.user.userId)
    .order('created_at', { ascending: true });

  if (error) {
    return res.status(500).json({ code: 500, message: '获取账本失败', error: error.message });
  }

  return res.json({ code: 200, message: '获取账本成功', data: data || [] });
});

router.post('/', async (req, res) => {
  const { name, icon, color } = req.body;
  const supabase = req.app.get('supabase');

  if (!name?.trim()) {
    return res.status(400).json({ code: 400, message: '账本名称不能为空' });
  }

  const { data, error } = await supabase
    .from('jz_ledgers')
    .insert({
      user_id: req.user.userId,
      name: name.trim(),
      icon: icon || '📗',
      color: color || '#10B981',
      is_default: false,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ code: 500, message: '创建账本失败', error: error.message });
  }

  return res.status(201).json({ code: 201, message: '创建成功', data });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, icon, color } = req.body;
  const supabase = req.app.get('supabase');

  const { data, error } = await supabase
    .from('jz_ledgers')
    .update({ name, icon, color })
    .eq('id', id)
    .eq('user_id', req.user.userId)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ code: 404, message: '账本不存在' });
  }

  return res.json({ code: 200, message: '更新成功', data });
});

router.post('/switch/:id', async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  const { data: ledger } = await supabase
    .from('jz_ledgers')
    .select('id')
    .eq('id', id)
    .eq('user_id', req.user.userId)
    .maybeSingle();

  if (!ledger) {
    return res.status(404).json({ code: 404, message: '账本不存在' });
  }

  await supabase
    .from('jz_user_settings')
    .upsert({
      user_id: req.user.userId,
      current_ledger_id: id,
      updated_at: new Date().toISOString(),
    });

  return res.json({ code: 200, message: '已切换账本', data: { currentLedgerId: id } });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  const { count } = await supabase
    .from('jz_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('ledger_id', id)
    .eq('user_id', req.user.userId);

  if (count > 0) {
    return res.status(400).json({ code: 400, message: '账本下有账单，无法删除' });
  }

  const { error } = await supabase
    .from('jz_ledgers')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.userId);

  if (error) {
    return res.status(500).json({ code: 500, message: '删除失败', error: error.message });
  }

  return res.json({ code: 200, message: '删除成功' });
});

module.exports = router;
