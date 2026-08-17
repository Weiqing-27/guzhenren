/**
 * 【功能描述】
 * 通过 Supabase RPC 创建 diaries 日记表及其 type 字段索引。
 *
 * 【业务逻辑】
 * 1. 调用 create_table RPC 定义 diaries 表结构
 * 2. 调用 create_index RPC 创建 idx_diaries_type 索引
 *
 * 【技术实现】
 * - 涉及方法：@supabase/supabase-js、supabase.rpc
 * - 涉及知识点：Supabase 元数据 RPC、模块导出供其他脚本复用
 *
 * 用法：node sql/create-diaries-table.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// 初始化 Supabase 客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 【功能描述】
 * 创建 diaries 表及 type 索引。
 *
 * 【业务逻辑】
 * 1. RPC create_table 定义 id/title/type/content/时间戳字段
 * 2. RPC create_index 在 type 列建索引
 *
 * 【技术实现】
 * - 涉及方法：supabase.rpc('create_table')、supabase.rpc('create_index')
 * - 涉及知识点：bigint identity 主键、timestamptz 默认值
 */
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
