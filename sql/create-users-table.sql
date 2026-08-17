/*
 * 【功能描述】
 * 创建统一 users 用户表，含用户名/邮箱/密码哈希及基础资料字段，并插入测试用户。
 *
 * 【业务逻辑】
 * 1. CREATE TABLE users（UUID 主键 user_id）
 * 2. 创建 username/email/role 索引
 * 3. INSERT 测试用户 anyutestuser（ON CONFLICT 跳过）
 *
 * 【技术实现】
 * - 涉及表：users
 * - 涉及知识点：gen_random_uuid()、UNIQUE 约束、bcrypt 密码哈希
 *
 * 用法：在 Supabase SQL Editor 中执行
 */

-- 创建新的用户表，使用统一的user_id命名
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url TEXT DEFAULT 'https://ui-avatars.com/api/?name=U&background=random',
    role VARCHAR(20) DEFAULT 'user',
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    date_joined TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 插入测试用户
INSERT INTO users (username, email, password_hash, first_name, last_name) VALUES
('anyutestuser', 'test@example.com', '$2b$10$zVaKHyCEAwRFEUqTWJmr9.0GyiTu/rJRqwY.luYCaoITAxuXy7zO.', '测试', '用户')
ON CONFLICT (username) DO NOTHING;