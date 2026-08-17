const jwt = require('jsonwebtoken');

// JWT 签名密钥：优先读环境变量；未配置时使用开发占位值（生产务必设置 JWT_SECRET）
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here-change-in-production';

/**
 * 【功能描述】
 * 根据用户载荷签发 JWT，供登录/注册等接口返回给客户端。
 *
 * 【业务逻辑】
 * 1. 接收调用方传入的 payload（通常含 userId / username / role）；
 * 2. 使用项目统一的 JWT_SECRET 对载荷签名；
 * 3. 默认有效期 24 小时，可通过 expiresIn 覆盖；
 * 4. 返回完整 token 字符串，客户端后续放在 Authorization 头中携带。
 *
 * 【技术实现】
 * - 涉及方法：jsonwebtoken.jwt.sign()
 * - 涉及知识点：JWT（Header.Payload.Signature）结构、HMAC 对称签名、expiresIn 相对时间解析、环境变量配置密钥
 */
function generateToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/**
 * 【功能描述】
 * 校验 JWT 是否合法且未过期；成功返回解码载荷，失败返回 null。
 *
 * 【业务逻辑】
 * 1. 使用同一 JWT_SECRET 验证签名与过期时间；
 * 2. 验证成功：返回解码后的 payload 对象；
 * 3. 验证失败（伪造、过期、格式错误等）：打错误日志并返回 null，由调用方决定如何响应（通常 401）。
 *
 * 【技术实现】
 * - 涉及方法：jsonwebtoken.jwt.verify()、console.error()
 * - 涉及知识点：JWT 验签、Token 过期（exp claim）、失败时吞掉异常并返回 null 的“安全失败”模式
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
 * 【功能描述】
 * 从 HTTP Authorization 头中解析出原始 JWT 字符串。
 *
 * 【业务逻辑】
 * 1. 头为空 → 返回 null；
 * 2. 标准格式 `Bearer <token>`（空格分隔且前缀为 Bearer）→ 返回第二部分；
 * 3. 非标准但整段即为 token（历史兼容）→ 原样返回整段字符串。
 *
 * 【技术实现】
 * - 涉及方法：String.prototype.split()
 * - 涉及知识点：HTTP Authorization 头约定（RFC 6750 Bearer）、向后兼容的宽松解析策略
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
