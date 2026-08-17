const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

/**
 * 【功能描述】
 * 导出一个预配置的 Supabase JS 客户端，供脚本或遗留代码直接 require 使用。
 *
 * 【业务逻辑】
 * 1. 加载 dotenv，读取 SUPABASE_URL / SUPABASE_ANON_KEY；
 * 2. 创建客户端：DB 失败重试 3 次、间隔 2 秒；
 * 3. Auth：开启自动刷新 token、持久化会话，关闭 URL 会话检测；
 * 4. 全局请求头附带 apikey（匿名密钥），便于 PostgREST 鉴权。
 *
 * 【技术实现】
 * - 涉及方法：dotenv.config()、@supabase/supabase-js createClient()
 * - 涉及知识点：环境变量配置、Supabase 客户端单例导出、CommonJS module.exports、
 *   匿名密钥（anon key）与 RLS 配合、客户端级重试策略
 *
 * 说明：主应用入口 index.js 内另有独立 createClient（含 supabaseAdmin），本文件多为脚本/兼容用途。
 */
module.exports = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    db: {
      retryAttempts: 3,
      retryInterval: 2000,
    },
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY
      }
    }
  }
)
