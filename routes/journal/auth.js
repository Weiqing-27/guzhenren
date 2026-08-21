const express = require('express');
const bcrypt = require('bcrypt');
const { generateToken, verifyToken, extractTokenFromHeader } = require('../../utils/jwt');
const {
  getDb,
  fail,
  ok,
  unwrapRequest,
  validateUsername,
  validatePassword,
  ensureDefaultCategories,
} = require('./helpers');

const router = express.Router();
router.use(unwrapRequest);

/**
 * 【功能描述】
 * 日记账号注册：账号唯一、密码强度校验、AES 传输解密后 bcrypt 落库。
 *
 * 【业务逻辑】
 * 1. 校验用户名格式与密码强度；
 * 2. 查询 journal_users 是否重名；
 * 3. bcrypt 哈希密码（不明文存储）；
 * 4. 写入用户并仅初始化 public 空间默认分类；
 * 5. 签发 journal 受众 JWT。
 *
 * 【技术实现】
 * - 涉及方法：bcrypt.hash、generateToken、ensureDefaultCategories
 * - 涉及知识点：独立账号体系、默认公开空间
 */
router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!validateUsername(username)) {
    return fail(res, 400, '账号需为 3-32 位字母、数字或下划线');
  }
  if (!validatePassword(password)) {
    return fail(res, 400, '密码至少 8 位，且同时包含字母和数字');
  }

  const db = getDb(req);
  try {
    const { data: exists, error: existError } = await db
      .from('journal_users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existError) {
      console.error('journal 注册查询失败:', existError.message);
      return fail(res, 500, '注册失败');
    }
    if (exists) {
      return fail(res, 400, '账号已存在');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { data: created, error: insertError } = await db
      .from('journal_users')
      .insert({
        username,
        password_hash: passwordHash,
      })
      .select('id, username, auto_save, encrypt_enabled, created_at')
      .single();

    if (insertError) {
      console.error('journal 注册写入失败:', insertError.message);
      return fail(res, 500, '注册失败');
    }

    await ensureDefaultCategories(db, created.id, 'public');

    const token = generateToken(
      { userId: created.id, username: created.username, role: 'journal', aud: 'journal' },
      '7d'
    );

    return ok(
      res,
      {
        userId: created.id,
        username: created.username,
        autoSave: created.auto_save,
        encryptEnabled: created.encrypt_enabled,
        createdAt: created.created_at,
        token,
      },
      '注册成功',
      201
    );
  } catch (error) {
    console.error('journal 注册异常:', error.message);
    return fail(res, 500, '服务器错误');
  }
});

/**
 * 【功能描述】
 * 账号密码登录，支持记住登录（更长 token 有效期）。
 *
 * 【业务逻辑】
 * 1. 按用户名查库；
 * 2. bcrypt 比对密码；
 * 3. 更新 last_login；
 * 4. remember=true 签发 7 天，否则 24 小时。
 *
 * 【技术实现】
 * - 涉及方法：bcrypt.compare、generateToken
 * - 涉及知识点：登录态时效可控、密码不明文传输（外层已解密）
 */
router.post('/login', async (req, res) => {
  const { username, password, remember } = req.body || {};
  if (!username || !password) {
    return fail(res, 400, '账号和密码不能为空');
  }

  const db = getDb(req);
  try {
    const { data: user, error } = await db
      .from('journal_users')
      .select('id, username, password_hash, auto_save, encrypt_enabled, created_at')
      .eq('username', username)
      .maybeSingle();

    if (error) {
      console.error('journal 登录查询失败:', error.message);
      return fail(res, 500, '登录失败');
    }
    if (!user) {
      return fail(res, 401, '账号或密码错误');
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return fail(res, 401, '账号或密码错误');
    }

    await db
      .from('journal_users')
      .update({ last_login: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', user.id);

    const token = generateToken(
      { userId: user.id, username: user.username, role: 'journal', aud: 'journal' },
      remember ? '7d' : '24h'
    );

    return ok(res, {
      userId: user.id,
      username: user.username,
      autoSave: user.auto_save,
      encryptEnabled: user.encrypt_enabled,
      createdAt: user.created_at,
      token,
      expiresIn: remember ? 7 * 24 * 3600 : 24 * 3600,
    }, '登录成功');
  } catch (error) {
    console.error('journal 登录异常:', error.message);
    return fail(res, 500, '服务器错误');
  }
});

/**
 * 【功能描述】
 * 刷新登录 token：校验旧 token 后签发新 token。
 *
 * 【业务逻辑】
 * 1. 从 Authorization 解析（此处 body.token 亦可）；
 * 2. 用户仍存在则换发同等有效期 token。
 *
 * 【技术实现】
 * - 涉及方法：generateToken
 * - 涉及知识点：token 续期
 */
router.post('/refresh', async (req, res) => {
  const raw = extractTokenFromHeader(req.headers.authorization);
  const decoded = raw ? verifyToken(raw) : null;
  if (!decoded || decoded.aud !== 'journal' || !decoded.userId) {
    return fail(res, 401, '登录已失效');
  }
  const db = getDb(req);
  const { data: user, error } = await db
    .from('journal_users')
    .select('id, username')
    .eq('id', decoded.userId)
    .maybeSingle();
  if (error || !user) {
    return fail(res, 401, '登录已失效');
  }
  const token = generateToken(
    { userId: user.id, username: user.username, role: 'journal', aud: 'journal' },
    '24h'
  );
  return ok(res, { token, expiresIn: 24 * 3600 }, '已刷新');
});

module.exports = router;
