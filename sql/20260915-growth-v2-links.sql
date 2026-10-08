-- Growth Phase 2: 建立路线任务与学习证据的可追溯关联。
-- 字段允许为 null，表示用户显式选择“路线外学习”。

BEGIN;

ALTER TABLE growth_roadmaps
  ADD COLUMN IF NOT EXISTS template_version integer NOT NULL DEFAULT 1;

ALTER TABLE growth_roadmap_tasks
  ADD COLUMN IF NOT EXISTS acceptance_criteria text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seed_key text,
  ADD COLUMN IF NOT EXISTS is_required boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS growth_roadmap_tasks_id_user_unique
  ON growth_roadmap_tasks(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS growth_roadmap_tasks_month_seed_unique
  ON growth_roadmap_tasks(roadmap_month_id, seed_key)
  WHERE seed_key IS NOT NULL;

ALTER TABLE growth_learning_logs ADD COLUMN IF NOT EXISTS roadmap_task_id uuid;
ALTER TABLE growth_knowledge_items ADD COLUMN IF NOT EXISTS roadmap_task_id uuid;
ALTER TABLE growth_practices ADD COLUMN IF NOT EXISTS roadmap_task_id uuid;
ALTER TABLE growth_projects ADD COLUMN IF NOT EXISTS roadmap_task_id uuid;
ALTER TABLE growth_practices
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user_created';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'growth_learning_logs_task_owner_fk') THEN
    ALTER TABLE growth_learning_logs
      ADD CONSTRAINT growth_learning_logs_task_owner_fk
      FOREIGN KEY (roadmap_task_id, user_id)
      REFERENCES growth_roadmap_tasks(id, user_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'growth_knowledge_items_task_owner_fk') THEN
    ALTER TABLE growth_knowledge_items
      ADD CONSTRAINT growth_knowledge_items_task_owner_fk
      FOREIGN KEY (roadmap_task_id, user_id)
      REFERENCES growth_roadmap_tasks(id, user_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'growth_practices_task_owner_fk') THEN
    ALTER TABLE growth_practices
      ADD CONSTRAINT growth_practices_task_owner_fk
      FOREIGN KEY (roadmap_task_id, user_id)
      REFERENCES growth_roadmap_tasks(id, user_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'growth_projects_task_owner_fk') THEN
    ALTER TABLE growth_projects
      ADD CONSTRAINT growth_projects_task_owner_fk
      FOREIGN KEY (roadmap_task_id, user_id)
      REFERENCES growth_roadmap_tasks(id, user_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'growth_practices_source_check') THEN
    ALTER TABLE growth_practices
      ADD CONSTRAINT growth_practices_source_check
      CHECK (source IN ('system', 'ai_generated', 'external', 'user_created'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS growth_learning_logs_task_idx ON growth_learning_logs(user_id, roadmap_task_id, log_date DESC);
CREATE INDEX IF NOT EXISTS growth_knowledge_items_task_idx ON growth_knowledge_items(user_id, roadmap_task_id);
CREATE INDEX IF NOT EXISTS growth_practices_task_idx ON growth_practices(user_id, roadmap_task_id, source);
CREATE INDEX IF NOT EXISTS growth_projects_task_idx ON growth_projects(user_id, roadmap_task_id);

COMMIT;
