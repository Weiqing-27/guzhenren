const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

module.exports = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)