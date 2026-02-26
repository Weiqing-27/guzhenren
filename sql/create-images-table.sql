-- 创建images表的SQL脚本
-- 表结构包含图片的基本信息和关联信息

-- 删除已存在的images表（如果需要重新创建）
-- DROP TABLE IF EXISTS images;

-- 创建images表
CREATE TABLE IF NOT EXISTS images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  url TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images (created_at);
CREATE INDEX IF NOT EXISTS idx_images_user_id ON images (user_id);

-- 添加注释
COMMENT ON TABLE images IS '存储图片信息的表';
COMMENT ON COLUMN images.id IS '图片唯一标识符';
COMMENT ON COLUMN images.file_name IS '图片文件名';
COMMENT ON COLUMN images.file_path IS '图片在存储中的路径';
COMMENT ON COLUMN images.url IS '图片访问URL';
COMMENT ON COLUMN images.mime_type IS '图片MIME类型';
COMMENT ON COLUMN images.file_size IS '图片文件大小(字节)';
COMMENT ON COLUMN images.user_id IS '关联的用户ID';
COMMENT ON COLUMN images.created_at IS '图片创建时间';