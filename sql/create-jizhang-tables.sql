-- ============================================================
-- 记账本 (jizhang) 模块 - Supabase 建表脚本
-- 在 Supabase SQL Editor 中执行本文件
-- ============================================================

-- 1. 用户资料（与 Supabase Auth users.id 对齐）
CREATE TABLE IF NOT EXISTS jz_user_profiles (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    wechat_openid VARCHAR(64),
    wechat_unionid VARCHAR(64),
    nickname VARCHAR(100),
    avatar_url TEXT,
    profile_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 账本
CREATE TABLE IF NOT EXISTS jz_ledgers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES jz_user_profiles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(20) DEFAULT '📗',
    color VARCHAR(7) DEFAULT '#10B981',
    is_default BOOLEAN DEFAULT FALSE,
    share_from_ledger_id UUID REFERENCES jz_ledgers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jz_ledgers_user_id ON jz_ledgers(user_id);

-- 3. 分类（user_id 为空表示系统默认分类）
CREATE TABLE IF NOT EXISTS jz_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES jz_user_profiles(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
    icon VARCHAR(20) DEFAULT '📦',
    color VARCHAR(7) DEFAULT '#9CA3AF',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jz_categories_user_id ON jz_categories(user_id);
CREATE INDEX IF NOT EXISTS idx_jz_categories_type ON jz_categories(type);

-- 4. 交易记录
CREATE TABLE IF NOT EXISTS jz_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES jz_user_profiles(id) ON DELETE CASCADE,
    ledger_id UUID NOT NULL REFERENCES jz_ledgers(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    category_id UUID REFERENCES jz_categories(id) ON DELETE SET NULL,
    category_name VARCHAR(50),
    amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
    note TEXT,
    icon VARCHAR(20),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    account_id UUID,
    to_account_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jz_transactions_user_id ON jz_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_jz_transactions_ledger_id ON jz_transactions(ledger_id);
CREATE INDEX IF NOT EXISTS idx_jz_transactions_date ON jz_transactions(date);
CREATE INDEX IF NOT EXISTS idx_jz_transactions_type ON jz_transactions(type);

-- 5. 预算
CREATE TABLE IF NOT EXISTS jz_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES jz_user_profiles(id) ON DELETE CASCADE,
    ledger_id UUID NOT NULL REFERENCES jz_ledgers(id) ON DELETE CASCADE,
    category_id UUID REFERENCES jz_categories(id) ON DELETE SET NULL,
    category_name VARCHAR(50),
    amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
    month VARCHAR(7) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (ledger_id, category_id, month)
);

CREATE INDEX IF NOT EXISTS idx_jz_budgets_user_ledger_month ON jz_budgets(user_id, ledger_id, month);

-- 6. 资产账户
CREATE TABLE IF NOT EXISTS jz_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES jz_user_profiles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) DEFAULT 'other' CHECK (type IN ('cash', 'bank', 'credit', 'other')),
    balance DECIMAL(12, 2) DEFAULT 0,
    initial_balance DECIMAL(12, 2) DEFAULT 0,
    icon VARCHAR(20) DEFAULT '💳',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jz_accounts_user_id ON jz_accounts(user_id);

-- 7. 用户设置
CREATE TABLE IF NOT EXISTS jz_user_settings (
    user_id UUID PRIMARY KEY REFERENCES jz_user_profiles(id) ON DELETE CASCADE,
    current_ledger_id UUID REFERENCES jz_ledgers(id) ON DELETE SET NULL,
    monthly_budget_total DECIMAL(12, 2) DEFAULT 3500,
    currency VARCHAR(10) DEFAULT 'CNY',
    currency_symbol VARCHAR(5) DEFAULT '¥',
    notification BOOLEAN DEFAULT TRUE,
    salary_day INTEGER DEFAULT 1 CHECK (salary_day IS NULL OR (salary_day >= 1 AND salary_day <= 28)),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. 邮箱验证码（Supabase Auth 不可用时的备用 / 开发调试）
CREATE TABLE IF NOT EXISTS jz_email_otp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jz_email_otp_email ON jz_email_otp(email);

-- 9. 手机验证码（阿里云短信）
CREATE TABLE IF NOT EXISTS jz_phone_otp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jz_phone_otp_phone ON jz_phone_otp(phone);

-- 默认分类在用户首次登录时由后端自动关联系统分类（user_id IS NULL）
-- 如需预置系统分类，可执行：
-- INSERT INTO jz_categories (user_id, name, type, icon, color) VALUES
-- (NULL, '食品餐饮', 'expense', '🍜', '#F59E0B'),
-- (NULL, '日用百货', 'expense', '🛒', '#10B981');
-- ... 更多分类见 utils/jizhangHelpers.js

-- 注意：若 gen_random_uuid() 不可用，请在 Supabase 启用 pgcrypto 扩展：
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";
