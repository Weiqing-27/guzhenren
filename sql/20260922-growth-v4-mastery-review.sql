-- Growth Phase 4: 自动掌握度 L0-L5、知识达标率与复盘调整证据。
-- 执行前提：已执行至 20260915-growth-v3-ai-practice.sql。

BEGIN;

ALTER TABLE growth_roadmap_tasks
  ADD COLUMN IF NOT EXISTS required_mastery_level integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS recommendation_priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'growth_tasks_required_mastery_check') THEN
    ALTER TABLE growth_roadmap_tasks
      ADD CONSTRAINT growth_tasks_required_mastery_check
      CHECK (required_mastery_level BETWEEN 0 AND 5);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS growth_mastery_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  roadmap_task_id uuid NOT NULL,
  level integer NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5),
  previous_level integer NOT NULL DEFAULT 0 CHECK (previous_level BETWEEN 0 AND 5),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_requirement text NOT NULL DEFAULT '',
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  level_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, roadmap_task_id),
  CONSTRAINT growth_mastery_task_owner_fk
    FOREIGN KEY (roadmap_task_id, user_id)
    REFERENCES growth_roadmap_tasks(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS growth_mastery_user_level_idx
  ON growth_mastery_assessments(user_id, level, level_changed_at DESC);

ALTER TABLE growth_mastery_assessments ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS growth_mastery_assessments_updated_at ON growth_mastery_assessments;
CREATE TRIGGER growth_mastery_assessments_updated_at
  BEFORE UPDATE ON growth_mastery_assessments
  FOR EACH ROW EXECUTE FUNCTION growth_set_updated_at();

COMMIT;
