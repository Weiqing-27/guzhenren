const crypto = require('crypto');

const AES_PASSPHRASE = process.env.DIARY_AES_KEY || 'diary-dev-aes-key-change-me';
const HMAC_PASSPHRASE = process.env.DIARY_HMAC_KEY || 'diary-dev-hmac-key-change-me';
const STORAGE_PASSPHRASE = process.env.DIARY_STORAGE_KEY || 'diary-dev-storage-key-change-me';
const VAULT_PASSPHRASE = process.env.DIARY_VAULT_STORAGE_KEY || 'diary-dev-vault-storage-key-change-me';

const TRANSPORT_KEY = crypto.createHash('sha256').update(AES_PASSPHRASE).digest();
const STORAGE_KEY = crypto.createHash('sha256').update(STORAGE_PASSPHRASE).digest();
const VAULT_KEY = crypto.createHash('sha256').update(VAULT_PASSPHRASE).digest();

/**
 * 【功能描述】
 * 使用 AES-256-CBC 加密字符串，输出 `ivHex:base64` 便于前后端互通。
 *
 * 【业务逻辑】
 * 1. 随机 16 字节 IV；
 * 2. 以 SHA-256(口令) 作为 32 字节密钥加密 UTF-8 明文；
 * 3. 拼接 IV 与密文，供传输或落库。
 *
 * 【技术实现】
 * - 涉及方法：crypto.createCipheriv、randomBytes
 * - 涉及知识点：AES-256-CBC、PKCS#7、IV 前置
 */
function encryptWithKey(plain, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain ?? ''), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('base64')}`;
}

/**
 * 【功能描述】
 * 解密 `ivHex:base64` 格式的 AES-256-CBC 密文。
 *
 * 【业务逻辑】
 * 1. 拆分 IV 与密文；
 * 2. 用对应 32 字节密钥解密；
 * 3. 失败抛错，由调用方转成统一“解密失败”响应。
 *
 * 【技术实现】
 * - 涉及方法：crypto.createDecipheriv
 * - 涉及知识点：对称解密、密钥隔离（传输密钥 / 存储密钥 / 内层密钥）
 */
function decryptWithKey(packed, key) {
  if (!packed || typeof packed !== 'string' || !packed.includes(':')) {
    throw new Error('invalid cipher');
  }
  const idx = packed.indexOf(':');
  const iv = Buffer.from(packed.slice(0, idx), 'hex');
  const data = Buffer.from(packed.slice(idx + 1), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * 【功能描述】
 * 传输层加密：请求体/响应 data 使用统一传输密钥。
 *
 * 【业务逻辑】
 * 明文进、密文出，前后端共用 DIARY_AES_KEY。
 *
 * 【技术实现】
 * - 涉及方法：encryptWithKey
 * - 涉及知识点：传输加密与存储加密密钥分离
 */
function encryptTransport(plain) {
  return encryptWithKey(plain, TRANSPORT_KEY);
}

/**
 * 【功能描述】
 * 传输层解密。
 *
 * 【业务逻辑】
 * 解密客户端 payload，得到 JSON 字符串。
 *
 * 【技术实现】
 * - 涉及方法：decryptWithKey
 * - 涉及知识点：AES-256-CBC 互通（CryptoJS SHA256 原始密钥）
 */
function decryptTransport(packed) {
  return decryptWithKey(packed, TRANSPORT_KEY);
}

/**
 * 【功能描述】
 * 按空间选择存储密钥并加密日记标题/正文。
 *
 * 【业务逻辑】
 * 1. public 使用 DIARY_STORAGE_KEY；
 * 2. secret 使用更高等级 DIARY_VAULT_STORAGE_KEY（AES-256）；
 * 3. 数据库只保存密文。
 *
 * 【技术实现】
 * - 涉及方法：encryptWithKey
 * - 涉及知识点：双空间密钥隔离
 */
function encryptStorage(plain, spaceType) {
  const key = spaceType === 'secret' ? VAULT_KEY : STORAGE_KEY;
  return encryptWithKey(plain, key);
}

/**
 * 【功能描述】
 * 按空间解密库内标题/正文，仅在内存中短暂存在。
 *
 * 【业务逻辑】
 * 读出密文 → 解密 → 再交给传输层加密返回客户端。
 *
 * 【技术实现】
 * - 涉及方法：decryptWithKey
 * - 涉及知识点：服务端不落明文
 */
function decryptStorage(packed, spaceType) {
  const key = spaceType === 'secret' ? VAULT_KEY : STORAGE_KEY;
  return decryptWithKey(packed, key);
}

/**
 * 【功能描述】
 * 计算请求 HMAC-SHA256 签名。
 *
 * 【业务逻辑】
 * 对 `ts.nonce.METHOD.path` 签名，防止参数篡改。
 *
 * 【技术实现】
 * - 涉及方法：crypto.createHmac
 * - 涉及知识点：HMAC-SHA256、请求防篡改
 */
function hmacSign(text) {
  return crypto.createHmac('sha256', HMAC_PASSPHRASE).update(String(text)).digest('hex');
}

/**
 * 【功能描述】
 * 恒定时间比较两个十六进制签名，避免时序侧信道。
 *
 * 【业务逻辑】
 * 长度不同直接 false；长度相同则 timingSafeEqual。
 *
 * 【技术实现】
 * - 涉及方法：crypto.timingSafeEqual
 * - 涉及知识点：时序安全比较
 */
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  encryptTransport,
  decryptTransport,
  encryptStorage,
  decryptStorage,
  hmacSign,
  safeEqual,
};
