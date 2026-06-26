-- 微信小程序登录：用户资料支持微信 openid（已有库请单独执行）
ALTER TABLE jz_user_profiles
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE jz_user_profiles
  ADD COLUMN IF NOT EXISTS wechat_openid VARCHAR(64);

ALTER TABLE jz_user_profiles
  ADD COLUMN IF NOT EXISTS wechat_unionid VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jz_user_profiles_wechat_openid
  ON jz_user_profiles(wechat_openid)
  WHERE wechat_openid IS NOT NULL;
