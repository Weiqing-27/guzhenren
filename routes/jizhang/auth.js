const express = require('express');
const { generateToken } = require('../../utils/jwt');
const {
  isValidEmail,
  isValidPhone,
  normalizePhone,
  ensureJizhangUser,
} = require('../../utils/jizhangHelpers');
const {
  deliverEmailOtp,
  deliverPhoneOtp,
  isEmailDeliveryConfigured,
  isPhoneDeliveryConfigured,
} = require('../../utils/jizhangOtpDelivery');
const {
  isWechatLoginConfigured,
  exchangeCodeForSession,
  buildWechatPseudoEmail,
} = require('../../utils/jizhangWechatAuth');

const router = express.Router();

/**
 * 【功能描述】
 * 生成 6 位数字 OTP 验证码。
 *
 * 【业务逻辑】
 * 1. 范围 100000–999999，用于本地邮件/短信验证码模式。
 *
 * 【技术实现】
 * - 涉及方法：generateOtpCode
 * - 涉及知识点：Math.random 六位整数
 */
function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * 【功能描述】
 * 读取 OTP 投递模式：local 或 supabase。
 *
 * 【业务逻辑】
 * 1. local=后端自管验证码 + 自建邮件/短信。
 * 2. supabase=Supabase Auth 邮件 OTP。
 * 3. 未配置或非法值默认 local。
 *
 * 【技术实现】
 * - 涉及方法：getOtpMode
 * - 涉及知识点：JIZHANG_OTP_MODE 环境变量
 */
function getOtpMode() {
  const mode = process.env.JIZHANG_OTP_MODE;
  if (mode === 'local' || mode === 'supabase') return mode;
  return 'local';
}

/**
 * 【功能描述】
 * 将 OTP 写入指定 OTP 表（邮箱或手机）。
 *
 * 【业务逻辑】
 * 1. 有效期 10 分钟；插入 email/phone、code、expires_at。
 *
 * 【技术实现】
 * - 涉及方法：saveOtp
 * - 涉及知识点：jz_email_otp / jz_phone_otp insert
 */
async function saveOtp(supabase, table, field, value, code) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await supabase.from(table).insert({
    [field]: value,
    code,
    expires_at: expiresAt,
  });
  if (error) throw error;
}

/**
 * 【功能描述】
 * 查找未使用且未过期的 OTP 记录。
 *
 * 【业务逻辑】
 * 1. 匹配 field+value+code，used=false，expires_at >= now。
 * 2. 取 created_at 最新一条。
 *
 * 【技术实现】
 * - 涉及方法：findOtp
 * - 涉及知识点：Supabase filter、maybeSingle
 */
async function findOtp(supabase, table, field, value, code) {
  const { data } = await supabase
    .from(table)
    .select('*')
    .eq(field, value)
    .eq('code', code)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * 【功能描述】
 * 按邮箱查找或创建 Supabase Auth 用户（Admin API）。
 *
 * 【业务逻辑】
 * 1. listUsers 首屏查找已有 email；无则 createUser email_confirm=true。
 *
 * 【技术实现】
 * - 涉及方法：createAuthUserByEmail
 * - 涉及知识点：admin.auth.admin.listUsers/createUser
 */
async function createAuthUserByEmail(admin, normalizedEmail) {
  const { data: listData } = await admin.auth.admin.listUsers();
  const existing = listData?.users?.find((u) => u.email === normalizedEmail);
  if (existing) return existing;

  const { data: created, error } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
  });
  if (error) throw error;
  return created.user;
}

/**
 * 【功能描述】
 * 按邮箱在 Auth 用户列表中查找用户（带分页兜底）。
 *
 * 【业务逻辑】
 * 1. 优先 listUsers({ email }) 过滤（部分 supabase-js 版本支持）。
 * 2. 失败则分页扫描最多 20 页，避免「已存在却查不到」。
 *
 * 【技术实现】
 * - 涉及方法：findAuthUserByEmail
 * - 涉及知识点：admin listUsers 分页、try/catch fallback
 */
async function findAuthUserByEmail(admin, email) {
  // 优先用带 email 过滤的 listUsers（部分 supabase-js 版本支持）
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 50, email });
    const hit = data?.users?.find((u) => u.email === email);
    if (hit) return hit;
  } catch {
    /* fallback below */
  }

  // 分页扫描兜底（避免默认只取第一页导致“已存在却查不到”）
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find((u) => u.email === email);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

/**
 * 【功能描述】
 * 为微信用户查找或创建 Supabase Auth 用户。
 *
 * 【业务逻辑】
 * 1. 用 buildWechatPseudoEmail(openid) 作邮箱标识。
 * 2. 先 findAuthUserByEmail；无则 createUser 带 wechat metadata。
 * 3. 并发/重复创建时再次查找或 generateLink 取回用户。
 *
 * 【技术实现】
 * - 涉及方法：createAuthUserByWechat
 * - 涉及知识点：user_metadata、generateLink magiclink、422 重复处理
 */
async function createAuthUserByWechat(admin, openid, unionid) {
  const pseudoEmail = buildWechatPseudoEmail(openid);

  // 先按伪邮箱查找，避免 listUsers 全量首屏遗漏
  const existing = await findAuthUserByEmail(admin, pseudoEmail);
  if (existing) return existing;

  const { data: created, error } = await admin.auth.admin.createUser({
    email: pseudoEmail,
    email_confirm: true,
    user_metadata: {
      wechat_openid: openid,
      wechat_unionid: unionid || undefined,
      login_type: 'wechat',
    },
  });

  if (!error && created?.user) return created.user;

  // 并发创建或邮箱已存在：再查一次 / 用 generateLink 取回用户
  const msg = String(error?.message || '');
  if (/already|registered|exists|duplicate/i.test(msg) || error?.status === 422) {
    const again = await findAuthUserByEmail(admin, pseudoEmail);
    if (again) return again;
    try {
      const { data: linkData } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: pseudoEmail,
      });
      if (linkData?.user) return linkData.user;
    } catch {
      /* ignore */
    }
  }

  throw error || new Error('创建微信用户失败');
}

/**
 * 【功能描述】
 * 按 wechat_openid 查找 jz_user_profiles。
 *
 * 【业务逻辑】
 * 1. 微信老用户登录时优先命中已有 profile，避免重复初始化。
 *
 * 【技术实现】
 * - 涉及方法：findProfileByWechatOpenid
 * - 涉及知识点：jz_user_profiles eq wechat_openid
 */
async function findProfileByWechatOpenid(supabase, openid) {
  const { data } = await supabase
    .from('jz_user_profiles')
    .select('*')
    .eq('wechat_openid', openid)
    .maybeSingle();
  return data;
}

/**
 * 【功能描述】
 * 按手机号查找或创建 Supabase Auth 用户。
 *
 * 【业务逻辑】
 * 1. listUsers 查找 phone 匹配用户；无则 createUser phone_confirm=true。
 *
 * 【技术实现】
 * - 涉及方法：createAuthUserByPhone
 * - 涉及知识点：admin createUser phone 字段
 */
async function createAuthUserByPhone(admin, phone) {
  const { data: listData } = await admin.auth.admin.listUsers();
  const existing = listData?.users?.find((u) => u.phone === phone);
  if (existing) return existing;

  const { data: created, error } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: true,
  });
  if (error) throw error;
  return created.user;
}

/**
 * 【功能描述】
 * 创建 Supabase Admin 客户端（service role）。
 *
 * 【业务逻辑】
 * 1. 需 SUPABASE_SERVICE_ROLE_KEY；用于 Auth Admin 与用户创建。
 *
 * 【技术实现】
 * - 涉及方法：getAdminClient
 * - 涉及知识点：createClient service role、禁用 session 持久化
 */
function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('需要配置 SUPABASE_SERVICE_ROLE_KEY');
  }
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * 【功能描述】
 * 组装登录成功响应：JWT、userInfo、needsProfileSetup。
 *
 * 【业务逻辑】
 * 1. generateToken 含 userId、identity、app=jizhang，有效期 30d。
 * 2. 伪邮箱 @wx.jizhang.local 不暴露给前端 userInfo.email。
 *
 * 【技术实现】
 * - 涉及方法：buildLoginResponse
 * - 涉及知识点：generateToken、profile_completed 判断
 */
function buildLoginResponse(authUser, profile, identity) {
  const appToken = generateToken({
    userId: authUser.id,
    ...identity,
    username: profile.nickname || identity.email?.split('@')[0] || identity.phone || '微信用户',
    role: 'user',
    app: 'jizhang',
  }, '30d');

  const userInfo = {
    userId: authUser.id,
    nickname: profile.nickname || '',
    avatar: profile.avatar_url || '',
    profileCompleted: !!profile.profile_completed,
    loginTime: Date.now(),
  };
  if (identity.email && !String(identity.email).endsWith('@wx.jizhang.local')) {
    userInfo.email = identity.email;
  }
  if (identity.phone) userInfo.phone = identity.phone;

  return {
    token: appToken,
    needsProfileSetup: !profile.profile_completed,
    userInfo,
  };
}

/**
 * 【功能描述】
 * 本地模式：生成、入库并投递邮箱 OTP。
 *
 * 【业务逻辑】
 * 1. saveOtp 至 jz_email_otp；调用 deliverEmailOtp。
 * 2. 开发环境未配置 SMTP 时在控制台打印 devCode。
 * 3. 生产未配置则抛错提示配置 SMTP/Resend 或 supabase 模式。
 *
 * 【技术实现】
 * - 涉及方法：sendLocalEmailOtp
 * - 涉及知识点：deliverEmailOtp、NODE_ENV 开发兜底
 */
async function sendLocalEmailOtp(supabase, normalizedEmail) {
  const code = generateOtpCode();
  await saveOtp(supabase, 'jz_email_otp', 'email', normalizedEmail, code);

  const isDev = process.env.NODE_ENV !== 'production';
  const delivered = await deliverEmailOtp(normalizedEmail, code);

  if (!delivered && isDev) {
    console.log(`[jizhang] 开发模式本地验证码 ${normalizedEmail}: ${code}`);
    return {
      channel: 'local_otp',
      message: `验证码: ${code}（开发模式，见后端控制台）`,
      devCode: code,
    };
  }

  if (!delivered) {
    throw new Error(
      '邮件发送未配置。请在 Vercel 配置 SMTP 或 Resend，或设置 JIZHANG_OTP_MODE=supabase 使用 Supabase 邮件',
    );
  }

  return {
    channel: delivered.channel,
    message: '验证码已发送至邮箱，请查收（含垃圾箱）',
  };
}

/**
 * 【功能描述】
 * 本地模式：生成、入库并投递手机 OTP。
 *
 * 【业务逻辑】
 * 1. saveOtp 至 jz_phone_otp；调用 deliverPhoneOtp（阿里云）。
 * 2. 开发环境未配置短信时在控制台打印 devCode。
 *
 * 【技术实现】
 * - 涉及方法：sendLocalPhoneOtp
 * - 涉及知识点：deliverPhoneOtp、开发模式兜底
 */
async function sendLocalPhoneOtp(supabase, phone) {
  const code = generateOtpCode();
  await saveOtp(supabase, 'jz_phone_otp', 'phone', phone, code);

  const isDev = process.env.NODE_ENV !== 'production';
  const delivered = await deliverPhoneOtp(phone, code);

  if (!delivered && isDev) {
    console.log(`[jizhang] 开发模式手机验证码 ${phone}: ${code}`);
    return {
      channel: 'local_otp',
      message: `验证码: ${code}（开发模式，见后端控制台）`,
      devCode: code,
    };
  }

  if (!delivered) {
    throw new Error('短信发送未配置。请在 Vercel 配置阿里云短信环境变量');
  }

  return {
    channel: delivered.channel,
    message: '验证码已发送至手机',
  };
}

/**
 * 【功能描述】
 * POST /send-code — 发送邮箱或手机验证码。
 *
 * 【业务逻辑】
 * 1. email 与 phone 二选一；手机走 sendLocalPhoneOtp。
 * 2. 邮箱：local 模式本地 OTP；supabase 模式 signInWithOtp，失败回退 local。
 *
 * 【技术实现】
 * - 涉及方法：router.post('/send-code')
 * - 涉及知识点：getOtpMode、supabase.auth.signInWithOtp
 */
router.post('/send-code', async (req, res) => {
  const { email, phone } = req.body;
  const supabase = req.app.get('supabase');
  const otpMode = getOtpMode();

  const usePhone = phone && !email;
  const useEmail = email && !phone;

  if (!usePhone && !useEmail) {
    return res.status(400).json({ code: 400, message: '请提供邮箱或手机号' });
  }

  if (usePhone) {
    const normalizedPhone = normalizePhone(phone);
    if (!isValidPhone(normalizedPhone)) {
      return res.status(400).json({ code: 400, message: '请输入有效的手机号' });
    }

    try {
      const result = await sendLocalPhoneOtp(supabase, normalizedPhone);
      return res.status(200).json({
        code: 200,
        message: result.message,
        data: {
          channel: result.channel,
          type: 'phone',
          ...(result.devCode ? { devCode: result.devCode } : {}),
        },
      });
    } catch (error) {
      console.error('发送手机验证码异常:', error);
      return res.status(500).json({ code: 500, message: error.message || '发送失败' });
    }
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ code: 400, message: '请输入有效的邮箱地址' });
  }

  try {
    if (otpMode === 'local') {
      const result = await sendLocalEmailOtp(supabase, normalizedEmail);
      return res.status(200).json({
        code: 200,
        message: result.message,
        data: {
          channel: result.channel,
          type: 'email',
          ...(result.devCode ? { devCode: result.devCode } : {}),
        },
      });
    }

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: true },
    });

    if (!otpError) {
      return res.status(200).json({
        code: 200,
        message: '验证码已发送至邮箱，请查收（含垃圾箱）',
        data: { channel: 'supabase_auth', type: 'email' },
      });
    }

    console.warn('Supabase Auth OTP 失败，回退本地邮件:', otpError.message);
    const result = await sendLocalEmailOtp(supabase, normalizedEmail);
    return res.status(200).json({
      code: 200,
      message: result.message,
      data: {
        channel: result.channel,
        type: 'email',
        ...(result.devCode ? { devCode: result.devCode } : {}),
      },
    });
  } catch (error) {
    console.error('发送邮箱验证码异常:', error);
    return res.status(500).json({ code: 500, message: error.message || '发送验证码失败' });
  }
});

/**
 * 【功能描述】
 * POST /verify-code — 校验 OTP 并完成登录。
 *
 * 【业务逻辑】
 * 1. 手机：本地 jz_phone_otp 校验 → createAuthUserByPhone → ensureJizhangUser。
 * 2. 邮箱：优先本地 jz_email_otp；否则 supabase verifyOtp。
 * 3. 返回 buildLoginResponse（token + userInfo）。
 *
 * 【技术实现】
 * - 涉及方法：router.post('/verify-code')
 * - 涉及知识点：findOtp、verifyOtp、getAdminClient
 */
router.post('/verify-code', async (req, res) => {
  const { email, phone, code } = req.body;
  const supabase = req.app.get('supabase');

  if (!code) {
    return res.status(400).json({ code: 400, message: '验证码不能为空' });
  }

  const tokenCode = String(code).trim();
  const usePhone = phone && !email;
  const useEmail = email && !phone;

  if (!usePhone && !useEmail) {
    return res.status(400).json({ code: 400, message: '请提供邮箱或手机号' });
  }

  try {
    let authUser = null;

    if (usePhone) {
      const normalizedPhone = normalizePhone(phone);
      if (!isValidPhone(normalizedPhone)) {
        return res.status(400).json({ code: 400, message: '请输入有效的手机号' });
      }

      const otpRow = await findOtp(supabase, 'jz_phone_otp', 'phone', normalizedPhone, tokenCode);
      if (!otpRow) {
        return res.status(401).json({ code: 401, message: '验证码错误或已过期' });
      }

      await supabase.from('jz_phone_otp').update({ used: true }).eq('id', otpRow.id);
      const admin = getAdminClient();
      authUser = await createAuthUserByPhone(admin, normalizedPhone);
      const profile = await ensureJizhangUser(supabase, authUser);

      return res.status(200).json({
        code: 200,
        message: '登录成功',
        data: buildLoginResponse(authUser, profile, { phone: normalizedPhone }),
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const otpRow = await findOtp(supabase, 'jz_email_otp', 'email', normalizedEmail, tokenCode);

    if (otpRow) {
      await supabase.from('jz_email_otp').update({ used: true }).eq('id', otpRow.id);
      const admin = getAdminClient();
      authUser = await createAuthUserByEmail(admin, normalizedEmail);
    } else {
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: tokenCode,
        type: 'email',
      });

      if (verifyError || !verifyData?.user) {
        return res.status(401).json({ code: 401, message: '验证码错误或已过期' });
      }
      authUser = verifyData.user;
    }

    const profile = await ensureJizhangUser(supabase, authUser);

    return res.status(200).json({
      code: 200,
      message: '登录成功',
      data: buildLoginResponse(authUser, profile, { email: normalizedEmail }),
    });
  } catch (error) {
    console.error('验证码登录异常:', error);
    return res.status(500).json({ code: 500, message: error.message || '登录失败' });
  }
});

/**
 * 【功能描述】
 * POST /wechat-login — 微信小程序 code 登录。
 *
 * 【业务逻辑】
 * 1. exchangeCodeForSession 换 openid；查 profile 或 createAuthUserByWechat。
 * 2. 老用户补写 wechat_openid；返回 buildLoginResponse。
 *
 * 【技术实现】
 * - 涉及方法：router.post('/wechat-login')
 * - 涉及知识点：exchangeCodeForSession、ensureJizhangUser 微信 options
 */
router.post('/wechat-login', async (req, res) => {
  const { code } = req.body;
  const supabase = req.app.get('supabase');

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ code: 400, message: '缺少微信登录凭证 code' });
  }

  if (!isWechatLoginConfigured()) {
    return res.status(503).json({ code: 503, message: '微信登录未配置' });
  }

  try {
    const session = await exchangeCodeForSession(code.trim());
    const { openid, unionid } = session;

    let profile = await findProfileByWechatOpenid(supabase, openid);
    let authUser;

    if (profile) {
      authUser = { id: profile.id, email: profile.email };
    } else {
      const admin = getAdminClient();
      authUser = await createAuthUserByWechat(admin, openid, unionid);
      profile = await ensureJizhangUser(supabase, authUser, {
        pseudoEmail: buildWechatPseudoEmail(openid),
        wechat_openid: openid,
        wechat_unionid: unionid,
      });
    }

    if (profile && !profile.wechat_openid) {
      await supabase
        .from('jz_user_profiles')
        .update({
          wechat_openid: openid,
          ...(unionid ? { wechat_unionid: unionid } : {}),
        })
        .eq('id', profile.id);
    }

    return res.status(200).json({
      code: 200,
      message: '登录成功',
      data: buildLoginResponse(authUser, profile, { wechat: true }),
    });
  } catch (error) {
    console.error('微信登录异常:', error);
    return res.status(500).json({ code: 500, message: error.message || '微信登录失败' });
  }
});

/**
 * 【功能描述】
 * GET /methods — 返回客户端可用的登录方式与投递能力。
 *
 * 【业务逻辑】
 * 1. email 恒 true；phone/wechat 依配置；emailDelivery 含 supabase 模式。
 * 2. 异常时降级返回保守默认值，避免前端崩溃。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/methods')
 * - 涉及知识点：isPhoneDeliveryConfigured、isWechatLoginConfigured、getOtpMode
 */
router.get('/methods', (req, res) => {
  try {
    res.json({
      code: 200,
      data: {
        email: true,
        phone: isPhoneDeliveryConfigured(),
        wechat: isWechatLoginConfigured(),
        emailDelivery: isEmailDeliveryConfigured() || getOtpMode() === 'supabase',
      },
    });
  } catch (error) {
    console.error('auth/methods error:', error);
    res.json({
      code: 200,
      data: { email: true, phone: false, wechat: false, emailDelivery: false },
    });
  }
});

module.exports = router;
