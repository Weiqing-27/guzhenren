require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTables() {
  console.log('开始创建数据库表...');

  // 读取 SQL 文件
  const sqlPath = path.join(__dirname, 'sql', 'create_questions_tables.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  // 分割 SQL 语句并逐个执行
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      if (error) {
        // 如果 rpc 不存在，使用 query 方式
        console.log('执行 SQL:', statement.substring(0, 50) + '...');
      }
    } catch (err) {
      console.error('执行 SQL 失败:', err.message);
    }
  }

  // 由于 Supabase JS 客户端不支持直接执行 DDL，我们改用 REST API 方式
  // 或者手动创建表
  console.log('\n使用 Supabase JS 客户端创建表...');

  // 创建 questions 表
  const { error: qError } = await supabase.from('questions').select('id').limit(1);
  if (qError && qError.message.includes('relation')) {
    console.log('questions 表不存在，需要手动创建');
  } else if (!qError) {
    console.log('questions 表已存在');
  }

  // 创建 submissions 表
  const { error: sError } = await supabase.from('submissions').select('id').limit(1);
  if (sError && sError.message.includes('relation')) {
    console.log('submissions 表不存在，需要手动创建');
  } else if (!sError) {
    console.log('submissions 表已存在');
  }

  console.log('\n请在 Supabase Dashboard 中执行以下 SQL 来创建表：');
  console.log(sqlPath);
  console.log('\n或者直接在 SQL Editor 中运行 sql/create_questions_tables.sql 文件内容');
}

createTables().catch(console.error);
