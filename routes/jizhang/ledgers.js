const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { resolveLedgerFilter } = require('../../utils/jizhangHelpers');
const router = express.Router();

router.use(authenticate);

/**
 * 【功能描述】
 * GET / — 获取当前用户全部账本列表。
 *
 * 【业务逻辑】
 * 1. 按 created_at 升序返回用户拥有的所有账本。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/')
 * - 涉及知识点：jz_ledgers select + eq user_id
 */
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

/**
 * 【功能描述】
 * POST / — 新建账本，可选关联共享源账本。
 *
 * 【业务逻辑】
 * 1. name 必填；默认不共享任何账本数据。
 * 2. 可选 share_from_ledger_id：关联后列表/统计与源账本流水双向可见。
 * 3. 未执行 share 迁移时降级为普通创建并提示 SQL。
 *
 * 【技术实现】
 * - 涉及方法：router.post('/')
 * - 涉及知识点：resolveLedgerFilter、insert 兼容降级
 */
router.post('/', async (req, res) => {
  const { name, icon, color, share_from_ledger_id, shareFromLedgerId } = req.body;
  const supabase = req.app.get('supabase');

  if (!name?.trim()) {
    return res.status(400).json({ code: 400, message: '账本名称不能为空' });
  }

  const shareFrom = resolveLedgerFilter(share_from_ledger_id || shareFromLedgerId);
  if (shareFrom) {
    const { data: src } = await supabase
      .from('jz_ledgers')
      .select('id')
      .eq('id', shareFrom)
      .eq('user_id', req.user.userId)
      .maybeSingle();
    if (!src) {
      return res.status(400).json({ code: 400, message: '要关联的账本不存在' });
    }
  }

  const insertRow = {
    user_id: req.user.userId,
    name: name.trim(),
    icon: icon || '📗',
    color: color || '#10B981',
    is_default: false,
  };
  if (shareFrom) {
    insertRow.share_from_ledger_id = shareFrom;
  }

  const { data, error } = await supabase
    .from('jz_ledgers')
    .insert(insertRow)
    .select()
    .single();

  if (error) {
    // 兼容未执行 alter-jizhang-ledger-share.sql 的环境
    if (shareFrom && /share_from_ledger_id/i.test(error.message || '')) {
      const { data: fallback, error: err2 } = await supabase
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
      if (err2) {
        return res.status(500).json({ code: 500, message: '创建账本失败', error: err2.message });
      }
      return res.status(201).json({
        code: 201,
        message: '创建成功（未启用共享字段，请执行 alter-jizhang-ledger-share.sql）',
        data: fallback,
      });
    }
    return res.status(500).json({ code: 500, message: '创建账本失败', error: error.message });
  }

  return res.status(201).json({ code: 201, message: '创建成功', data });
});

/**
 * 【功能描述】
 * PUT /:id — 更新账本名称、图标、颜色或共享关联。
 *
 * 【业务逻辑】
 * 1. 仅更新属于当前用户的账本。
 * 2. share_from_ledger_id 可置 null 解除关联；不可关联自身。
 *
 * 【技术实现】
 * - 涉及方法：router.put('/:id')
 * - 涉及知识点：patch 对象组装、resolveLedgerFilter
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, icon, color, share_from_ledger_id, shareFromLedgerId } = req.body;
  const supabase = req.app.get('supabase');

  const patch = {};
  if (name !== undefined) patch.name = name;
  if (icon !== undefined) patch.icon = icon;
  if (color !== undefined) patch.color = color;

  if (share_from_ledger_id !== undefined || shareFromLedgerId !== undefined) {
    const raw = share_from_ledger_id !== undefined ? share_from_ledger_id : shareFromLedgerId;
    if (raw === null || raw === '' || raw === false) {
      patch.share_from_ledger_id = null;
    } else {
      const shareFrom = resolveLedgerFilter(raw);
      if (shareFrom === id) {
        return res.status(400).json({ code: 400, message: '不能关联自身' });
      }
      if (shareFrom) {
        const { data: src } = await supabase
          .from('jz_ledgers')
          .select('id')
          .eq('id', shareFrom)
          .eq('user_id', req.user.userId)
          .maybeSingle();
        if (!src) {
          return res.status(400).json({ code: 400, message: '要关联的账本不存在' });
        }
        patch.share_from_ledger_id = shareFrom;
      }
    }
  }

  const { data, error } = await supabase
    .from('jz_ledgers')
    .update(patch)
    .eq('id', id)
    .eq('user_id', req.user.userId)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ code: 404, message: '账本不存在' });
  }

  return res.json({ code: 200, message: '更新成功', data });
});

/**
 * 【功能描述】
 * POST /switch/:id — 切换用户当前使用的账本。
 *
 * 【业务逻辑】
 * 1. 校验账本归属当前用户。
 * 2. upsert jz_user_settings.current_ledger_id。
 *
 * 【技术实现】
 * - 涉及方法：router.post('/switch/:id')
 * - 涉及知识点：upsert user_settings
 */
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

/**
 * 【功能描述】
 * DELETE /:id — 删除无流水关联的账本。
 *
 * 【业务逻辑】
 * 1. 账本下存在流水时拒绝删除。
 * 2. 仅删除属于当前用户的账本。
 *
 * 【技术实现】
 * - 涉及方法：router.delete('/:id')
 * - 涉及知识点：count 关联检查
 */
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
