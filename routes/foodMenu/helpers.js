/**
 * 情侣点餐模块内部公共方法：统一响应、Supabase 客户端、存储桶、订单号等。
 */

const FOOD_BUCKET = 'food-menu'
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
])

/**
 * 【功能描述】
 * 获取本模块使用的 Supabase 客户端，优先 service role 以绕过 RLS。
 *
 * 【业务逻辑】
 * 1. 优先 supabaseAdmin（SERVICE_ROLE_KEY）
 * 2. 没有则降级普通 supabase（需关闭 RLS 或补写策略，否则订单读会为空）
 *
 * 【技术实现】
 * - 涉及方法：req.app.get()
 * - 涉及知识点：Express 应用级依赖注入、service_role 绕过 RLS
 */
function db(req) {
  return req.app.get('supabaseAdmin') || req.app.get('supabase')
}

/**
 * 【功能描述】
 * 统一成功响应 { code, data, msg }。
 *
 * 【业务逻辑】
 * HTTP 状态码与业务 code 默认一致，data 可为任意结构。
 *
 * 【技术实现】
 * - 涉及方法：res.status().json()
 * - 涉及知识点：统一响应信封
 */
function ok(res, data = null, msg = 'success', code = 200) {
  return res.status(code).json({ code, data, msg })
}

/**
 * 【功能描述】
 * 统一失败响应 { code, data, msg }。
 *
 * 【业务逻辑】
 * data 默认 null，便于前端统一判断 code !== 200。
 *
 * 【技术实现】
 * - 涉及方法：res.status().json()
 * - 涉及知识点：错误响应信封
 */
function fail(res, msg = '请求失败', code = 400, data = null) {
  return res.status(code).json({ code, data, msg })
}

/**
 * 【功能描述】
 * 确保 food-menu 公开存储桶存在，不存在则自动创建。
 *
 * 【业务逻辑】
 * 1. getBucket 已存在则返回桶名
 * 2. 否则 createBucket：公开、5MB、仅图片 MIME
 * 3. already exists 视为成功
 *
 * 【技术实现】
 * - 涉及方法：storage.getBucket、createBucket
 * - 涉及知识点：Supabase Storage 公开桶、幂等建桶
 */
async function ensureFoodMenuBucket(supabase) {
  const { data, error } = await supabase.storage.getBucket(FOOD_BUCKET)

  if (!error && data) return FOOD_BUCKET

  const { error: createError } = await supabase.storage.createBucket(FOOD_BUCKET, {
    public: true,
    fileSizeLimit: 5_242_880,
    allowedMimeTypes: Array.from(ALLOWED_IMAGE_MIME),
  })

  if (createError && !String(createError.message || '').toLowerCase().includes('already exists')) {
    throw createError
  }

  return FOOD_BUCKET
}

/**
 * 【功能描述】
 * 生成订单号：FO + 年月日时分秒 + 4 位随机数。
 *
 * 【业务逻辑】
 * 使用 Asia/Shanghai 本地时间拼时间戳，降低并发重复概率后再加随机数。
 *
 * 【技术实现】
 * - 涉及方法：toLocaleString、padStart、Math.random
 * - 涉及知识点：订单号可读性、时区
 */
function genOrderSn() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const pick = (type) => parts.find((p) => p.type === type)?.value || '00'
  const ts = `${pick('year')}${pick('month')}${pick('day')}${pick('hour')}${pick('minute')}${pick('second')}`
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  return `FO${ts}${rand}`
}

/**
 * 【功能描述】
 * 将 Date / ISO 字符串格式化为东八区可读时间。
 *
 * 【业务逻辑】
 * 供公众号文案「下单时间：xxx」使用。
 *
 * 【技术实现】
 * - 涉及方法：toLocaleString、timeZone Asia/Shanghai
 * - 涉及知识点：时区展示
 */
function formatChinaTime(input) {
  const date = input instanceof Date ? input : new Date(input || Date.now())
  if (Number.isNaN(date.getTime())) return String(input || '-')
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  })
}

/**
 * 【功能描述】
 * 根据请求体中的菜品数组，补全名称/价格等快照字段。
 *
 * 【业务逻辑】
 * 1. 支持 ['uuid']、[{id}]、[{name,price,quantity}] 三种入参
 * 2. 有 id 时从 food_menu 查出最新名称价格，写入订单快照，避免日后改菜品影响历史订单
 * 3. 查不到则保留原字段或标记「未知菜品」
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().in()
 * - 涉及知识点：订单快照、JSONB 结构约定
 */
async function hydrateFoodList(supabase, foodList) {
  const items = Array.isArray(foodList) ? foodList : []
  const ids = items
    .map((item) => (typeof item === 'string' ? item : item && item.id))
    .filter(Boolean)

  const map = {}
  if (ids.length) {
    const { data, error } = await supabase
      .from('food_menu')
      .select('id,name,category,price,image_url')
      .in('id', ids)

    if (error) throw error
    ;(data || []).forEach((row) => {
      map[row.id] = row
    })
  }

  return items.map((item) => {
    if (typeof item === 'string') {
      const row = map[item]
      return row
        ? {
            id: row.id,
            name: row.name,
            category: row.category,
            price: Number(row.price),
            quantity: 1,
            image_url: row.image_url || '',
          }
        : { id: item, name: '未知菜品', category: '', price: 0, quantity: 1, image_url: '' }
    }

    const row = item && item.id ? map[item.id] : null
    const quantity = Number(item.quantity || item.qty || 1) || 1
    const tasteRemark = String(item.tasteRemark || item.remark || '').trim()
    return {
      id: item.id || null,
      name: item.name || row?.name || '未命名菜品',
      category: item.category || row?.category || '',
      price: item.price != null ? Number(item.price) : Number(row?.price || 0),
      quantity,
      image_url: item.image_url || row?.image_url || '',
      tasteRemark,
    }
  })
}

/**
 * 【功能描述】
 * 根据 MIME 推断文件扩展名。
 *
 * 【业务逻辑】
 * jpeg/jpg → jpg，其余取 subtype，未知默认 jpg。
 *
 * 【技术实现】
 * - 涉及方法：split
 * - 涉及知识点：MIME 与扩展名映射
 */
function extFromMime(mimeType) {
  const subtype = String(mimeType || '').split('/')[1] || 'jpg'
  if (subtype === 'jpeg') return 'jpg'
  return subtype.replace(/[^a-z0-9]/gi, '') || 'jpg'
}

module.exports = {
  FOOD_BUCKET,
  ALLOWED_IMAGE_MIME,
  db,
  ok,
  fail,
  ensureFoodMenuBucket,
  genOrderSn,
  formatChinaTime,
  hydrateFoodList,
  extFromMime,
}
