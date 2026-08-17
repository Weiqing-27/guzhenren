/**
 * 确保猫咪 Vlog 专用 Storage 桶存在
 * 用法：在 guzhenren 目录执行
 *   node scripts/ensure-cat-vlog-bucket.js
 *
 * 需要 .env 中有 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（或 ANON_KEY 且有建桶权限）
 */
require('dotenv').config({ quiet: true })
const { createClient } = require('@supabase/supabase-js')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('缺少 SUPABASE_URL 或密钥环境变量')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const BUCKET = 'cat-vlog'

/**
 * 【功能描述】
 * 检查并创建 cat-vlog 公开存储桶
 *
 * 【业务逻辑】
 * 1. 查询 Supabase Storage 中是否已有 cat-vlog 桶
 * 2. 已存在则打印信息并退出
 * 3. 不存在则创建公开桶并限制 MIME 与文件大小
 * 4. 创建失败时输出 Dashboard 手动创建指引
 *
 * 【技术实现】
 * - 涉及方法：supabase.storage.getBucket()、createBucket()
 * - 涉及知识点：Supabase Storage、dotenv 环境变量、CLI 运维脚本
 */
async function main() {
  const { data, error } = await supabase.storage.getBucket(BUCKET)
  if (!error && data) {
    console.log(`存储桶已存在: ${BUCKET}`, data)
    return
  }

  console.log(`未找到桶 ${BUCKET}，正在创建…`)
  const { data: created, error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 52428800,
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/jpg',
      'video/mp4',
    ],
  })

  if (createError) {
    console.error('创建失败:', createError)
    console.error('\n也可在 Supabase Dashboard → Storage → New bucket：')
    console.error('  名称: cat-vlog')
    console.error('  勾选 Public bucket')
    process.exit(1)
  }

  console.log('创建成功:', created)
}

main()
