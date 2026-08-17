/**
 * 【功能描述】
 * 铢墨记 OTP 投递：邮件（SMTP / Resend）与短信（阿里云）。
 *
 * 【业务逻辑】
 * 1. local 模式下后端自管验证码，需通过本模块实际发送邮件或短信。
 * 2. 邮件优先 SMTP，其次 Resend；短信走阿里云 dysmsapi。
 * 3. 未配置对应渠道时返回 null，由 auth 路由决定开发模式兜底或报错。
 *
 * 【技术实现】
 * - 涉及方法：deliverEmailOtp、deliverPhoneOtp、isEmailDeliveryConfigured、isPhoneDeliveryConfigured
 * - 涉及知识点：Node 18+ fetch、nodemailer 动态加载、阿里云 pop-core SDK
 */

/**
 * 【功能描述】
 * 读取 SMTP 发信配置。
 *
 * 【业务逻辑】
 * 1. 从环境变量组装 host/port/user/pass。
 * 2. 缺任一必填项则视为未配置 SMTP。
 *
 * 【技术实现】
 * - 涉及方法：getSmtpConfig
 * - 涉及知识点：process.env、SMTP 连接参数
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

/**
 * 【功能描述】
 * 通过 SMTP 发送邮箱验证码。
 *
 * 【业务逻辑】
 * 1. 动态加载 nodemailer，未安装或未配置时静默返回 false。
 * 2. 发送含 6 位验证码的纯文本/HTML 邮件，有效期 10 分钟。
 *
 * 【技术实现】
 * - 涉及方法：sendOtpViaSmtp
 * - 涉及知识点：nodemailer createTransport、sendMail
 */
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
    subject: '【铢墨记】登录验证码',
    text: `您的登录验证码是：${code}，10 分钟内有效。如非本人操作请忽略。`,
    html: `<p>您的登录验证码是：<strong style="font-size:24px">${code}</strong></p><p>10 分钟内有效，请勿泄露。</p>`,
  });
  return true;
}

/**
 * 【功能描述】
 * 通过 Resend API 发送邮箱验证码。
 *
 * 【业务逻辑】
 * 1. 需配置 RESEND_API_KEY 与 RESEND_FROM。
 * 2. 请求失败时抛出含响应体的错误，便于排查。
 *
 * 【技术实现】
 * - 涉及方法：sendOtpViaResend
 * - 涉及知识点：REST fetch、Bearer 鉴权、Resend Emails API
 */
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
      subject: '【铢墨记】登录验证码',
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
 * 【功能描述】
 * 统一入口：按优先级投递邮箱验证码（SMTP → Resend）。
 *
 * 【业务逻辑】
 * 1. local 模式下 auth 路由调用，必须配置 SMTP 或 Resend 之一。
 * 2. 成功返回 channel 标识；均不可用返回 null。
 *
 * 【技术实现】
 * - 涉及方法：deliverEmailOtp
 * - 涉及知识点：多渠道降级、结构化返回 { channel }
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
 * 【功能描述】
 * 通过阿里云短信服务发送手机验证码。
 *
 * 【业务逻辑】
 * 1. 需配置 ALIYUN_SMS_* 四个环境变量。
 * 2. 模板参数传入 { code }，与国内短信模板占位符一致。
 * 3. 未配置或 SDK 未安装时返回 null。
 *
 * 【技术实现】
 * - 涉及方法：deliverPhoneOtp
 * - 涉及知识点：@alicloud/pop-core、SendSms API、TemplateParam JSON
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

/**
 * 【功能描述】
 * 探测邮件验证码渠道是否已配置。
 *
 * 【业务逻辑】
 * 1. 供 auth/methods 返回 emailDelivery 能力开关。
 * 2. SMTP 或 Resend 任一可用即视为已配置。
 *
 * 【技术实现】
 * - 涉及方法：isEmailDeliveryConfigured
 * - 涉及知识点：环境变量布尔聚合
 */
function isEmailDeliveryConfigured() {
  return getSmtpConfig() || (process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

/**
 * 【功能描述】
 * 探测手机短信验证码渠道是否已配置。
 *
 * 【业务逻辑】
 * 1. 供 auth/methods 返回 phone 登录能力开关。
 * 2. 四个阿里云 SMS 环境变量齐全才返回 true。
 *
 * 【技术实现】
 * - 涉及方法：isPhoneDeliveryConfigured
 * - 涉及知识点：环境变量完整性校验
 */
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
