/*
  这个脚本用于在Supabase中创建images表
  表结构包含以下字段:
  - id: UUID主键
  - file_name: 文件名
  - file_path: 文件存储路径
  - url: 文件访问URL
  - mime_type: 文件MIME类型
  - file_size: 文件大小(字节)
  - user_id: 关联的用户ID(可选)
  - created_at: 创建时间
*/

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// 初始化Supabase客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function createImagesTable() {
  try {
    // 创建images表
    const { error } = await supabase.rpc('execute_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS images (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          file_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          url TEXT NOT NULL,
          mime_type TEXT,
          file_size INTEGER,
          user_id UUID REFERENCES custom_user(userId),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        -- 创建索引
        CREATE INDEX IF NOT EXISTS idx_images_created_at ON images (created_at);
        CREATE INDEX IF NOT EXISTS idx_images_user_id ON images (user_id);
      `
    });

    if (error) {
      console.error('创建表失败:', error);
      return;
    }

    console.log('images表创建成功');
    
    // 设置存储桶策略(如果存储桶不存在则创建)
    const { data, error: storageError } = await supabase.storage.getBucket('images');
    
    if (storageError && storageError.message.includes('Bucket not found')) {
      // 创建存储桶
      const { error: createBucketError } = await supabase.storage.createBucket('images', {
        public: true,
        fileSizeLimit: 5242880, // 5MB限制
        allowedMimeTypes: ['image/*']
      });
      
      if (createBucketError) {
        console.error('创建存储桶失败:', createBucketError);
      } else {
        console.log('images存储桶创建成功');
      }
    } else if (storageError) {
      console.error('获取存储桶信息失败:', storageError);
    } else {
      console.log('images存储桶已存在');
    }
    
  } catch (err) {
    console.error('执行过程中发生错误:', err);
  }
}

// 执行创建表函数
createImagesTable();