/**
 * 【功能描述】
 * 创建 ai_novel_responses 表，用于存储 AI 小说训练模块的生成响应记录。
 *
 * 【业务逻辑】
 * 1. 优先调用 create_ai_novel_responses_table RPC
 * 2. RPC 不可用时回退 execute_sql 直接执行 DDL
 *
 * 【技术实现】
 * - 涉及方法：@supabase/supabase-js、supabase.rpc
 * - 涉及知识点：SERIAL 主键、全文索引字段
 *
 * 用法：node sql/create-ai-novel-responses-table.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

/**
 * 【功能描述】
 * 创建 ai_novel_responses 表及 title/content/user_id 索引。
 *
 * 【业务逻辑】
 * 1. rpc('create_ai_novel_responses_table') 首选
 * 2. 失败则 rpc('execute_sql') 执行内联 CREATE TABLE
 *
 * 【技术实现】
 * - 涉及方法：supabase.rpc
 * - 涉及知识点：IF NOT EXISTS 幂等建表、索引优化
 */
async function createAiNovelResponsesTable() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );

  try {
    // 创建 ai_novel_responses 表
    const { error } = await supabase.rpc('create_ai_novel_responses_table');

    if (error) {
      console.log('尝试使用SQL创建表...');
      
      // 如果存储过程不可用，尝试直接执行SQL
      const { error: sqlError } = await supabase.rpc('execute_sql', {
        sql: `
          CREATE TABLE IF NOT EXISTS ai_novel_responses (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            content TEXT NOT NULL,
            ai_response TEXT NOT NULL,
            user_id TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          
          CREATE INDEX IF NOT EXISTS idx_ai_novel_responses_title ON ai_novel_responses(title);
          CREATE INDEX IF NOT EXISTS idx_ai_novel_responses_content ON ai_novel_responses(content);
          CREATE INDEX IF NOT EXISTS idx_ai_novel_responses_user_id ON ai_novel_responses(user_id);
        `
      });

      if (sqlError) {
        console.error('创建表错误:', sqlError);
        return;
      }
    }

    console.log('成功创建ai_novel_responses表');
  } catch (error) {
    console.error('创建表过程中发生错误:', error);
  }
}

createAiNovelResponsesTable().catch(console.error);
