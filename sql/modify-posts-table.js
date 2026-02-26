require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// 创建 Supabase 客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // 使用服务角色密钥获取更高权限
);

async function checkTableStructure() {
  try {
    console.log('检查 posts 表结构...');
    
    // 尝试插入一条测试数据，不包含 user_id 字段
    const { data, error } = await supabase
      .from('posts')
      .insert([
        {
          title: 'Test Post',
          content: 'This is a test post',
          excerpt: 'Test excerpt',
          type: 'technical',
          status: 'draft',
          is_private: false
        }
      ])
      .select()
      .single();

    if (error) {
      console.log('插入测试数据失败:', error);
      
      // 如果是因为 user_id 不能为空，尝试插入带默认 user_id 的数据
      if (error.code === '23502') {
        console.log('尝试使用默认 user_id...');
        const { data: testData, error: testError } = await supabase
          .from('posts')
          .insert([
            {
              user_id: '00000000-0000-0000-0000-000000000000', // 默认 user_id
              title: 'Test Post',
              content: 'This is a test post',
              excerpt: 'Test excerpt',
              type: 'technical',
              status: 'draft',
              is_private: false
            }
          ])
          .select()
          .single();
          
        if (testError) {
          console.error('使用默认 user_id 仍然失败:', testError);
        } else {
          console.log('使用默认 user_id 成功插入数据:', testData);
        }
      }
    } else {
      console.log('插入测试数据成功:', data);
    }
    
    // 查看表结构
    const { data: tableData, error: tableError } = await supabase
      .from('posts')
      .select('*')
      .limit(1);
      
    if (tableError) {
      console.error('查询表结构失败:', tableError);
    } else {
      console.log('当前表结构示例:', tableData);
    }
    
  } catch (error) {
    console.error('执行过程中发生错误:', error);
  }
}

// 执行检查
checkTableStructure();