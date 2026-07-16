-- 账户期初余额：余额 = 期初 + 流水净变动
-- 新建/编辑账户时写入；「按流水重算」用此字段保留建账欠款，避免被清零
ALTER TABLE jz_accounts
  ADD COLUMN IF NOT EXISTS initial_balance DECIMAL(12, 2) DEFAULT 0;

-- 已有行：默认期初 0（若曾有期初欠款，请在账户管理把余额改成「当前真实欠款」保存，系统会回推期初）
UPDATE jz_accounts
SET initial_balance = 0
WHERE initial_balance IS NULL;
