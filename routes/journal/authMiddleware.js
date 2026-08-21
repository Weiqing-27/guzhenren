const { verifyToken, extractTokenFromHeader } = require('../../utils/jwt');
const { getDb, fail } = require('./helpers');

/**
 * 【功能描述】
 * 日记模块登录鉴权：校验 journal 受众 JWT，并加载 journal_users。
 *
 * 【业务逻辑】
 * 1. 解析 Authorization Bearer；
 * 2. 必须 aud=journal 且 role=journal，避免其它业务 token 穿透；
 * 3. 按 userId 读取 journal_users，不存在则 401。
 *
 * 【技术实现】
 * - 涉及方法：extractTokenFromHeader、verifyToken
 * - 涉及知识点：受众隔离、路由守卫服务端闭环
 */
async function journalAuth(req, res, next) {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    if (!token) {
      return fail(res, 401, '尚未登录');
    }
    const decoded = verifyToken(token);
    if (!decoded || decoded.aud !== 'journal' || decoded.role !== 'journal' || !decoded.userId) {
      return fail(res, 401, '登录已失效');
    }

    const db = getDb(req);
    const { data: user, error } = await db
      .from('journal_users')
      .select('id, username, auto_save, encrypt_enabled, created_at, last_login')
      .eq('id', decoded.userId)
      .maybeSingle();

    if (error || !user) {
      return fail(res, 401, '登录已失效');
    }

    req.user = { userId: user.id, username: user.username, role: 'journal' };
    req.journalUser = user;
    return next();
  } catch (error) {
    console.error('journalAuth 异常:', error.message);
    return fail(res, 500, '认证失败');
  }
}

module.exports = { journalAuth };
