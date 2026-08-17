/*
 * 【功能描述】
 * 猫咪 Vlog 模块表结构：内容、留言、关于页，支持 Vlog/相册/日记/干货类型。
 *
 * 【业务逻辑】
 * 1. 创建 cat_vlog_contents（type/media/gallery JSONB）
 * 2. 创建 cat_vlog_messages 留言表
 * 3. 创建 cat_vlog_about 关于页配置表
 *
 * 【技术实现】
 * - 涉及表：cat_vlog_contents、cat_vlog_messages、cat_vlog_about
 * - 涉及知识点：JSONB tags/gallery、CHECK type/status 枚举
 *
 * 用法：在 Supabase SQL Editor 中执行本脚本
 */

-- 猫咪 Vlog 模块表结构
-- 在 Supabase SQL Editor 中执行本脚本

-- 内容表：Vlog / 相册 / 日记 / 干货
CREATE TABLE IF NOT EXISTS cat_vlog_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('vlog', 'album', 'diary', 'tip')),
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  tags JSONB DEFAULT '[]'::jsonb,
  category TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  media_url TEXT DEFAULT '',
  media_type TEXT DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  gallery JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_vlog_contents_type ON cat_vlog_contents (type);
CREATE INDEX IF NOT EXISTS idx_cat_vlog_contents_created ON cat_vlog_contents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cat_vlog_contents_status ON cat_vlog_contents (status);

COMMENT ON TABLE cat_vlog_contents IS '糖宝墨宝猫咪Vlog内容表';

-- 留言表
CREATE TABLE IF NOT EXISTS cat_vlog_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_vlog_messages_created ON cat_vlog_messages (created_at DESC);

COMMENT ON TABLE cat_vlog_messages IS '糖宝墨宝猫咪Vlog留言表';

-- 关于页配置（单行）
CREATE TABLE IF NOT EXISTS cat_vlog_about (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT DEFAULT '关于糖宝与墨宝',
  intro TEXT DEFAULT '',
  cats JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 默认关于信息
INSERT INTO cat_vlog_about (title, intro, cats)
SELECT
  '关于糖宝与墨宝',
  '这里是糖宝、墨宝的成长记录站。短视频、相册、日记和养猫干货，都会慢慢堆成一本只属于她们的家书。',
  '[{"name":"糖宝","desc":"橘里橘气，精力旺盛，玩具杀手。"},{"name":"墨宝","desc":"黑白分明，冷静观察，窗台常驻。"}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM cat_vlog_about LIMIT 1);

-- 可选：在 Supabase Dashboard → Storage → New bucket 手动创建
-- 名称: cat-vlog
-- 勾选: Public bucket
-- 或执行（需有 storage 权限）：
-- INSERT INTO storage.buckets (id, name, public, file_size_limit)
-- VALUES ('cat-vlog', 'cat-vlog', true, 52428800)
-- ON CONFLICT (id) DO NOTHING;
