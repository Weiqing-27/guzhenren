const { verifyToken, extractTokenFromHeader } = require('../utils/jwt');

/**
 * 【功能描述】
 * 强制鉴权中间件：校验请求中的 JWT，并将用户信息挂到 req.user 后放行。
 *
 * 【业务逻辑】
 * 1. 读取 Authorization 头；缺失 → 401「尚未登录」；
 * 2. 用 extractTokenFromHeader 解析 token；解析失败 → 401「无效的认证格式」；
 * 3. 用 verifyToken 验签；失败/过期 → 401「无效的token」；
 * 4. 成功则写入 req.user = { userId, username, role }，再 next()；
 * 5. 未预期异常 → 500，并记录日志。
 *
 * 【技术实现】
 * - 涉及方法：extractTokenFromHeader()、verifyToken()、Express next()、res.status().json()
 * - 涉及知识点：Express 中间件链、JWT 无状态鉴权、请求对象挂载用户上下文、HTTP 401/500 语义
 */
function authenticate(req, res, next) {
  try {
    // 从请求头获取Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        code: 401,
        message: '尚未登录，请登录！',
        error: 'Authorization header is required'
      });
    }

    // 提取token
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return res.status(401).json({
        code: 401,
        message: '无效的认证格式',
        error: 'Invalid authorization format'
      });
    }

    // 验证token
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({
        code: 401,
        message: '无效的token',
        error: 'Invalid or expired token'
      });
    }

    // 将用户信息附加到请求对象
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role
    };

    next();
  } catch (error) {
    console.error('认证中间件错误:', error.message);
    return res.status(500).json({
      code: 500,
      message: '认证过程发生错误',
      error: error.message
    });
  }
}

/**
 * 【功能描述】
 * 可选鉴权中间件：有合法 token 则填充 req.user，无 token 或无效也不拦截请求。
 *
 * 【业务逻辑】
 * 1. 无 Authorization 头 → 直接 next()（游客访问）；
 * 2. 无法解析出 token → next()（不报错）；
 * 3. 验签成功 → 写入 req.user；失败则不写 req.user，仍 next()；
 * 4. 任意异常仅记日志，仍 next()，保证业务路由可继续处理公开资源。
 *
 * 【技术实现】
 * - 涉及方法：extractTokenFromHeader()、verifyToken()、Express next()
 * - 涉及知识点：可选认证（Optional Auth）、公开接口与登录态并存、中间件“软失败”不阻断链路
 */
function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return next();
    }

    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return next();
    }

    const decoded = verifyToken(token);

    if (decoded) {
      req.user = {
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role
      };
    }

    next();
  } catch (error) {
    console.error('可选认证中间件错误:', error.message);
    next();
  }
}

/**
 * 【功能描述】
 * 管理员权限中间件：要求当前请求已登录且角色为 admin。
 *
 * 【业务逻辑】
 * 1. 依赖前置 authenticate（或等价逻辑）已设置 req.user；
 * 2. 无 req.user → 401「需要登录」；
 * 3. role !== 'admin' → 403「权限不足」；
 * 4. 通过则 next()。
 *
 * 【技术实现】
 * - 涉及方法：Express next()、res.status().json()
 * - 涉及知识点：RBAC（基于角色的访问控制）、401 未认证 vs 403 已认证但无权限、中间件组合使用顺序
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      code: 401,
      message: '需要登录',
      error: 'Authentication required'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      code: 403,
      message: '权限不足',
      error: 'Admin role required'
    });
  }

  next();
}

module.exports = {
  authenticate,
  optionalAuth,
  requireAdmin
};
