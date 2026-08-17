/**
 * 【功能描述】
 * 微信公众号消息推送工具：下单成功后把点餐清单发给指定 openid。
 *
 * 【业务逻辑】
 * 1. 从环境变量读取 appid / appsecret / 接收人 openid / 推送方式
 * 2. 获取并内存缓存 access_token（提前 200 秒过期）
 * 3. custom：调用客服消息接口发送纯文本（与需求文案模板一致）
 * 4. template：调用模板消息接口（更适合长期通知，需先在公众号申请模板）
 *
 * 【技术实现】
 * - 涉及方法：fetch、getAccessToken、sendCustomText、sendTemplateMessage、notifyFoodOrder
 * - 涉及知识点：微信公众号 access_token、客服消息、模板消息、环境变量配置抽离
 *
 * 配置项（写入 .env 或 Vercel 环境变量，示例见 .env.food-menu.example）：
 *   WECHAT_MP_APPID          公众号 AppID
 *   WECHAT_MP_APPSECRET      公众号 AppSecret
 *   WECHAT_MP_OPENID         接收通知的用户 openid，多个用逗号分隔
 *   WECHAT_MP_MSG_TYPE       custom | template，默认 custom
 *   WECHAT_MP_TEMPLATE_ID    模板消息 ID（template 模式必填）
 *   WECHAT_MP_TPL_TIME_KEY   模板「下单时间」字段名，默认 keyword1
 *   WECHAT_MP_TPL_LIST_KEY   模板「点餐清单」字段名，默认 keyword2
 *   WECHAT_MP_TPL_REMARK_KEY 模板「备注」字段名，默认 keyword3
 */

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token'
const CUSTOM_SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/custom/send'
const TEMPLATE_SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/template/send'

/** access_token 进程内缓存，避免每次下单都打微信 */
let tokenCache = {
  accessToken: '',
  expiresAt: 0,
}

/**
 * 【功能描述】
 * 读取公众号推送相关配置，缺项时返回 null，调用方可跳过推送。
 *
 * 【业务逻辑】
 * 1. 读取 appid、appsecret、openid
 * 2. 任一缺失则视为未配置
 * 3. 规范化 msgType、openid 列表与模板字段名
 *
 * 【技术实现】
 * - 涉及方法：process.env、String.split、trim
 * - 涉及知识点：配置抽离、多接收人、默认值
 */
function getWechatMpConfig() {
  const appid = (process.env.WECHAT_MP_APPID || '').trim()
  const appsecret = (process.env.WECHAT_MP_APPSECRET || '').trim()
  const openidRaw = (process.env.WECHAT_MP_OPENID || '').trim()

  if (!appid || !appsecret || !openidRaw) {
    return null
  }

  const msgType = (process.env.WECHAT_MP_MSG_TYPE || 'custom').trim().toLowerCase()
  const openids = openidRaw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  return {
    appid,
    appsecret,
    openids,
    msgType: msgType === 'template' ? 'template' : 'custom',
    templateId: (process.env.WECHAT_MP_TEMPLATE_ID || '').trim(),
    tplTimeKey: (process.env.WECHAT_MP_TPL_TIME_KEY || 'keyword1').trim(),
    tplListKey: (process.env.WECHAT_MP_TPL_LIST_KEY || 'keyword2').trim(),
    tplRemarkKey: (process.env.WECHAT_MP_TPL_REMARK_KEY || 'keyword3').trim(),
  }
}

/**
 * 【功能描述】
 * 判断公众号推送是否已配置完整。
 *
 * 【业务逻辑】
 * getWechatMpConfig 非空即视为可用。
 *
 * 【技术实现】
 * - 涉及方法：getWechatMpConfig
 * - 涉及知识点：布尔探测，供下单接口决定是否调用微信
 */
function isWechatMpConfigured() {
  return !!getWechatMpConfig()
}

/**
 * 把微信 token 接口错误转成可读说明，方便本地排查。
 */
function explainWechatTokenError(data) {
  const code = data && data.errcode
  const raw = (data && data.errmsg) || `获取 access_token 失败，errcode=${code}`
  if (code === 40164) {
    return (
      '微信拒绝当前服务器 IP（errcode 40164，IP 不在公众号白名单）。' +
      '请到微信公众平台 → 设置与开发 → 基本配置 → IP白名单，加入本机公网 IP。' +
      ` 原始错误: ${raw}`
    )
  }
  if (code === 40125 || code === 40001 || code === 40013) {
    return `公众号 AppID / AppSecret 不正确或已重置。原始错误: ${raw}`
  }
  return raw
}

/**
 * 【功能描述】
 * 向微信换取 access_token，并做内存缓存。
 *
 * 【业务逻辑】
 * 1. 缓存未过期则直接返回
 * 2. 调用 cgi-bin/token，grant_type=client_credential
 * 3. 成功则缓存 expires_in - 200 秒后过期
 *
 * 【技术实现】
 * - 涉及方法：fetch、URLSearchParams 风格 query
 * - 涉及知识点：微信全局 access_token、进程内缓存、errcode 错误处理
 */
async function getAccessToken() {
  const cfg = getWechatMpConfig()
  if (!cfg) {
    throw new Error('未配置微信公众号 WECHAT_MP_APPID / WECHAT_MP_APPSECRET / WECHAT_MP_OPENID')
  }

  const now = Date.now()
  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken
  }

  const url =
    `${TOKEN_URL}?grant_type=client_credential` +
    `&appid=${encodeURIComponent(cfg.appid)}` +
    `&secret=${encodeURIComponent(cfg.appsecret)}`

  const res = await fetch(url)
  const data = await res.json()

  if (!data.access_token) {
    console.error('[wechat-mp] 获取 access_token 失败:', data)
    throw new Error(explainWechatTokenError(data))
  }

  const ttlMs = Math.max(60, (Number(data.expires_in) || 7200) - 200) * 1000
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + ttlMs,
  }

  return tokenCache.accessToken
}

/**
 * 【功能描述】
 * 把菜品数组格式化成一行可读清单，供推送文案使用。
 *
 * 【业务逻辑】
 * 1. 空数组 → 「无」
 * 2. 有 quantity 则拼「菜名x份」；否则只拼菜名
 * 3. 多项用顿号连接
 *
 * 【技术实现】
 * - 涉及方法：Array.map、join
 * - 涉及知识点：JSONB 菜品结构兼容 string / object
 */
function formatFoodListText(foodList) {
  if (!Array.isArray(foodList) || foodList.length === 0) {
    return '无'
  }

  return foodList
    .map((item) => {
      if (typeof item === 'string') return item
      const name = item.name || item.title || '未命名菜品'
      const qty = Number(item.quantity || item.qty || 1)
      return qty > 1 ? `${name}x${qty}` : name
    })
    .join('、')
}

/**
 * 【功能描述】
 * 按需求模板拼接客服消息正文。
 *
 * 【业务逻辑】
 * 固定四行：标题、下单时间、点餐清单、备注。
 *
 * 【技术实现】
 * - 涉及方法：模板字符串、formatFoodListText
 * - 涉及知识点：微信客服消息 content 支持换行与 emoji
 */
function buildNotifyContent({ createTime, foodList, remark }) {
  const timeText = createTime || '-'
  const listText = formatFoodListText(foodList)
  const remarkText = (remark && String(remark).trim()) || '无'

  return [
    '女朋友点餐通知🥘',
    `下单时间：${timeText}`,
    `点餐清单：${listText}`,
    `备注：${remarkText}`,
  ].join('\n')
}

/**
 * 【功能描述】
 * 调用公众号客服消息接口，向单个用户发送文本。
 *
 * 【业务逻辑】
 * 1. POST cgi-bin/message/custom/send
 * 2. errcode 非 0 则抛错（45015 表示用户超 48 小时未互动）
 *
 * 【技术实现】
 * - 涉及方法：fetch POST JSON
 * - 涉及知识点：客服消息 48 小时窗口、errcode
 */
async function sendCustomText(accessToken, openid, content) {
  const url = `${CUSTOM_SEND_URL}?access_token=${encodeURIComponent(accessToken)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: openid,
      msgtype: 'text',
      text: { content },
    }),
  })
  const data = await res.json()

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`客服消息失败 openid=${openid} errcode=${data.errcode} errmsg=${data.errmsg}`)
  }

  return data
}

/**
 * 【功能描述】
 * 调用公众号模板消息接口，向单个用户发送点餐通知。
 *
 * 【业务逻辑】
 * 1. 校验 templateId
 * 2. 组装 data：first 标题 + 三个可配置 keyword 字段
 * 3. POST cgi-bin/message/template/send
 *
 * 【技术实现】
 * - 涉及方法：fetch POST JSON
 * - 涉及知识点：模板消息 data 结构、字段名可配置以适配新旧模板
 */
async function sendTemplateMessage(accessToken, openid, cfg, payload) {
  if (!cfg.templateId) {
    throw new Error('模板消息模式需配置 WECHAT_MP_TEMPLATE_ID')
  }

  const timeText = payload.createTime || '-'
  const listText = formatFoodListText(payload.foodList)
  const remarkText = (payload.remark && String(payload.remark).trim()) || '无'

  // 只发送已配置字段，避免模板里没有 first/remark 时微信返回 47003
  const tplData = {
    [cfg.tplTimeKey]: { value: String(timeText).slice(0, 20) },
    [cfg.tplListKey]: { value: String(listText).slice(0, 20) },
    [cfg.tplRemarkKey]: { value: String(remarkText).slice(0, 20) },
  }

  const url = `${TEMPLATE_SEND_URL}?access_token=${encodeURIComponent(accessToken)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: openid,
      template_id: cfg.templateId,
      data: tplData,
    }),
  })
  const data = await res.json()

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`模板消息失败 openid=${openid} errcode=${data.errcode} errmsg=${data.errmsg}`)
  }

  return data
}

/**
 * 【功能描述】
 * 下单成功后的入口：按配置给所有接收人推送点餐通知。
 *
 * 【业务逻辑】
 * 1. 未配置公众号 → 返回 skipped，不抛错（不影响下单）
 * 2. 取 access_token
 * 3. 按 msgType 逐个 openid 发送；单个失败不影响其他人
 * 4. 汇总成功/失败列表返回给订单接口
 *
 * 【技术实现】
 * - 涉及方法：getWechatMpConfig、getAccessToken、sendCustomText、sendTemplateMessage
 * - 涉及知识点：副作用与主流程解耦、部分失败容忍
 *
 * @param {{ createTime: string, foodList: Array, remark?: string }} payload
 * @returns {Promise<{ ok: boolean, skipped?: boolean, msg: string, results?: Array }>}
 */
async function notifyFoodOrder(payload) {
  const cfg = getWechatMpConfig()
  if (!cfg) {
    console.warn('[wechat-mp] 未配置公众号，跳过点餐推送。请填写 WECHAT_MP_APPID / APPSECRET / OPENID')
    return { ok: false, skipped: true, msg: '未配置公众号推送，已跳过' }
  }

  const accessToken = await getAccessToken()
  const content = buildNotifyContent(payload)
  const results = []

  for (const openid of cfg.openids) {
    try {
      if (cfg.msgType === 'template') {
        await sendTemplateMessage(accessToken, openid, cfg, payload)
      } else {
        await sendCustomText(accessToken, openid, content)
      }
      results.push({ openid, ok: true })
    } catch (error) {
      console.error('[wechat-mp] 推送失败:', error.message)
      results.push({ openid, ok: false, error: error.message })
    }
  }

  const allOk = results.length > 0 && results.every((item) => item.ok)
  return {
    ok: allOk,
    msg: allOk ? '公众号推送成功' : '公众号推送部分或全部失败',
    content,
    results,
  }
}

module.exports = {
  getWechatMpConfig,
  isWechatMpConfigured,
  getAccessToken,
  formatFoodListText,
  buildNotifyContent,
  notifyFoodOrder,
}
