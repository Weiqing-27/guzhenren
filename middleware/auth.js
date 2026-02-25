const { verifyToken, extractTokenFromHeader } = require('../utils/jwt');

/**
 * 认证中间件 - 验证JWT token并设置用户信息
 */
function authenticate(req, res, next) {
  try {
    // 从请求头获取Authorization
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        code: 401,
        message: '缺少认证信息',
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
 * 可选认证中间件 - 如果有token则验证，没有则继续
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
 * 管理员权限验证中间件
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