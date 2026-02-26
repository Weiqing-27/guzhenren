const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

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
