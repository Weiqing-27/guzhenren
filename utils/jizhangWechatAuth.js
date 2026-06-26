/**
 * 微信小程序登录：code2session 换取 openid
 */

function getWechatConfig() {
  const appid = process.env.WECHAT_MINI_APPID;
  const secret = process.env.WECHAT_MINI_SECRET;
  if (!appid || !secret) return null;
  return { appid, secret };
}

function isWechatLoginConfigured() {
  return !!getWechatConfig();
}

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

function buildWechatPseudoEmail(openid) {
  const safe = String(openid).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  return `wx_${safe}@wx.jizhang.local`;
}

module.exports = {
  isWechatLoginConfigured,
  exchangeCodeForSession,
  buildWechatPseudoEmail,
};
