const express = require('express');
const { generateToken } = require('../../utils/jwt');
const { isValidEmail, ensureJizhangUser } = require('../../utils/jizhangHelpers');

const router = express.Router();

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** local=后端自管验证码(开发推荐) | supabase=Supabase Auth 邮件 */
function getOtpMode() {
  const mode = process.env.JIZHANG_OTP_MODE;
  if (mode === 'local' || mode === 'supabase') return mode;
  return process.env.NODE_ENV === 'production' ? 'supabase' : 'local';
}

async function sendLocalOtp(supabase, normalizedEmail) {
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await supabase.from('jz_email_otp').insert({
    email: normalizedEmail,
    code,
    expires_at: expiresAt,
  });

  if (error) throw error;

  console.log(`[jizhang] 本地验证码 ${normalizedEmail}: ${code}`);

  const isDev = process.env.NODE_ENV !== 'production';
  return {
    channel: 'local_otp',
    message: isDev ? `验证码: ${code}（开发模式，见后端控制台）` : '验证码已发送',
    devCode: isDev ? code : undefined,
  };
}

/**
 * 发送邮箱验证码
 * 开发默认 local（不依赖 Supabase 邮件模板）；生产默认 supabase
 */
router.post('/send-code', async (req, res) => {
  const { email } = req.body;
  const supabase = req.app.get('supabase');

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ code: 400, message: '请输入有效的邮箱地址' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const otpMode = getOtpMode();

  try {
    if (otpMode === 'local') {
      const result = await sendLocalOtp(supabase, normalizedEmail);
      return res.status(200).json({
        code: 200,
        message: result.message,
        data: { channel: result.channel, ...(result.devCode ? { devCode: result.devCode } : {}) },
      });
    }

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: true },
    });

    if (!otpError) {
      return res.status(200).json({
        code: 200,
        message: '验证码已发送至邮箱，请查收',
        data: { channel: 'supabase_auth' },
      });
    }

    console.warn('Supabase Auth OTP 发送失败，使用本地验证码:', otpError.message);
    const result = await sendLocalOtp(supabase, normalizedEmail);
    return res.status(200).json({
      code: 200,
      message: result.message,
      data: { channel: result.channel, ...(result.devCode ? { devCode: result.devCode } : {}) },
    });
  } catch (error) {
    console.error('发送验证码异常:', error);
    return res.status(500).json({ code: 500, message: '发送验证码失败', error: error.message });
  }
});

/**
 * 验证码登录
 */
router.post('/verify-code', async (req, res) => {
  const { email, code } = req.body;
  const supabase = req.app.get('supabase');

  if (!email || !code) {
    return res.status(400).json({ code: 400, message: '邮箱和验证码不能为空' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const tokenCode = String(code).trim();

  try {
    let authUser = null;

    const { data: otpRow } = await supabase
      .from('jz_email_otp')
      .select('*')
      .eq('email', normalizedEmail)
      .eq('code', tokenCode)
      .eq('used', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpRow) {
      await supabase.from('jz_email_otp').update({ used: true }).eq('id', otpRow.id);

      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceKey) {
        return res.status(500).json({
          code: 500,
          message: '本地验证码登录需要配置 SUPABASE_SERVICE_ROLE_KEY',
        });
      }

      const { createClient } = require('@supabase/supabase-js');
      const admin = createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: listData } = await admin.auth.admin.listUsers();
      const existing = listData?.users?.find((u) => u.email === normalizedEmail);

      if (existing) {
        authUser = existing;
      } else {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: normalizedEmail,
          email_confirm: true,
        });
        if (createError) throw createError;
        authUser = created.user;
      }
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

    const appToken = generateToken({
      userId: authUser.id,
      email: normalizedEmail,
      username: profile.nickname || normalizedEmail.split('@')[0],
      role: 'user',
      app: 'jizhang',
    }, '30d');

    const needsProfileSetup = !profile.profile_completed;

    return res.status(200).json({
      code: 200,
      message: '登录成功',
      data: {
        token: appToken,
        needsProfileSetup,
        userInfo: {
          userId: authUser.id,
          email: normalizedEmail,
          nickname: profile.nickname || '',
          avatar: profile.avatar_url || '',
          profileCompleted: !!profile.profile_completed,
          loginTime: Date.now(),
        },
      },
    });
  } catch (error) {
    console.error('验证码登录异常:', error);
    return res.status(500).json({ code: 500, message: '登录失败', error: error.message });
  }
});

module.exports = router;
