/**
 * 猫咪 Vlog 模块路由
 * 挂载路径：/api/cat-vlog
 *
 * 公开：内容列表/详情、留言、关于
 * 需登录：上传、内容 CRUD、删除留言
 *
 * 注意：所有读写统一使用 service role（supabaseAdmin），
 * 避免表开启 RLS 且无策略时出现「写入成功、列表为空」。
 */
const express = require('express')
const { generateToken } = require('../utils/jwt')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

/** 后台简易账号（可用环境变量覆盖） */
const ADMIN_USER = process.env.CAT_VLOG_ADMIN_USER || 'admin'
const ADMIN_PASS = process.env.CAT_VLOG_ADMIN_PASS || 'tangbao2026'

/**
 * 【功能描述】
 * 获取 Supabase 数据库客户端（优先 service role）
 *
 * 【业务逻辑】
 * 1. 从 Express app 读取 supabaseAdmin 实例
 * 2. 若无则降级使用普通 supabase 客户端
 *
 * 【技术实现】
 * - 涉及方法：req.app.get()
 * - 涉及知识点：Supabase service role 绕过 RLS
 */
function db(req) {
  return req.app.get('supabaseAdmin') || req.app.get('supabase')
}

/**
 * 【功能描述】
 * 猫咪 Vlog 后台简易登录
 *
 * 【业务逻辑】
 * 1. 校验用户名与密码非空
 * 2. 与环境变量或默认账号比对
 * 3. 成功则签发带 cat-vlog 模块标识的 JWT
 *
 * 【技术实现】
 * - 涉及方法：generateToken()、router.post()
 * - 涉及知识点：JWT 签发、环境变量配置、固定管理员账号
 */
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) {
      return res.status(400).json({ code: 400, message: '账号和密码不能为空', data: null })
    }

    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      return res.status(401).json({ code: 401, message: '账号或密码错误', data: null })
    }

    const token = generateToken({
      userId: 'cat-vlog-admin',
      username: ADMIN_USER,
      role: 'admin',
      module: 'cat-vlog',
    })

    return res.status(200).json({
      code: 200,
      message: '登录成功',
      data: { token, username: ADMIN_USER, role: 'admin' },
    })
  } catch (error) {
    console.error('[cat-vlog] 登录错误:', error.message)
    return res.status(500).json({ code: 500, message: '服务器错误', error: error.message })
  }
})

/**
 * 【功能描述】
 * 确保 cat-vlog Storage 桶存在，不存在则自动创建
 *
 * 【业务逻辑】
 * 1. 查询 Supabase Storage 是否已有 cat-vlog 桶
 * 2. 不存在则创建公开桶并限制 MIME 与大小
 * 3. 已存在或「already exists」错误视为成功
 *
 * 【技术实现】
 * - 涉及方法：supabase.storage.getBucket()、createBucket()
 * - 涉及知识点：Supabase Storage、公开桶、MIME 白名单
 */
async function ensureCatVlogBucket(supabase) {
  const bucket = 'cat-vlog'
  const { data, error } = await supabase.storage.getBucket(bucket)

  if (!error && data) return bucket

  const { error: createError } = await supabase.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: 52_428_800,
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/jpg',
      'video/mp4',
    ],
  })

  if (createError && !String(createError.message || '').toLowerCase().includes('already exists')) {
    throw createError
  }

  return bucket
}

/**
 * 【功能描述】
 * 上传图片或视频（base64）到 Supabase Storage
 *
 * 【业务逻辑】
 * 1. 校验 file_data 必填，视频仅允许 MP4
 * 2. 解析 data URI 或纯 base64 为 Buffer
 * 3. 生成 ASCII 安全存储路径并上传
 * 4. 返回公开访问 URL 与媒体元信息
 *
 * 【技术实现】
 * - 涉及方法：Buffer.from()、ensureCatVlogBucket()、storage.upload()、getPublicUrl()
 * - 涉及知识点：base64 解码、MIME 映射、Storage key 命名规范
 */
router.post('/upload', authenticate, async (req, res) => {
  const supabase = db(req)
  const { file_data, file_name, mime_type, media_type } = req.body || {}

  if (!file_data) {
    return res.status(400).json({ code: 400, message: '缺少文件数据', data: null })
  }

  if (media_type === 'video' || (mime_type && mime_type.startsWith('video/'))) {
    if (mime_type && mime_type !== 'video/mp4') {
      return res.status(400).json({ code: 400, message: '视频仅支持 MP4 格式', data: null })
    }
  }

  try {
    let mimeType = mime_type || 'image/jpeg'
    let base64Data = file_data

    if (file_data.startsWith('data:')) {
      const matches = file_data.match(/^data:(.+);base64,(.+)$/)
      if (matches && matches.length === 3) {
        mimeType = matches[1]
        base64Data = matches[2]
      }
    }

    if (mimeType.startsWith('video/') && mimeType !== 'video/mp4') {
      return res.status(400).json({ code: 400, message: '视频仅支持 MP4 格式', data: null })
    }

    const buffer = Buffer.from(base64Data, 'base64')
    // Storage key 必须是安全 ASCII，禁止中文文件名
    const extMap = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
    }
    const ext =
      extMap[mimeType] ||
      String(mimeType.split('/')[1] || 'bin')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') ||
      'bin'
    const storagePath = `${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`

    const bucket = await ensureCatVlogBucket(supabase)
    const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    })

    if (uploadError) {
      console.error('[cat-vlog] 上传失败:', uploadError)
      return res.status(500).json({
        code: 500,
        message:
          uploadError.message === 'Bucket not found'
            ? '存储桶不存在，请在 Supabase Storage 创建公开桶 cat-vlog'
            : '文件上传失败',
        error: uploadError.message,
      })
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(storagePath)

    return res.status(201).json({
      code: 201,
      message: '上传成功',
      data: {
        id: storagePath,
        url: publicUrl,
        file_name: file_name || storagePath,
        mime_type: mimeType,
        media_type: mimeType.startsWith('video/') ? 'video' : 'image',
      },
    })
  } catch (error) {
    console.error('[cat-vlog] 上传异常:', error.message)
    return res.status(500).json({
      code: 500,
      message: '服务器错误：' + (error.message || '上传失败'),
      error: error.message,
      hint: '请确认 .env 配置了 SUPABASE_SERVICE_ROLE_KEY，并在 Storage 中存在公开桶 cat-vlog',
    })
  }
})

/**
 * 【功能描述】
 * 分页获取 Vlog 内容列表
 *
 * 【业务逻辑】
 * 1. 支持 type、status 筛选，默认仅 published
 * 2. 按 created_at 倒序分页查询 cat_vlog_contents
 * 3. 返回列表与分页元数据
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().order().range().eq()
 * - 涉及知识点：公开读接口、Supabase count exact
 */
router.get('/contents', async (req, res) => {
  const supabase = db(req)
  const { type, page = 1, limit = 50, status = 'published' } = req.query
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10)

  try {
    let query = supabase
      .from('cat_vlog_contents')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit, 10) - 1)

    if (type) query = query.eq('type', type)
    if (status) query = query.eq('status', status)

    const { data, count, error } = await query
    if (error) {
      console.error('[cat-vlog] 列表错误:', error)
      return res.status(500).json({ code: 500, message: '获取列表失败', error: error.message })
    }

    return res.status(200).json({
      code: 200,
      message: 'ok',
      data: {
        list: data || [],
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: count || 0,
        },
      },
    })
  } catch (error) {
    console.error('[cat-vlog] 列表异常:', error.message)
    return res.status(500).json({ code: 500, message: '服务器错误', error: error.message })
  }
})

/**
 * 【功能描述】
 * 获取单条 Vlog 内容详情
 *
 * 【业务逻辑】
 * 1. 按 URL 参数 id 查询 cat_vlog_contents
 * 2. 不存在返回 404
 * 3. 存在则返回完整记录
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().eq().single()
 * - 涉及知识点：RESTful 资源详情、公开读
 */
router.get('/contents/:id', async (req, res) => {
  const supabase = db(req)
  try {
    const { data, error } = await supabase
      .from('cat_vlog_contents')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error) {
      return res.status(404).json({ code: 404, message: '内容不存在', error: error.message })
    }
    return res.status(200).json({ code: 200, message: 'ok', data })
  } catch (error) {
    return res.status(500).json({ code: 500, message: '服务器错误', error: error.message })
  }
})

/**
 * 【功能描述】
 * 新建 Vlog 内容（需登录）
 *
 * 【业务逻辑】
 * 1. 校验 title、type 必填
 * 2. 拒绝直接保存 data: 本地预览 URL，要求先上传 Storage
 * 3. 组装记录插入 cat_vlog_contents
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().insert().select().single()、authenticate 中间件
 * - 涉及知识点：内容发布流程、URL 校验、JSONB gallery/tags
 */
router.post('/contents', authenticate, async (req, res) => {
  const supabase = db(req)
  const body = req.body || {}

  if (!body.title || !body.type) {
    return res.status(400).json({ code: 400, message: 'title 与 type 必填', data: null })
  }

  const urls = [body.cover_url, body.media_url]
    .concat(Array.isArray(body.gallery) ? body.gallery.map((g) => g?.url) : [])
    .filter(Boolean)
  if (urls.some((u) => String(u).startsWith('data:'))) {
    return res.status(400).json({
      code: 400,
      message: '请先上传文件到 Storage，再提交内容（不能直接保存本地预览图）',
      data: null,
    })
  }

  const record = {
    type: body.type,
    title: body.title,
    content: body.content || '',
    tags: Array.isArray(body.tags) ? body.tags : [],
    category: body.category || '',
    cover_url: body.cover_url || '',
    media_url: body.media_url || '',
    media_type: body.media_type || 'image',
    gallery: Array.isArray(body.gallery) ? body.gallery : [],
    status: body.status || 'published',
  }

  try {
    const { data, error } = await supabase.from('cat_vlog_contents').insert([record]).select().single()
    if (error) {
      console.error('[cat-vlog] 创建失败:', error)
      return res.status(500).json({ code: 500, message: '创建失败', error: error.message })
    }
    return res.status(201).json({ code: 201, message: '创建成功', data })
  } catch (error) {
    return res.status(500).json({ code: 500, message: '服务器错误', error: error.message })
  }
})

/**
 * 【功能描述】
 * 更新指定 Vlog 内容（需登录）
 *
 * 【业务逻辑】
 * 1. 根据 body 中存在的字段构建 patch
 * 2. 自动更新 updated_at 时间戳
 * 3. 按 id 更新并返回最新记录
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().update().eq().select().single()
 * - 涉及知识点：部分更新（PATCH 语义）、白名单字段
 */
router.put('/contents/:id', authenticate, async (req, res) => {
  const supabase = db(req)
  const body = req.body || {}

  const patch = {
    updated_at: new Date().toISOString(),
  }
  ;['type', 'title', 'content', 'category', 'cover_url', 'media_url', 'media_type', 'status'].forEach(
    (key) => {
      if (body[key] !== undefined) patch[key] = body[key]
    }
  )
  if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? body.tags : []
  if (body.gallery !== undefined) patch.gallery = Array.isArray(body.gallery) ? body.gallery : []

  try {
    const { data, error } = await supabase
      .from('cat_vlog_contents')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) {
      return res.status(500).json({ code: 500, message: '更新失败', error: error.message })
    }
    return res.status(200).json({ code: 200, message: '更新成功', data })
  } catch (error) {
    return res.status(500).json({ code: 500, message: '服务器错误', error: error.message })
  }
})

/**
 * 【功能描述】
 * 删除指定 Vlog 内容（需登录）
 *
 * 【业务逻辑】
 * 1. 按 id 从 cat_vlog_contents 删除记录
 * 2. 成功返回被删 id
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().delete().eq()
 * - 涉及知识点：硬删除、authenticate 鉴权
 */
router.delete('/contents/:id', authenticate, async (req, res) => {
  const supabase = db(req)
  try {
    const { error } = await supabase.from('cat_vlog_contents').delete().eq('id', req.params.id)
    if (error) {
      return res.status(500).json({ code: 500, message: '删除失败', error: error.message })
    }
    return res.status(200).json({ code: 200, message: '删除成功', data: { id: req.params.id } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: '服务器错误', error: error.message })
  }
})

/**
 * 【功能描述】
 * 获取访客留言列表
 *
 * 【业务逻辑】
 * 1. 按 created_at 倒序查询 cat_vlog_messages
 * 2. 支持 limit 控制条数，默认 100
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().order().limit()
 * - 涉及知识点：公开读、简单列表 API
 */
router.get('/messages', async (req, res) => {
  const supabase = db(req)
  const limit = parseInt(req.query.limit || '100', 10)
  try {
    const { data, error } = await supabase
      .from('cat_vlog_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return res.status(500).json({ code: 500, message: '获取留言失败', error: error.message })
    }
    return res.status(200).json({ code: 200, message: 'ok', data: { list: data || [] } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: '服务器错误', error: error.message })
  }
})

/**
 * 【功能描述】
 * 访客提交留言
 *
 * 【业务逻辑】
 * 1. 校验 nickname、content 非空
 * 2. 截断昵称与内容长度后插入 cat_vlog_messages
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().insert().select().single()
 * - 涉及知识点：公开写、输入长度限制防滥用
 */
router.post('/messages', async (req, res) => {
  const supabase = db(req)
  const { nickname, content } = req.body || {}

  if (!nickname || !content) {
    return res.status(400).json({ code: 400, message: '昵称和留言不能为空', data: null })
  }

  try {
    const { data, error } = await supabase
      .from('cat_vlog_messages')
      .insert([{ nickname: String(nickname).slice(0, 40), content: String(content).slice(0, 1000) }])
      .select()
      .single()

    if (error) {
      return res.status(500).json({ code: 500, message: '留言失败', error: error.message })
    }
    return res.status(201).json({ code: 201, message: '留言成功', data })
  } catch (error) {
    return res.status(500).json({ code: 500, message: '服务器错误', error: error.message })
  }
})

/**
 * 【功能描述】
 * 删除指定留言（需登录）
 *
 * 【业务逻辑】
 * 1. 按 id 删除 cat_vlog_messages 记录
 * 2. 成功返回被删 id
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().delete().eq()
 * - 涉及知识点：管理员鉴权、内容 moderation
 */
router.delete('/messages/:id', authenticate, async (req, res) => {
  const supabase = db(req)
  try {
    const { error } = await supabase.from('cat_vlog_messages').delete().eq('id', req.params.id)
    if (error) {
      return res.status(500).json({ code: 500, message: '删除失败', error: error.message })
    }
    return res.status(200).json({ code: 200, message: '删除成功', data: { id: req.params.id } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: '服务器错误', error: error.message })
  }
})

/**
 * 【功能描述】
 * 获取「关于」页信息
 *
 * 【业务逻辑】
 * 1. 查询 cat_vlog_about 表首条记录
 * 2. 无数据时返回默认标题与简介
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().limit().maybeSingle()
 * - 涉及知识点：单例配置表、默认值降级
 */
router.get('/about', async (req, res) => {
  const supabase = db(req)
  try {
    const { data, error } = await supabase.from('cat_vlog_about').select('*').limit(1).maybeSingle()
    if (error) {
      return res.status(500).json({ code: 500, message: '获取关于信息失败', error: error.message })
    }
    return res.status(200).json({
      code: 200,
      message: 'ok',
      data: data || {
        title: '关于糖宝与墨宝',
        intro: '糖宝墨宝猫咪 Vlog 记录站',
        cats: [],
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: '服务器错误', error: error.message })
  }
})

module.exports = router
