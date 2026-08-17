/**
 * 【功能描述】
 * 创建 scores 游戏分数表，支持 RPC 与 JS API 两种探测/创建方式。
 *
 * 【业务逻辑】
 * 1. createScoresTable 尝试调用 create_scores_table RPC
 * 2. createTableWithJSAPI 通过 list_tables 检查后用 insert 触发建表
 *
 * 【技术实现】
 * - 涉及方法：@supabase/supabase-js、supabase.rpc、supabase.from().insert()
 * - 涉及知识点：Service Role Key、表存在性探测
 *
 * 用法：node sql/create-scores-table.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

/**
 * 【功能描述】
 * 通过 create_scores_table RPC 创建 scores 表。
 *
 * 【业务逻辑】
 * 1. 调用 supabase.rpc('create_scores_table')
 * 2. 失败则 console.error 并返回
 *
 * 【技术实现】
 * - 涉及方法：supabase.rpc
 * - 涉及知识点：Supabase 自定义 RPC 建表
 */
async function createScoresTable() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase.rpc('create_scores_table');

  if (error) {
    console.error('创建表错误:', error);
    return;
  }

  console.log('成功创建scores表');
}

/**
 * 【功能描述】
 * 通过 list_tables RPC 检查 scores 表是否存在，不存在则尝试 insert 触发创建。
 *
 * 【业务逻辑】
 * 1. rpc('list_tables') 获取表列表
 * 2. 若 scores 不存在则 insert 测试行
 *
 * 【技术实现】
 * - 涉及方法：supabase.rpc('list_tables')、supabase.from().insert()
 * - 涉及知识点：PostgreSQL 错误码 23505 忽略
 */
async function createTableWithJSAPI() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 检查表是否存在
  const { data: existingTables, error: listError } = await supabase
    .rpc('list_tables');

  if (listError) {
    console.error('获取表列表错误:', listError);
    return;
  }

  const tableExists = existingTables.some(table => table.name === 'scores');

  if (tableExists) {
    console.log('scores表已存在');
    return;
  }

  // 创建表
  const { error: createError } = await supabase
    .from('scores')
    .insert([{
      name: 'test',
      score: 0
    }], { returning: 'minimal' });

  if (createError && createError.code !== '23505') { // 忽略表已存在的错误
    console.error('创建表错误:', createError);
    return;
  }

  console.log('成功创建scores表');
}

createTableWithJSAPI().catch(console.error);
