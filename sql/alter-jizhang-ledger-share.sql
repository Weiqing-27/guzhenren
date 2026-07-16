-- 账本可选共享关联：新建账本时可关联某一账本数据，默认不共享
ALTER TABLE jz_ledgers
  ADD COLUMN IF NOT EXISTS share_from_ledger_id UUID REFERENCES jz_ledgers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jz_ledgers_share_from
  ON jz_ledgers(share_from_ledger_id);
