const express = require('express');
const bcrypt = require('bcrypt');
const {
  getDb,
  fail,
  ok,
  unwrapRequest,
  resolveSpace,
  rejectExpiredScope,
  validatePassword,
} = require('./helpers');

const router = express.Router();
router.use(unwrapRequest);

/**
 * 【功能描述】
 * 个人中心资料：账号、注册时间、当前空间日记数与收藏数。
 *
 * 【业务逻辑】
 * 1. 默认只统计 public；持有有效内层令牌时才统计 secret；
 * 2. 公开空间接口绝不混入 secret 的数量或 id。
 *
 * 【技术实现】
 * - 涉及方法：supabase count head
 * - 涉及知识点：按 space_type 强制过滤统计
 */
router.get('/', async (req, res) => {
  if (rejectExpiredScope(req, res)) return;
  const { space } = resolveSpace(req);
  const db = getDb(req);
  const user = req.journalUser;

  try {
    const { count: total } = await db
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('space_type', space)
      .eq('is_archived', false);

    const { count: favoriteCount } = await db
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('space_type', space)
      .eq('is_favorite', true)
      .eq('is_archived', false);

    return ok(res, {
      userId: user.id,
      username: user.username,
      createdAt: user.created_at,
      lastLogin: user.last_login,
      autoSave: user.auto_save,
      encryptEnabled: user.encrypt_enabled,
      diaryCount: total || 0,
      favoriteCount: favoriteCount || 0,
    });
  } catch (error) {
    console.error('journal 资料异常:', error.message);
    return fail(res, 500, '获取资料失败');
  }
});

/**
 * 【功能描述】
 * 更新自动保存等偏好（不含任何第二空间文案字段）。
 *
 * 【业务逻辑】
 * 仅允许 autoSave / encryptEnabled 布尔值。
 *
 * 【技术实现】
 * - 涉及方法：supabase update
 * - 涉及知识点：隐私设置开关
 */
router.put('/settings', async (req, res) => {
  const user = req.journalUser;
  const { autoSave, encryptEnabled } = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  if (typeof autoSave === 'boolean') patch.auto_save = autoSave;
  if (typeof encryptEnabled === 'boolean') patch.encrypt_enabled = encryptEnabled;

  const db = getDb(req);
  try {
    const { data, error } = await db
      .from('journal_users')
      .update(patch)
      .eq('id', user.id)
      .select('auto_save, encrypt_enabled')
      .single();
    if (error) {
      return fail(res, 500, '保存失败');
    }
    return ok(res, {
      autoSave: data.auto_save,
      encryptEnabled: data.encrypt_enabled,
    }, '已保存');
  } catch (error) {
    console.error('journal 设置异常:', error.message);
    return fail(res, 500, '保存失败');
  }
});

/**
 * 【功能描述】
 * 修改登录密码：校验原密码后写入新 bcrypt 哈希。
 *
 * 【业务逻辑】
 * 全程走请求信封加密；内层口令不在此接口修改。
 *
 * 【技术实现】
 * - 涉及方法：bcrypt.compare/hash
 * - 涉及知识点：登录密码与内层口令分离
 */
router.put('/password', async (req, res) => {
  const user = req.journalUser;
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !validatePassword(newPassword)) {
    return fail(res, 400, '新密码至少 8 位，且同时包含字母和数字');
  }

  const db = getDb(req);
  try {
    const { data: row, error } = await db
      .from('journal_users')
      .select('password_hash')
      .eq('id', user.id)
      .single();
    if (error || !row) {
      return fail(res, 401, '尚未登录');
    }
    const matched = await bcrypt.compare(oldPassword, row.password_hash);
    if (!matched) {
      return fail(res, 400, '原密码不正确');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const { error: updateError } = await db
      .from('journal_users')
      .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (updateError) {
      return fail(res, 500, '修改失败');
    }
    return ok(res, true, '密码已更新');
  } catch (error) {
    console.error('journal 改密异常:', error.message);
    return fail(res, 500, '修改失败');
  }
});

module.exports = router;
