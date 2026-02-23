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