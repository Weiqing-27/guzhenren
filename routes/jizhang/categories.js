const express = require('express');
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

router.use(authenticate);

/**
 * 【功能描述】
 * GET / — 获取当前用户可用分类列表（含系统预设）。
 *
 * 【业务逻辑】
 * 1. 返回 user_id 等于当前用户或 user_id 为 null 的系统分类。
 * 2. 可选 query type 过滤 income/expense。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/')
 * - 涉及知识点：Supabase or 过滤、authenticate 中间件
 */
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

/**
 * 【功能描述】
 * POST / — 创建用户自定义分类。
 *
 * 【业务逻辑】
 * 1. name、type 必填；icon/color 有默认值。
 * 2. 分类归属当前用户，不影响系统预设。
 *
 * 【技术实现】
 * - 涉及方法：router.post('/')
 * - 涉及知识点：jz_categories insert
 */
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

/**
 * 【功能描述】
 * PUT /:id — 更新用户自有分类。
 *
 * 【业务逻辑】
 * 1. 仅能更新 user_id 匹配当前用户的记录。
 * 2. 系统分类（user_id null）不可编辑。
 *
 * 【技术实现】
 * - 涉及方法：router.put('/:id')
 * - 涉及知识点：update + eq user_id 双重约束
 */
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

/**
 * 【功能描述】
 * DELETE /:id — 删除用户自有分类。
 *
 * 【业务逻辑】
 * 1. 分类下有关联流水时拒绝删除。
 * 2. 仅删除属于当前用户的分类。
 *
 * 【技术实现】
 * - 涉及方法：router.delete('/:id')
 * - 涉及知识点：count 关联检查、delete 带 user_id
 */
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
