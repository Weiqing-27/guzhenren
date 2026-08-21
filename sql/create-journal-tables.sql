/*
 * 【功能描述】
 * 个人日记（journal）模块建表：独立账号、公开/内层双空间、密文存储、草稿与分类隔离。
 *
 * 【业务逻辑】
 * 1. journal_users：日记专用账号，登录密码与内层口令分开哈希存储
 * 2. journal_entries：日记正文/标题仅存密文；space_type 区分 public / secret
 * 3. journal_drafts：按用户+空间唯一一份草稿，两套空间互不互通
 * 4. journal_categories：分类按空间隔离
 * 5. 开启 RLS 且不建公开策略，禁止前端直连数据库读明文/密文
 *
 * 【技术实现】
 * - 涉及表：journal_users、journal_entries、journal_drafts、journal_categories
 * - 涉及知识点：AES 密文落库、space_type 强制过滤、RLS 默认拒绝、service_role 后端读写
 *
 * 用法：在 Supabase SQL Editor 中整份执行
 * 依赖：后端需配置 SUPABASE_SERVICE_ROLE_KEY（绕过 RLS）
 * 以及环境变量 DIARY_AES_KEY / DIARY_HMAC_KEY / DIARY_STORAGE_KEY / DIARY_VAULT_STORAGE_KEY
 */

-- ============================================================
-- 个人日记 journal 模块
-- ============================================================

CREATE TABLE IF NOT EXISTS journal_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    vault_pin_hash VARCHAR(255),
    auto_save BOOLEAN NOT NULL DEFAULT TRUE,
    encrypt_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_users_username ON journal_users (username);

CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES journal_users(id) ON DELETE CASCADE,
    space_type VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (space_type IN ('public', 'secret')),
    title_cipher TEXT NOT NULL,
    content_cipher TEXT NOT NULL,
    mood VARCHAR(20),
    category VARCHAR(50),
    diary_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_user_space_date
    ON journal_entries (user_id, space_type, diary_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_space_fav
    ON journal_entries (user_id, space_type, is_favorite);
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_space_arch
    ON journal_entries (user_id, space_type, is_archived);

CREATE TABLE IF NOT EXISTS journal_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES journal_users(id) ON DELETE CASCADE,
    space_type VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (space_type IN ('public', 'secret')),
    title_cipher TEXT,
    content_cipher TEXT,
    mood VARCHAR(20),
    category VARCHAR(50),
    diary_date DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, space_type)
);

CREATE INDEX IF NOT EXISTS idx_journal_drafts_user_space
    ON journal_drafts (user_id, space_type);

CREATE TABLE IF NOT EXISTS journal_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES journal_users(id) ON DELETE CASCADE,
    space_type VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (space_type IN ('public', 'secret')),
    name VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, space_type, name)
);

CREATE INDEX IF NOT EXISTS idx_journal_categories_user_space
    ON journal_categories (user_id, space_type);

-- 默认拒绝直连；仅 service_role 可读写
ALTER TABLE journal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_categories ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE journal_users FROM anon, authenticated;
REVOKE ALL ON TABLE journal_entries FROM anon, authenticated;
REVOKE ALL ON TABLE journal_drafts FROM anon, authenticated;
REVOKE ALL ON TABLE journal_categories FROM anon, authenticated;
