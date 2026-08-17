/*
 * 【功能描述】
 * 情侣点餐菜单 & 订单模块建表：food_menu 菜品表、food_order 订单表，
 * 以及 food-menu 公开存储桶（菜品图片）。
 *
 * 【业务逻辑】
 * 1. 创建 food_menu（菜品名称/分类/价格/图片/简介/上架状态）
 * 2. 创建 food_order（订单号/勾选菜品 JSONB/备注/下单时间）
 * 3. 建立常用索引；开启 RLS 并给出建议策略（后端用 service_role 绕过）
 *
 * 【技术实现】
 * - 涉及表：food_menu、food_order
 * - 涉及知识点：UUID 主键、JSONB、TIMESTAMPTZ、PostgreSQL RLS、Storage 公开桶
 *
 * 用法：在 Supabase Dashboard → SQL Editor 中整段执行本脚本
 */

-- ============================================================
-- 情侣点餐模块 - Supabase 建表脚本
-- 在 Supabase SQL Editor 中执行本文件
-- ============================================================

-- ------------------------------------------------------------
-- 1. 菜品表 food_menu
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS food_menu (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  price NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  image_url TEXT DEFAULT '',
  -- desc 为 SQL 保留字，必须用双引号作为列名
  "desc" TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_food_menu_category ON food_menu (category);
CREATE INDEX IF NOT EXISTS idx_food_menu_is_active ON food_menu (is_active);
CREATE INDEX IF NOT EXISTS idx_food_menu_created_at ON food_menu (created_at DESC);

COMMENT ON TABLE food_menu IS '情侣点餐-菜品表';
COMMENT ON COLUMN food_menu.id IS '主键 UUID';
COMMENT ON COLUMN food_menu.name IS '菜品名称';
COMMENT ON COLUMN food_menu.category IS '分类，如：热菜/凉菜/主食/汤/饮品/小吃';
COMMENT ON COLUMN food_menu.price IS '价格（元）';
COMMENT ON COLUMN food_menu.image_url IS '菜品图片公开访问 URL（Supabase Storage）';
COMMENT ON COLUMN food_menu."desc" IS '菜品简介';
COMMENT ON COLUMN food_menu.created_at IS '创建时间';
COMMENT ON COLUMN food_menu.is_active IS '是否上架：true 上架，false 下架';

-- ------------------------------------------------------------
-- 2. 点餐订单表 food_order
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS food_order (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_sn TEXT NOT NULL,
  food_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  remark TEXT DEFAULT '',
  create_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_food_order_order_sn ON food_order (order_sn);
CREATE INDEX IF NOT EXISTS idx_food_order_create_time ON food_order (create_time DESC);

COMMENT ON TABLE food_order IS '情侣点餐-订单表';
COMMENT ON COLUMN food_order.id IS '主键 UUID';
COMMENT ON COLUMN food_order.order_sn IS '订单号，如 FO202608171200001234';
COMMENT ON COLUMN food_order.food_list IS '勾选菜品数组 JSON，建议结构：[{id,name,category,price,quantity,image_url}]';
COMMENT ON COLUMN food_order.remark IS '用户备注';
COMMENT ON COLUMN food_order.create_time IS '下单时间';

-- ------------------------------------------------------------
-- 3. 建议 RLS 策略（务必阅读）
-- ------------------------------------------------------------
-- 【建议】开启 RLS，防止 SUPABASE_ANON_KEY 泄露后被直接读写订单。
-- Express 后端请使用 supabaseAdmin（SERVICE_ROLE_KEY），service_role 会自动绕过 RLS。
--
-- 策略意图：
--   - 菜品：anon 只能读已上架记录，不能增删改
--   - 订单：anon / authenticated 均不可访问，仅 service_role 可读写
--
-- 若后端暂时没有 SERVICE_ROLE_KEY、只能用 anon key，可临时关闭 RLS（不推荐生产）：
--   ALTER TABLE food_menu DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE food_order DISABLE ROW LEVEL SECURITY;

ALTER TABLE food_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_order ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "food_menu_anon_select_active" ON food_menu;
CREATE POLICY "food_menu_anon_select_active"
  ON food_menu
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- 菜品不创建 INSERT/UPDATE/DELETE 策略 → anon 默认无法写
-- 订单不创建任何策略 → anon 默认无法读也无法写

-- ------------------------------------------------------------
-- 4. 菜品图片 Storage 桶（可选）
--    推荐执行：node scripts/ensure-food-menu-bucket.js
--    或 Dashboard → Storage → New bucket
--      名称: food-menu
--      勾选: Public bucket
--      大小限制: 5MB
--    后端首次上传也会尝试自动建桶。
--
-- 若有 storage 表写权限，也可取消下面注释：
-- INSERT INTO storage.buckets (id, name, public, file_size_limit)
-- VALUES ('food-menu', 'food-menu', true, 5242880)
-- ON CONFLICT (id) DO NOTHING;
--
-- DROP POLICY IF EXISTS "food_menu_storage_public_read" ON storage.objects;
-- CREATE POLICY "food_menu_storage_public_read"
--   ON storage.objects FOR SELECT TO public
--   USING (bucket_id = 'food-menu');
-- ------------------------------------------------------------
