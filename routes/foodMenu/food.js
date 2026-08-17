/**
 * 情侣点餐 - 菜品路由
 * 挂载路径：/api/food
 *
 * GET    /list     菜品列表
 * POST   /add      新增菜品
 * PUT    /edit     修改菜品
 * DELETE /remove   删除菜品
 * POST   /upload   菜品图片上传（multipart 文件 或 JSON base64）
 */
const express = require('express')
const multer = require('multer')
const {
  ALLOWED_IMAGE_MIME,
  FOOD_BUCKET,
  db,
  ok,
  fail,
  ensureFoodMenuBucket,
  extFromMime,
} = require('./helpers')

const router = express.Router()

/** 内存接收文件，适配 Vercel Serverless（无持久磁盘） */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(String(file.mimetype || '').toLowerCase())) {
      cb(null, true)
    } else {
      cb(new Error('仅支持 jpg/png/gif/webp 图片'))
    }
  },
})

/**
 * 【功能描述】
 * 包装 multer 单文件中间件，把体积/类型错误转成统一 {code,data,msg}。
 *
 * 【业务逻辑】
 * 1. 接收字段名 file（uni.uploadFile 的 name）
 * 2. LIMIT_FILE_SIZE → 400
 * 3. 其它 multer 错误 → 400，无文件则放行（后续可走 base64）
 *
 * 【技术实现】
 * - 涉及方法：multer.single、err.code
 * - 涉及知识点：multipart 解析、错误码映射
 */
function acceptImageFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next()
    if (err.code === 'LIMIT_FILE_SIZE') {
      return fail(res, '图片不能超过 5MB', 400)
    }
    return fail(res, err.message || '图片上传解析失败', 400)
  })
}

/**
 * 【功能描述】
 * 把菜品行转成前端友好对象（desc 保留字列名原样返回）。
 *
 * 【业务逻辑】
 * price 转 Number，缺省字段给空串/默认值。
 *
 * 【技术实现】
 * - 涉及方法：Number()
 * - 涉及知识点：JSONB/NUMERIC 到 JSON 的类型整理
 */
function shapeFood(row) {
  if (!row) return row
  return {
    id: row.id,
    name: row.name,
    category: row.category || '',
    price: Number(row.price),
    image_url: row.image_url || '',
    desc: row.desc || '',
    created_at: row.created_at,
    is_active: row.is_active !== false,
  }
}

/**
 * 【功能描述】
 * 获取菜品列表，支持按分类、上架状态筛选。
 *
 * 【业务逻辑】
 * 1. query.category 精确匹配分类
 * 2. query.is_active：true/false；不传默认只返回上架；all 返回全部
 * 3. 按 created_at 倒序
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().eq().order()
 * - 涉及知识点：查询参数筛选、上架状态
 *
 * 调用示例：GET /api/food/list?category=热菜&is_active=true
 */
router.get('/list', async (req, res) => {
  const supabase = db(req)
  const { category, is_active: isActive } = req.query || {}

  try {
    let query = supabase.from('food_menu').select('*').order('created_at', { ascending: false })

    if (category) {
      query = query.eq('category', String(category))
    }

    if (isActive === 'all') {
      // 管理端查看全部，不加 is_active 过滤
    } else if (isActive === 'false' || isActive === '0') {
      query = query.eq('is_active', false)
    } else {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query
    if (error) throw error

    return ok(res, (data || []).map(shapeFood), '获取菜品列表成功')
  } catch (error) {
    console.error('[food-menu] 获取菜品列表失败:', error.message)
    return fail(res, error.message || '获取菜品列表失败', 500)
  }
})

/**
 * 【功能描述】
 * 新增一道菜品。
 *
 * 【业务逻辑】
 * 1. 校验 name 必填、price >= 0
 * 2. is_active 默认 true
 * 3. 写入 food_menu 并返回新记录
 *
 * 【技术实现】
 * - 涉及方法：from().insert().select().single()
 * - 涉及知识点：NUMERIC 价格、desc 保留字列
 *
 * 调用示例：POST /api/food/add  { name, category, price, image_url, desc, is_active }
 */
router.post('/add', async (req, res) => {
  const supabase = db(req)
  const body = req.body || {}
  const name = String(body.name || '').trim()

  if (!name) {
    return fail(res, '菜品名称不能为空', 400)
  }

  const price = Number(body.price)
  if (Number.isNaN(price) || price < 0) {
    return fail(res, '价格必须为大于等于 0 的数字', 400)
  }

  try {
    const record = {
      name,
      category: String(body.category || '').trim(),
      price,
      image_url: String(body.image_url || '').trim(),
      desc: String(body.desc || body.description || '').trim(),
      is_active: body.is_active === false || body.is_active === 0 || body.is_active === 'false' ? false : true,
    }

    const { data, error } = await supabase.from('food_menu').insert([record]).select().single()
    if (error) throw error

    return ok(res, shapeFood(data), '新增菜品成功', 200)
  } catch (error) {
    console.error('[food-menu] 新增菜品失败:', error.message)
    return fail(res, error.message || '新增菜品失败', 500)
  }
})

/**
 * 【功能描述】
 * 按 id 修改菜品，仅更新传入的字段。
 *
 * 【业务逻辑】
 * 1. body.id 必填
 * 2. 白名单字段：name/category/price/image_url/desc/is_active
 * 3. 至少更新一项，返回更新后记录
 *
 * 【技术实现】
 * - 涉及方法：from().update().eq().select().single()
 * - 涉及知识点：部分更新、字段白名单
 *
 * 调用示例：PUT /api/food/edit  { id, name, price, is_active }
 */
router.put('/edit', async (req, res) => {
  const supabase = db(req)
  const body = req.body || {}
  const id = body.id

  if (!id) {
    return fail(res, '缺少菜品 id', 400)
  }

  const patch = {}
  if (body.name != null) {
    const name = String(body.name).trim()
    if (!name) return fail(res, '菜品名称不能为空', 400)
    patch.name = name
  }
  if (body.category != null) patch.category = String(body.category).trim()
  if (body.image_url != null) patch.image_url = String(body.image_url).trim()
  if (body.desc != null || body.description != null) {
    patch.desc = String(body.desc || body.description || '').trim()
  }
  if (body.is_active != null) {
    patch.is_active = !(body.is_active === false || body.is_active === 0 || body.is_active === 'false')
  }
  if (body.price != null) {
    const price = Number(body.price)
    if (Number.isNaN(price) || price < 0) {
      return fail(res, '价格必须为大于等于 0 的数字', 400)
    }
    patch.price = price
  }

  if (Object.keys(patch).length === 0) {
    return fail(res, '没有可更新的字段', 400)
  }

  try {
    const { data, error } = await supabase
      .from('food_menu')
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (error) throw error
    if (!data) return fail(res, '菜品不存在', 404)

    return ok(res, shapeFood(data), '修改菜品成功')
  } catch (error) {
    console.error('[food-menu] 修改菜品失败:', error.message)
    return fail(res, error.message || '修改菜品失败', 500)
  }
})

/**
 * 【功能描述】
 * 按 id 删除菜品（query 或 body 均可）。
 *
 * 【业务逻辑】
 * 1. 读取 id
 * 2. 删除 food_menu 对应行
 * 3. 找不到则 404（PostgREST 删除无行时 data 为空）
 *
 * 【技术实现】
 * - 涉及方法：from().delete().eq().select()
 * - 涉及知识点：DELETE 幂等、id 来源兼容 query/body
 *
 * 调用示例：DELETE /api/food/remove?id=uuid  或 body: { id }
 */
router.delete('/remove', async (req, res) => {
  const supabase = db(req)
  const id = (req.query && req.query.id) || (req.body && req.body.id)

  if (!id) {
    return fail(res, '缺少菜品 id', 400)
  }

  try {
    const { data, error } = await supabase.from('food_menu').delete().eq('id', id).select()
    if (error) throw error
    if (!data || data.length === 0) {
      return fail(res, '菜品不存在', 404)
    }

    return ok(res, { id }, '删除菜品成功')
  } catch (error) {
    console.error('[food-menu] 删除菜品失败:', error.message)
    return fail(res, error.message || '删除菜品失败', 500)
  }
})

/**
 * 【功能描述】
 * 从 multipart 文件或 JSON base64 解析出 Buffer 与 MIME。
 *
 * 【业务逻辑】
 * 1. 优先 req.file（uni.uploadFile）
 * 2. 否则解析 body.file_data / image_data（data URL 或纯 base64）
 * 3. 校验 MIME 白名单
 *
 * 【技术实现】
 * - 涉及方法：Buffer.from、正则提取 data URI
 * - 涉及知识点：uniapp 两种上传方式兼容
 */
function resolveImageBuffer(req) {
  if (req.file && req.file.buffer) {
    const mimeType = String(req.file.mimetype || 'image/jpeg').toLowerCase()
    return {
      buffer: req.file.buffer,
      mimeType,
      originalName: req.file.originalname || '',
    }
  }

  const body = req.body || {}
  const raw = body.file_data || body.image_data || body.base64
  if (!raw || typeof raw !== 'string') {
    return null
  }

  let mimeType = String(body.mime_type || 'image/jpeg').toLowerCase()
  let base64Data = raw

  if (raw.startsWith('data:')) {
    const matches = raw.match(/^data:(.+);base64,(.+)$/)
    if (!matches) {
      throw new Error('base64 图片格式不正确')
    }
    mimeType = matches[1].toLowerCase()
    base64Data = matches[2]
  }

  return {
    buffer: Buffer.from(base64Data, 'base64'),
    mimeType,
    originalName: body.file_name || '',
  }
}

/**
 * 【功能描述】
 * 菜品图片上传：写入 Supabase Storage food-menu 桶，返回公开 URL。
 *
 * 【业务逻辑】
 * 1. 解析文件（multipart 或 base64）
 * 2. 确保存储桶存在
 * 3. 生成 ASCII 安全路径 menu/{timestamp}_{rand}.{ext}
 * 4. upload 后 getPublicUrl 返回给前端，前端再带到 /food/add 或 /food/edit
 *
 * 【技术实现】
 * - 涉及方法：ensureFoodMenuBucket、storage.upload、getPublicUrl
 * - 涉及知识点：公开桶、Content-Type、uni.uploadFile 字段名 file
 *
 * 调用示例见 sql/food-menu-api-examples.js
 */
router.post('/upload', acceptImageFile, async (req, res) => {
  const supabase = db(req)

  try {
    const parsed = resolveImageBuffer(req)
    if (!parsed) {
      return fail(res, '请上传图片文件（字段名 file）或传入 file_data/base64', 400)
    }

    const mimeType = parsed.mimeType === 'image/jpg' ? 'image/jpeg' : parsed.mimeType
    if (!ALLOWED_IMAGE_MIME.has(mimeType) && !ALLOWED_IMAGE_MIME.has(parsed.mimeType)) {
      return fail(res, '仅支持 jpg/png/gif/webp 图片', 400)
    }

    await ensureFoodMenuBucket(supabase)

    const ext = extFromMime(mimeType)
    const fileName = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.${ext}`
    const storagePath = `menu/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from(FOOD_BUCKET)
      .upload(storagePath, parsed.buffer, {
        contentType: mimeType,
        upsert: false,
      })

    if (uploadError) {
      console.error('[food-menu] 图片上传失败:', uploadError)
      return fail(res, uploadError.message || '图片上传失败', 500)
    }

    const { data: urlData } = supabase.storage.from(FOOD_BUCKET).getPublicUrl(storagePath)
    const imageUrl = urlData && urlData.publicUrl

    return ok(
      res,
      {
        image_url: imageUrl,
        url: imageUrl,
        path: storagePath,
        mime_type: mimeType,
        file_size: parsed.buffer.length,
      },
      '图片上传成功'
    )
  } catch (error) {
    console.error('[food-menu] 图片上传异常:', error.message)
    return fail(res, error.message || '图片上传失败', 500)
  }
})

module.exports = router
