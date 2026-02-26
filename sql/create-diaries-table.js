const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// 初始化 Supabase 客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function createDiariesTable() {
  try {
    // 创建 diaries 表
    const { error } = await supabase.rpc('create_table', {
      table_name: 'diaries',
      columns: [
        { name: 'id', type: 'bigint', is_primary_key: true, is_identity: true },
        { name: 'title', type: 'text', is_nullable: false },
        { name: 'type', type: 'varchar(10)', is_nullable: false },
        { name: 'content', type: 'text', is_nullable: false },
        { name: 'created_at', type: 'timestamp with time zone', is_nullable: false, default: 'now()' },
        { name: 'updated_at', type: 'timestamp with time zone', is_nullable: false, default: 'now()' }
      ]
    });

    if (error) {
      console.error('创建表时出错:', error);
      return;
    }

    console.log('Diaries 表创建成功!');
    
    // 创建索引
    const { error: indexError } = await supabase.rpc('create_index', {
      table_name: 'diaries',
      index_name: 'idx_diaries_type',
      columns: ['type']
    });

    if (indexError) {
      console.error('创建索引时出错:', indexError);
      return;
    }

    console.log('Diaries 表索引创建成功!');
  } catch (err) {
    console.error('发生异常:', err);
  }
}

// 如果直接运行此脚本，则执行创建表的操作
if (require.main === module) {
  createDiariesTable();
}

module.exports = createDiariesTable;