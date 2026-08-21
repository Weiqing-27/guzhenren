const { verifyToken } = require('../../utils/jwt');
const {
  encryptTransport,
  decryptTransport,
  hmacSign,
  safeEqual,
} = require('../../utils/journalCrypto');

const SIGN_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_CATEGORIES = ['生活', '工作', '随笔', '旅行'];

/**
 * 【功能描述】
 * 获取可绕过 RLS 的 Supabase 客户端（优先 service_role）。
 *
 * 【业务逻辑】
 * journal 表开启 RLS 且无公开策略，必须用 supabaseAdmin 访问。
 *
 * 【技术实现】
 * - 涉及方法：req.app.get
 * - 涉及知识点：service_role 绕过 RLS
 */
function getDb(req) {
  return req.app.get('supabaseAdmin') || req.app.get('supabase');
}

/**
 * 【功能描述】
 * 统一失败响应（不加密，仅返回提示文案）。
 *
 * 【业务逻辑】
 * 错误信息不包含空间名称、id 列表等敏感痕迹。
 *
 * 【技术实现】
 * - 涉及方法：res.status().json
 * - 涉及知识点：错误脱敏
 */
function fail(res, status, message) {
  return res.status(status).json({ code: status, message, data: null });
}

/**
 * 【功能描述】
 * 统一成功响应：业务 data 经 AES 加密后再返回。
 *
 * 【业务逻辑】
 * 1. JSON 序列化 data；
 * 2. 传输层 AES 加密；
 * 3. 外层仅保留 code/message/密文。
 *
 * 【技术实现】
 * - 涉及方法：encryptTransport
 * - 涉及知识点：响应加密、不明文回传日记
 */
function ok(res, data, message = 'ok', status = 200) {
  const packed = encryptTransport(JSON.stringify(data === undefined ? null : data));
  return res.status(status).json({
    code: status === 201 ? 201 : 200,
    message,
    data: packed,
  });
}

/**
 * 【功能描述】
 * 校验请求签名，并解密 POST/PUT/PATCH/DELETE 的 payload。
 *
 * 【业务逻辑】
 * 1. 读取 X-Timestamp / X-Nonce / X-Sign；
 * 2. 校验 5 分钟时间窗；
 * 3. HMAC 校验 method+path，失败则拦截；
 * 4. 写操作解密 body.payload 覆盖 req.body。
 *
 * 【技术实现】
 * - 涉及方法：hmacSign、safeEqual、decryptTransport
 * - 涉及知识点：防篡改、防重放时间窗、请求信封
 */
function unwrapRequest(req, res, next) {
  const ts = req.headers['x-timestamp'];
  const nonce = req.headers['x-nonce'];
  const sign = req.headers['x-sign'];

  if (!ts || !nonce || !sign) {
    return fail(res, 400, '请求不合法');
  }

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > SIGN_WINDOW_MS) {
    return fail(res, 400, '请求已过期');
  }

  const path = String(req.originalUrl || '').split('?')[0];
  const base = `${ts}.${nonce}.${String(req.method || '').toUpperCase()}.${path}`;
  const expected = hmacSign(base);
  const incoming = String(sign).trim().toLowerCase();
  if (!safeEqual(expected, incoming)) {
    return fail(res, 400, '请求校验失败');
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const payload = req.body && req.body.payload;
    if (!payload) {
      return fail(res, 400, '请求不合法');
    }
    try {
      const plain = decryptTransport(payload);
      req.body = JSON.parse(plain || '{}');
    } catch (error) {
      console.error('journal 解密失败:', error.message);
      return fail(res, 400, '解密失败');
    }
  }

  return next();
}

/**
 * 【功能描述】
 * 解析当前读写空间：无有效短期令牌则强制 public。
 *
 * 【业务逻辑】
 * 1. 无 X-Scope-Token → public；
 * 2. 令牌无效/过期/用户不匹配 → expired，调用方应退出内层；
 * 3. 合法 inner 令牌 → secret，才允许读写内层日记。
 *
 * 【技术实现】
 * - 涉及方法：verifyToken
 * - 涉及知识点：短期作用域令牌、默认公开空间、失败不泄露细节
 */
function resolveSpace(req) {
  const token = req.headers['x-scope-token'];
  if (!token) {
    return { space: 'public', expired: false };
  }
  const decoded = verifyToken(token);
  if (
    !decoded ||
    decoded.aud !== 'journal-scope' ||
    decoded.scope !== 'inner' ||
    decoded.userId !== req.user.userId
  ) {
    return { space: 'public', expired: true };
  }
  return { space: 'secret', expired: false };
}

/**
 * 【功能描述】
 * 若客户端携带了过期/非法内层令牌，则返回会话失效。
 *
 * 【业务逻辑】
 * 用于已声明进入内层但令牌失效的请求，强制前端退回默认空间。
 *
 * 【技术实现】
 * - 涉及方法：resolveSpace、fail
 * - 涉及知识点：短期令牌失效即退出
 */
function rejectExpiredScope(req, res) {
  const { expired } = resolveSpace(req);
  if (expired) {
    fail(res, 440, '会话已失效');
    return true;
  }
  return false;
}

/**
 * 【功能描述】
 * 校验用户名与密码强度。
 *
 * 【业务逻辑】
 * 用户名 3-32 位字母数字下划线；密码至少 8 位且含字母与数字。
 *
 * 【技术实现】
 * - 涉及方法：RegExp.test
 * - 涉及知识点：注册校验
 */
function validateUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9_]{3,32}$/.test(username);
}

/**
 * 【功能描述】
 * 校验密码复杂度。
 *
 * 【业务逻辑】
 * 长度 ≥ 8，同时包含字母和数字。
 *
 * 【技术实现】
 * - 涉及方法：RegExp.test
 * - 涉及知识点：密码强度
 */
function validatePassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password)
  );
}

/**
 * 【功能描述】
 * 为指定空间写入默认分类（若不存在）。
 *
 * 【业务逻辑】
 * 注册时只种 public 分类；进入内层后再种 secret 分类，避免公开路径暴露第二套数据。
 *
 * 【技术实现】
 * - 涉及方法：supabase upsert
 * - 涉及知识点：按空间隔离分类
 */
async function ensureDefaultCategories(db, userId, spaceType) {
  const rows = DEFAULT_CATEGORIES.map((name) => ({
    user_id: userId,
    space_type: spaceType,
    name,
  }));
  const { error } = await db
    .from('journal_categories')
    .upsert(rows, { onConflict: 'user_id,space_type,name', ignoreDuplicates: true });
  if (error) {
    console.error('写入默认分类失败:', error.message);
  }
}

/**
 * 【功能描述】
 * 将库内日记行转为可下发给前端的对象（标题正文仍走传输加密通道）。
 *
 * 【业务逻辑】
 * 调用方先完成存储层解密，再传入 title/content 明文，本函数只做字段裁剪。
 *
 * 【技术实现】
 * - 涉及方法：对象映射
 * - 涉及知识点：DTO 转换
 */
function toEntryDto(row, title, content) {
  return {
    id: row.id,
    title,
    content,
    mood: row.mood || '',
    category: row.category || '',
    diaryDate: row.diary_date,
    isFavorite: !!row.is_favorite,
    isArchived: !!row.is_archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  getDb,
  fail,
  ok,
  unwrapRequest,
  resolveSpace,
  rejectExpiredScope,
  validateUsername,
  validatePassword,
  ensureDefaultCategories,
  toEntryDto,
};
