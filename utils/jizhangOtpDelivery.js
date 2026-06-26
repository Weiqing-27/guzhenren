/**
 * 记账本 OTP 投递：邮件（SMTP / Resend）与短信（阿里云）
 * 使用 Node 18+ 内置 fetch（Vercel 兼容）
 */

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host,
    port,
    secure: process.env.SMTP_SECURE !== 'false',
    auth: { user, pass },
  };
}

async function sendOtpViaSmtp(to, code) {
  const smtp = getSmtpConfig();
  if (!smtp) return false;

  // 动态加载，未配置 SMTP 时不强依赖 nodemailer
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    console.error('[jizhang] 未安装 nodemailer，请执行 npm install nodemailer');
    return false;
  }

  const from = process.env.SMTP_FROM || smtp.auth.user;
  const transporter = nodemailer.createTransport(smtp);

  await transporter.sendMail({
    from,
    to,
    subject: '【记账本】登录验证码',
    text: `您的登录验证码是：${code}，10 分钟内有效。如非本人操作请忽略。`,
    html: `<p>您的登录验证码是：<strong style="font-size:24px">${code}</strong></p><p>10 分钟内有效，请勿泄露。</p>`,
  });
  return true;
}

async function sendOtpViaResend(to, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: '【记账本】登录验证码',
      html: `<p>您的登录验证码是：<strong style="font-size:24px">${code}</strong></p><p>10 分钟内有效，请勿泄露。</p>`,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend 发送失败: ${errText}`);
  }
  return true;
}

/**
 * 发送邮箱验证码（local 模式必须配置其一）
 */
async function deliverEmailOtp(email, code) {
  if (await sendOtpViaSmtp(email, code)) {
    console.log(`[jizhang] 邮件验证码已通过 SMTP 发送至 ${email}`);
    return { channel: 'smtp' };
  }
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    await sendOtpViaResend(email, code);
    console.log(`[jizhang] 邮件验证码已通过 Resend 发送至 ${email}`);
    return { channel: 'resend' };
  }
  return null;
}

/**
 * 阿里云短信（国内手机号推荐）
 * 需配置：ALIYUN_SMS_ACCESS_KEY_ID, ALIYUN_SMS_ACCESS_KEY_SECRET,
 *         ALIYUN_SMS_SIGN_NAME, ALIYUN_SMS_TEMPLATE_CODE
 */
async function deliverPhoneOtp(phone, code) {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  const signName = process.env.ALIYUN_SMS_SIGN_NAME;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE;

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    return null;
  }

  let Core;
  try {
    Core = require('@alicloud/pop-core');
  } catch {
    console.error('[jizhang] 手机短信需安装: npm install @alicloud/pop-core');
    return null;
  }

  const client = new Core({
    accessKeyId,
    accessKeySecret,
    endpoint: 'https://dysmsapi.aliyuncs.com',
    apiVersion: '2017-05-25',
  });

  await client.request('SendSms', {
    PhoneNumbers: phone,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
  }, { method: 'POST' }).catch((err) => {
    const msg = err?.data?.Message || err?.message || String(err);
    throw new Error(`阿里云短信发送失败: ${msg}`);
  });

  console.log(`[jizhang] 短信验证码已发送至 ${phone}`);
  return { channel: 'aliyun_sms' };
}

function isEmailDeliveryConfigured() {
  return getSmtpConfig() || (process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

function isPhoneDeliveryConfigured() {
  return (
    process.env.ALIYUN_SMS_ACCESS_KEY_ID
    && process.env.ALIYUN_SMS_ACCESS_KEY_SECRET
    && process.env.ALIYUN_SMS_SIGN_NAME
    && process.env.ALIYUN_SMS_TEMPLATE_CODE
  );
}

module.exports = {
  deliverEmailOtp,
  deliverPhoneOtp,
  isEmailDeliveryConfigured,
  isPhoneDeliveryConfigured,
};
