/**
 * 【功能描述】
 * 在 Supabase 中创建 images 图片元数据表，并确保 images 存储桶存在。
 *
 * 【业务逻辑】
 * 1. 通过 execute_sql RPC 创建 images 表及索引
 * 2. 检查 Storage images 桶，不存在则创建（公开、5MB、image/*）
 *
 * 【技术实现】
 * - 涉及方法：@supabase/supabase-js、supabase.rpc、supabase.storage
 * - 涉及知识点：UUID 主键、Storage Bucket 策略、custom_user 外键
 *
 * 用法：node sql/create-images-table.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// 初始化Supabase客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 【功能描述】
 * 创建 images 表并初始化 Supabase Storage 的 images 桶。
 *
 * 【业务逻辑】
 * 1. execute_sql 执行 CREATE TABLE 与 CREATE INDEX
 * 2. getBucket 探测桶是否存在，不存在则 createBucket
 *
 * 【技术实现】
 * - 涉及方法：supabase.rpc('execute_sql')、storage.getBucket/createBucket
 * - 涉及知识点：gen_random_uuid()、MIME 类型限制
 */
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
