require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 使用 service_role key 以获得更高权限
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function initDatabase() {
  console.log('=== 前端面试题系统 - 数据库初始化 ===\n');

  // 检查并创建 questions 表
  console.log('1. 检查 questions 表...');
  const { data: qData, error: qError } = await supabase
    .from('questions')
    .select('id')
    .limit(1);

  if (qError && qError.message.includes('relation')) {
    console.log('   × questions 表不存在');
    console.log('   请在 Supabase Dashboard > SQL Editor 中执行 sql/create_questions_tables.sql');
  } else if (!qError) {
    console.log('   ✓ questions 表已存在');
    console.log(`   当前题目数量: ${qData ? '可查询' : 0}`);
  } else {
    console.log('   × 检查失败:', qError.message);
  }

  // 检查并创建 submissions 表
  console.log('\n2. 检查 submissions 表...');
  const { data: sData, error: sError } = await supabase
    .from('submissions')
    .select('id')
    .limit(1);

  if (sError && sError.message.includes('relation')) {
    console.log('   × submissions 表不存在');
    console.log('   请在 Supabase Dashboard > SQL Editor 中执行 sql/create_questions_tables.sql');
  } else if (!sError) {
    console.log('   ✓ submissions 表已存在');
  } else {
    console.log('   × 检查失败:', sError.message);
  }

  // 输出 SQL 文件路径
  console.log('\n=== 数据库表 SQL 文件位置 ===');
  const sqlPath = path.join(__dirname, 'sql', 'create_questions_tables.sql');
  console.log(sqlPath);

  console.log('\n=== 下一步操作 ===');
  console.log('1. 打开 Supabase Dashboard: https://supabase.com/dashboard');
  console.log('2. 进入 SQL Editor');
  console.log('3. 复制并执行 create_questions_tables.sql 的内容');
  console.log('4. 执行完成后，重新运行此脚本验证');
  console.log('\n或者直接在浏览器中访问以下 API 测试（表创建后）:');
  console.log('  GET http://localhost:3001/api/questions');
  console.log('  GET http://localhost:3001/api/admin/generate-questions?username=weiqing');
}

initDatabase().catch(console.error);
