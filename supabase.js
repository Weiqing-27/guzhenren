const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

// 创建带配置的supabase客户端
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