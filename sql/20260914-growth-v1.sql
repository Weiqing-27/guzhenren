-- 前端工程师成长系统 V1。仅新增 growth_* 表，不修改现有业务表。
-- 当前服务端使用自定义 JWT，并通过 service_role 访问这些表；因此启用 RLS 且不向
-- anon/authenticated 创建直连策略。所有访问必须经过 /api/v1/growth。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION growth_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS growth_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  week_starts_on smallint NOT NULL DEFAULT 1 CHECK (week_starts_on BETWEEN 1 AND 7),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_roadmaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS growth_one_active_roadmap_per_user ON growth_roadmaps(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS growth_roadmaps_user_status_idx ON growth_roadmaps(user_id, status);

CREATE TABLE IF NOT EXISTS growth_roadmap_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  roadmap_id uuid NOT NULL REFERENCES growth_roadmaps(id) ON DELETE CASCADE,
  month_number smallint NOT NULL CHECK (month_number BETWEEN 1 AND 12),
  title text NOT NULL,
  goal text NOT NULL DEFAULT '',
  core_learning text NOT NULL DEFAULT '',
  deliverable text NOT NULL DEFAULT '',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (roadmap_id, month_number),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS growth_roadmap_months_user_idx ON growth_roadmap_months(user_id, roadmap_id, sort_order);

CREATE TABLE IF NOT EXISTS growth_roadmap_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  roadmap_month_id uuid NOT NULL REFERENCES growth_roadmap_months(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  task_type text NOT NULL DEFAULT 'other' CHECK (task_type IN ('knowledge', 'practice', 'project', 'review', 'other')),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'skipped')),
  weight numeric(8,2) NOT NULL DEFAULT 1 CHECK (weight > 0),
  planned_minutes integer NOT NULL DEFAULT 0 CHECK (planned_minutes >= 0),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS growth_roadmap_tasks_user_status_idx ON growth_roadmap_tasks(user_id, status, due_date);
CREATE INDEX IF NOT EXISTS growth_roadmap_tasks_month_idx ON growth_roadmap_tasks(roadmap_month_id);

CREATE TABLE IF NOT EXISTS growth_knowledge_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  parent_id uuid REFERENCES growth_knowledge_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

CREATE TABLE IF NOT EXISTS growth_knowledge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_id uuid REFERENCES growth_knowledge_categories(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'learning', 'understood', 'practiced', 'mastered')),
  mastery_score numeric(4,2) NOT NULL DEFAULT 0 CHECK (mastery_score BETWEEN 0 AND 10),
  what_text text NOT NULL DEFAULT '',
  why_text text NOT NULL DEFAULT '',
  how_text text NOT NULL DEFAULT '',
  when_text text NOT NULL DEFAULT '',
  when_not_text text NOT NULL DEFAULT '',
  examples text NOT NULL DEFAULT '',
  my_summary text NOT NULL DEFAULT '',
  last_studied_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS growth_knowledge_user_status_idx ON growth_knowledge_items(user_id, status, category_id);

CREATE TABLE IF NOT EXISTS growth_learning_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  log_date date NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  topic text NOT NULL,
  learned text NOT NULL DEFAULT '',
  problem text NOT NULL DEFAULT '',
  solution text NOT NULL DEFAULT '',
  tomorrow_plan text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS growth_learning_logs_user_date_idx ON growth_learning_logs(user_id, log_date DESC);

CREATE TABLE IF NOT EXISTS growth_practices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  knowledge_item_id uuid REFERENCES growth_knowledge_items(id) ON DELETE SET NULL,
  title text NOT NULL,
  practice_type text NOT NULL DEFAULT 'concept' CHECK (practice_type IN ('concept', 'predict', 'coding', 'debug', 'review', 'architecture')),
  difficulty text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  prompt text NOT NULL,
  reference_answer text,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS growth_practices_user_filter_idx ON growth_practices(user_id, status, practice_type, difficulty);

CREATE TABLE IF NOT EXISTS growth_practice_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES growth_practices(id) ON DELETE CASCADE,
  answer text NOT NULL,
  result text NOT NULL DEFAULT 'submitted' CHECK (result IN ('submitted', 'passed', 'failed', 'partial')),
  self_reflection text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS growth_attempts_user_date_idx ON growth_practice_attempts(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS growth_attempts_practice_idx ON growth_practice_attempts(practice_id);

CREATE TABLE IF NOT EXISTS growth_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused', 'completed', 'archived')),
  tech_stack text[] NOT NULL DEFAULT '{}',
  repository_url text,
  demo_url text,
  lessons text NOT NULL DEFAULT '',
  started_on date,
  completed_on date,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS growth_projects_user_status_idx ON growth_projects(user_id, status);

CREATE TABLE IF NOT EXISTS growth_project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES growth_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'skipped')),
  due_date date,
  completed_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS growth_milestones_project_idx ON growth_project_milestones(user_id, project_id, sort_order);

CREATE TABLE IF NOT EXISTS growth_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  review_type text NOT NULL CHECK (review_type IN ('weekly', 'monthly')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  planned text NOT NULL DEFAULT '',
  completed text NOT NULL DEFAULT '',
  problems text NOT NULL DEFAULT '',
  wins text NOT NULL DEFAULT '',
  next_plan text NOT NULL DEFAULT '',
  metrics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, review_type, period_start, period_end),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS growth_reviews_user_period_idx ON growth_reviews(user_id, review_type, period_start DESC);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'growth_profiles', 'growth_roadmaps', 'growth_roadmap_months', 'growth_roadmap_tasks',
    'growth_knowledge_categories', 'growth_knowledge_items', 'growth_learning_logs',
    'growth_practices', 'growth_practice_attempts', 'growth_projects',
    'growth_project_milestones', 'growth_reviews'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_updated_at', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION growth_set_updated_at()', table_name || '_updated_at', table_name);
  END LOOP;
END;
$$;
