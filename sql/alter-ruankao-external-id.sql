-- 题库去重字段：导入外部题库时使用（UNIQUE 允许多个 NULL）
ALTER TABLE ruankao_questions
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(120);

ALTER TABLE ruankao_knowledge
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(120);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ruankao_questions_external_id_key'
  ) THEN
    ALTER TABLE ruankao_questions ADD CONSTRAINT ruankao_questions_external_id_key UNIQUE (external_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ruankao_knowledge_external_id_key'
  ) THEN
    ALTER TABLE ruankao_knowledge ADD CONSTRAINT ruankao_knowledge_external_id_key UNIQUE (external_id);
  END IF;
END $$;
