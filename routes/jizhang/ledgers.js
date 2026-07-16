const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { resolveLedgerFilter } = require('../../utils/jizhangHelpers');
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

/**
 * 新建账本。默认不共享任何账本数据。
 * 可选 share_from_ledger_id：关联共享该账本的流水（列表/统计双向可见）。
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
