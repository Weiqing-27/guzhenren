const jwt = require('jsonwebtoken');

// JWT密钥（实际项目中应该从环境变量读取）
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here-change-in-production';

/**
 * 生成JWT token
 * @param {Object} payload - 要包含在token中的用户信息
 * @param {string} expiresIn - token过期时间，默认24小时
 * @returns {string} JWT token
 */
function generateToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/**
 * 验证JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} 解码后的用户信息，如果验证失败返回null
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('Token验证失败:', error.message);
    return null;
  }
}

/**
 * 从Authorization头中提取token
 * @param {string} authHeader - Authorization头的值
 * @returns {string|null} 提取的token，如果没有则返回null
 */
function extractTokenFromHeader(authHeader) {
  if (!authHeader) return null;
  
  // 支持 Bearer token 格式
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer') {
    return parts[1];
  }
  
  // 也支持直接传token的方式（向后兼容）
  return authHeader;
}

module.exports = {
  generateToken,
  verifyToken,
  extractTokenFromHeader
};