/**
 * 【功能描述】
 * 微信小程序登录：读取配置、code2session 换取 openid、生成伪邮箱标识。
 *
 * 【业务逻辑】
 * 1. 小程序 wx.login 取得 code，后端向微信换取 openid/unionid。
 * 2. 用 openid 构造本地伪邮箱，映射到 Supabase Auth 用户体系。
 *
 * 【技术实现】
 * - 涉及方法：getWechatConfig、isWechatLoginConfigured、exchangeCodeForSession、buildWechatPseudoEmail
 * - 涉及知识点：微信 jscode2session API、环境变量配置、伪邮箱命名规则
 */

/**
 * 【功能描述】
 * 读取微信小程序 AppID 与 Secret 配置。
 *
 * 【业务逻辑】
 * 1. 从环境变量 WECHAT_MINI_APPID、WECHAT_MINI_SECRET 读取。
 * 2. 任一缺失则返回 null，表示微信登录未启用。
 *
 * 【技术实现】
 * - 涉及方法：getWechatConfig
 * - 涉及知识点：process.env、配置完整性校验
 */
function getWechatConfig() {
  const appid = process.env.WECHAT_MINI_APPID;
  const secret = process.env.WECHAT_MINI_SECRET;
  if (!appid || !secret) return null;
  return { appid, secret };
}

/**
 * 【功能描述】
 * 判断微信登录是否已配置可用。
 *
 * 【业务逻辑】
 * 1. 供 auth/methods 与 wechat-login 路由前置检查。
 * 2. 未配置时前端可隐藏微信登录入口。
 *
 * 【技术实现】
 * - 涉及方法：isWechatLoginConfigured
 * - 涉及知识点：布尔配置探测
 */
function isWechatLoginConfigured() {
  return !!getWechatConfig();
}

/**
 * 【功能描述】
 * 用小程序临时 code 向微信换取 openid、unionid 与会话密钥。
 *
 * 【业务逻辑】
 * 1. 调用微信 jscode2session 接口校验 code 有效性。
 * 2. 成功返回 openid（必填）与 unionid（可选），供后续创建/查找用户。
 *
 * 【技术实现】
 * - 涉及方法：exchangeCodeForSession
 * - 涉及知识点：fetch、微信 OAuth code2session、errcode 错误处理
 */
async function exchangeCodeForSession(code) {
  const cfg = getWechatConfig();
  if (!cfg) {
    throw new Error('未配置微信小程序 WECHAT_MINI_APPID / WECHAT_MINI_SECRET');
  }

  const url =
    `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(cfg.appid)}` +
    `&secret=${encodeURIComponent(cfg.secret)}` +
    `&js_code=${encodeURIComponent(code)}` +
    '&grant_type=authorization_code';

  const res = await fetch(url);
  const data = await res.json();

  if (data.errcode) {
    console.error('[jizhang] wechat jscode2session:', data);
    throw new Error(data.errmsg || '微信登录失败，请重试');
  }

  if (!data.openid) {
    throw new Error('微信登录失败：未获取到用户标识');
  }

  return {
    openid: data.openid,
    unionid: data.unionid || null,
    sessionKey: data.session_key,
  };
}

/**
 * 【功能描述】
 * 根据微信 openid 生成 Supabase Auth 可用的伪邮箱地址。
 *
 * 【业务逻辑】
 * 1. 微信用户无真实邮箱，用 wx_{openid}@wx.jizhang.local 作为唯一标识。
 * 2. 过滤非法字符并截断，保证邮箱格式合法且可复现。
 *
 * 【技术实现】
 * - 涉及方法：buildWechatPseudoEmail
 * - 涉及知识点：字符串 sanitize、伪邮箱域名约定
 */
function buildWechatPseudoEmail(openid) {
  const safe = String(openid).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  return `wx_${safe}@wx.jizhang.local`;
}

module.exports = {
  isWechatLoginConfigured,
  exchangeCodeForSession,
  buildWechatPseudoEmail,
};
