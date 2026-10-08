-- Growth Phase 3: 复用现有 questions 题库，并记录可审计的 AI 判卷结果。
-- 执行前提：已执行 20260914-growth-v1.sql 与 20260915-growth-v2-links.sql。

BEGIN;

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS reference_answer text,
  ADD COLUMN IF NOT EXISTS scoring_rubric text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'system';

ALTER TABLE growth_practices
  ADD COLUMN IF NOT EXISTS question_id bigint REFERENCES questions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scoring_rubric text;

ALTER TABLE growth_practice_attempts
  ADD COLUMN IF NOT EXISTS self_assessment text,
  ADD COLUMN IF NOT EXISTS system_score numeric(4,2),
  ADD COLUMN IF NOT EXISTS system_feedback text,
  ADD COLUMN IF NOT EXISTS evaluator text,
  ADD COLUMN IF NOT EXISTS graded_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_source_check') THEN
    ALTER TABLE questions
      ADD CONSTRAINT questions_source_check
      CHECK (source IN ('system', 'ai_generated', 'external', 'user_created'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'growth_attempts_self_assessment_check') THEN
    ALTER TABLE growth_practice_attempts
      ADD CONSTRAINT growth_attempts_self_assessment_check
      CHECK (self_assessment IS NULL OR self_assessment IN ('mastered', 'partial', 'not_mastered'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'growth_attempts_system_score_check') THEN
    ALTER TABLE growth_practice_attempts
      ADD CONSTRAINT growth_attempts_system_score_check
      CHECK (system_score IS NULL OR system_score BETWEEN 0 AND 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'growth_attempts_evaluator_check') THEN
    ALTER TABLE growth_practice_attempts
      ADD CONSTRAINT growth_attempts_evaluator_check
      CHECK (evaluator IS NULL OR evaluator IN ('deepseek', 'manual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS questions_topic_filter_idx
  ON questions(topic, difficulty, type);
CREATE INDEX IF NOT EXISTS growth_practices_question_idx
  ON growth_practices(user_id, question_id);
CREATE INDEX IF NOT EXISTS growth_attempts_objective_score_idx
  ON growth_practice_attempts(user_id, system_score, submitted_at DESC);

COMMIT;
