/*
 * 【功能描述】
 * 修复猫咪 Vlog 模块 RLS 策略：禁用 RLS 或提供公开读策略，解决 anon 读列表为空问题。
 *
 * 【业务逻辑】
 * 1. DISABLE ROW LEVEL SECURITY on cat_vlog_contents/messages/about
 * 2. 可选：启用 RLS 并 CREATE POLICY 公开 SELECT（注释中二选一）
 *
 * 【技术实现】
 * - 涉及表：cat_vlog_contents、cat_vlog_messages、cat_vlog_about
 * - 涉及知识点：PostgreSQL RLS、anon key 无策略时 SELECT 为空
 *
 * 用法：在 Supabase SQL Editor 中执行本脚本
 */

-- 修复猫咪 Vlog 表 RLS：开启 RLS 且无策略时，anon 读列表恒为空
-- 在 Supabase SQL Editor 执行本脚本

ALTER TABLE IF EXISTS cat_vlog_contents DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cat_vlog_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cat_vlog_about DISABLE ROW LEVEL SECURITY;

-- 若希望保留 RLS，可改用下面公开读策略（二选一即可）：
-- ALTER TABLE cat_vlog_contents ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "cat_vlog_contents_public_read" ON cat_vlog_contents;
-- CREATE POLICY "cat_vlog_contents_public_read" ON cat_vlog_contents FOR SELECT USING (true);
-- DROP POLICY IF EXISTS "cat_vlog_messages_public_read" ON cat_vlog_messages;
-- CREATE POLICY "cat_vlog_messages_public_read" ON cat_vlog_messages FOR SELECT USING (true);
-- DROP POLICY IF EXISTS "cat_vlog_about_public_read" ON cat_vlog_about;
-- CREATE POLICY "cat_vlog_about_public_read" ON cat_vlog_about FOR SELECT USING (true);
