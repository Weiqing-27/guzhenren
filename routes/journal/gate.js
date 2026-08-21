const express = require('express');
const bcrypt = require('bcrypt');
const { generateToken } = require('../../utils/jwt');
const {
  getDb,
  fail,
  ok,
  unwrapRequest,
  ensureDefaultCategories,
} = require('./helpers');

const router = express.Router();
router.use(unwrapRequest);

const pinAttempts = new Map();

/**
 * 【功能描述】
 * 内层口令尝试限流，降低暴力猜测风险。
 *
 * 【业务逻辑】
 * 同一用户 10 分钟内超过 5 次失败则暂时拒绝。
 *
 * 【技术实现】
 * - 涉及方法：Map 内存计数
 * - 涉及知识点：接口防爆破（进程内）
 */
function hitPinLimit(userId) {
  const now = Date.now();
  const rec = pinAttempts.get(userId) || { count: 0, until: 0 };
  if (rec.until && now < rec.until) return true;
  if (rec.until && now >= rec.until) {
    pinAttempts.set(userId, { count: 0, until: 0 });
    return false;
  }
  return false;
}

/**
 * 【功能描述】
 * 记录一次口令失败。
 *
 * 【业务逻辑】
 * 累计失败次数，达到阈值后锁定 10 分钟。
 *
 * 【技术实现】
 * - 涉及方法：Map.set
 * - 涉及知识点：失败计数
 */
function recordPinFail(userId) {
  const rec = pinAttempts.get(userId) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= 5) {
    rec.until = Date.now() + 10 * 60 * 1000;
  }
  pinAttempts.set(userId, rec);
}

/**
 * 【功能描述】
 * 内层入口：首次设置独立口令，或校验口令后签发 10 分钟短期令牌。
 *
 * 【业务逻辑】
 * 1. 无 vault_pin_hash 且提供 pin+confirmPin → 写入哈希并签发令牌；
 * 2. 已有哈希则只校验 pin，成功签发 aud=journal-scope 的短期 JWT；
 * 3. 失败文案统一为“口令不正确”，不暴露是否已设置、是否存在第二空间。
 *
 * 【技术实现】
 * - 涉及方法：bcrypt.hash/compare、generateToken
 * - 涉及知识点：登录密码与内层口令分离、短期令牌不落库
 */
router.post('/', async (req, res) => {
  const user = req.journalUser;
  const { pin, confirmPin } = req.body || {};
  if (!user) {
    return fail(res, 401, '尚未登录');
  }
  if (typeof pin !== 'string' || pin.length < 6) {
    return fail(res, 400, '口令不正确');
  }
  if (hitPinLimit(user.id)) {
    return fail(res, 429, '尝试过于频繁，请稍后再试');
  }

  const db = getDb(req);
  try {
    const { data: row, error } = await db
      .from('journal_users')
      .select('id, vault_pin_hash')
      .eq('id', user.id)
      .single();

    if (error || !row) {
      return fail(res, 401, '尚未登录');
    }

    if (!row.vault_pin_hash) {
      if (typeof confirmPin !== 'string' || pin !== confirmPin || pin.length < 6) {
        return fail(res, 400, '口令不正确');
      }
      const hash = await bcrypt.hash(pin, 10);
      const { error: updateError } = await db
        .from('journal_users')
        .update({ vault_pin_hash: hash, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (updateError) {
        console.error('写入口令失败:', updateError.message);
        return fail(res, 500, '操作失败');
      }
    } else {
      const matched = await bcrypt.compare(pin, row.vault_pin_hash);
      if (!matched) {
        recordPinFail(user.id);
        return fail(res, 400, '口令不正确');
      }
    }

    pinAttempts.delete(user.id);
    await ensureDefaultCategories(db, user.id, 'secret');

    const scopeToken = generateToken(
      { userId: user.id, aud: 'journal-scope', scope: 'inner' },
      '10m'
    );

    return ok(res, { scopeToken, expiresIn: 600 }, 'ok');
  } catch (error) {
    console.error('journal gate 异常:', error.message);
    return fail(res, 500, '操作失败');
  }
});

module.exports = router;
