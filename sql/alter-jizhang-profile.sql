-- 用户资料表增加「是否已完成资料设置」字段（已有库请单独执行本文件）
ALTER TABLE jz_user_profiles
  ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT FALSE;

-- 可选：创建头像存储桶（Supabase Dashboard → Storage → New bucket）
-- 名称: jizhang-avatars，勾选 Public bucket
-- 或在 SQL Editor 执行（需 service_role 权限）:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('jizhang-avatars', 'jizhang-avatars', true)
-- ON CONFLICT (id) DO NOTHING;
