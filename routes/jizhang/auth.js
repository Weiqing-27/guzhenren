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

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** local=后端自管验证码 + 自建邮件/短信 | supabase=Supabase Auth 邮件 */
function getOtpMode() {
  const mode = process.env.JIZHANG_OTP_MODE;
  if (mode === 'local' || mode === 'supabase') return mode;
  return 'local';
}

async function saveOtp(supabase, table, field, value, code) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await supabase.from(table).insert({
    [field]: value,
    code,
    expires_at: expiresAt,
  });
  if (error) throw error;
}

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

async function createAuthUserByWechat(admin, openid, unionid) {
  const pseudoEmail = buildWechatPseudoEmail(openid);
  const { data: listData } = await admin.auth.admin.listUsers();
  const existing =
    listData?.users?.find((u) => u.email === pseudoEmail) ||
    listData?.users?.find((u) => u.user_metadata?.wechat_openid === openid);
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
  if (error) throw error;
  return created.user;
}

async function findProfileByWechatOpenid(supabase, openid) {
  const { data } = await supabase
    .from('jz_user_profiles')
    .select('*')
    .eq('wechat_openid', openid)
    .maybeSingle();
  return data;
}

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
