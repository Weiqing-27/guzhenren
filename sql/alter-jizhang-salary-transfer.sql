-- 发薪日 + 转账/还款支持
-- 在 Supabase SQL Editor 中执行

ALTER TABLE jz_user_settings
  ADD COLUMN IF NOT EXISTS salary_day INTEGER DEFAULT 1
  CHECK (salary_day IS NULL OR (salary_day >= 1 AND salary_day <= 28));

ALTER TABLE jz_transactions
  DROP CONSTRAINT IF EXISTS jz_transactions_type_check;

ALTER TABLE jz_transactions
  ADD CONSTRAINT jz_transactions_type_check
  CHECK (type IN ('income', 'expense', 'transfer'));

ALTER TABLE jz_transactions
  ADD COLUMN IF NOT EXISTS to_account_id UUID;
