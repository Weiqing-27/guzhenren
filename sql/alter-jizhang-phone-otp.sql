-- 手机验证码表（需配合阿里云短信环境变量）
CREATE TABLE IF NOT EXISTS jz_phone_otp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jz_phone_otp_phone ON jz_phone_otp(phone);
