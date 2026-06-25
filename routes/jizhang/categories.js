const express = require('express');
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res) => {
  const { type } = req.query;
  const supabase = req.app.get('supabase');

  let query = supabase
    .from('jz_categories')
    .select('*')
    .or(`user_id.eq.${req.user.userId},user_id.is.null`)
    .order('created_at', { ascending: true });

  if (type) query = query.eq('type', type);

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ code: 500, message: '获取分类失败', error: error.message });
  }

  return res.json({ code: 200, message: '获取成功', data: data || [] });
});

router.post('/', async (req, res) => {
  const { name, type, icon, color } = req.body;
  const supabase = req.app.get('supabase');

  if (!name || !type) {
    return res.status(400).json({ code: 400, message: '名称和类型不能为空' });
  }

  const { data, error } = await supabase
    .from('jz_categories')
    .insert({
      user_id: req.user.userId,
      name,
      type,
      icon: icon || '📦',
      color: color || '#9CA3AF',
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ code: 500, message: '创建失败', error: error.message });
  }

  return res.status(201).json({ code: 201, message: '创建成功', data });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  const { data, error } = await supabase
    .from('jz_categories')
    .update(req.body)
    .eq('id', id)
    .eq('user_id', req.user.userId)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ code: 404, message: '分类不存在或不可编辑' });
  }

  return res.json({ code: 200, message: '更新成功', data });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  const { count } = await supabase
    .from('jz_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', id);

  if (count > 0) {
    return res.status(400).json({ code: 400, message: '分类下有账单，无法删除' });
  }

  const { error } = await supabase
    .from('jz_categories')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.userId);

  if (error) {
    return res.status(500).json({ code: 500, message: '删除失败', error: error.message });
  }

  return res.json({ code: 200, message: '删除成功' });
});

module.exports = router;
