-- Run in Supabase SQL Editor BEFORE deploying the matching backend.
-- This script never assigns ownerless historical records to a guessed account.
BEGIN;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.diaries ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.task_plans ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS topic text;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS reference_answer text;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS scoring_rubric text;
ALTER TABLE public.ruankao_questions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS score numeric;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS feedback text;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS correct_answer text;
CREATE INDEX IF NOT EXISTS idx_tasks_owner_created ON public.tasks(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_period ON public.tasks(user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_diaries_owner_created ON public.diaries(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_owner_created ON public.submissions(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ruankao_questions_active ON public.ruankao_questions(id) WHERE deleted_at IS NULL;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['tasks', 'diaries', 'submissions', 'task_plans'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = table_name || '_web_owner_required' AND conrelid = format('public.%I', table_name)::regclass) THEN
      -- NOT VALID preserves ownerless history, but rejects new ownerless writes.
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (user_id IS NOT NULL) NOT VALID', table_name, table_name || '_web_owner_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = table_name || '_web_owner_fk' AND conrelid = format('public.%I', table_name)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.users(user_id) NOT VALID', table_name, table_name || '_web_owner_fk');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_plans_web_task_fk' AND conrelid = 'public.task_plans'::regclass) THEN
    ALTER TABLE public.task_plans ADD CONSTRAINT task_plans_web_task_fk FOREIGN KEY(task_id) REFERENCES public.tasks(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submissions_web_score_range' AND conrelid = 'public.submissions'::regclass) THEN
    ALTER TABLE public.submissions ADD CONSTRAINT submissions_web_score_range CHECK(score IS NULL OR score BETWEEN 0 AND 10) NOT VALID;
  END IF;
END $$;

-- App JWTs are verified by Express; auth.uid() is NOT this application's users.user_id.
-- Remove permissive policies and direct browser access, including role/password mutation on users.
DO $$
DECLARE t text; policy_name text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','tasks','diaries','submissions','task_plans','ruankao_questions','ruankao_attempts','ruankao_wrong_book','ruankao_notes','ruankao_checkins','ruankao_knowledge','questions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR policy_name IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, t);
    END LOOP;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    -- Prior column-level grants are independent from table grants; revoke them too.
    EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      (SELECT string_agg(quote_ident(column_name), ',') FROM information_schema.columns WHERE table_schema='public' AND information_schema.columns.table_name=t),
      (SELECT string_agg(quote_ident(column_name), ',') FROM information_schema.columns WHERE table_schema='public' AND information_schema.columns.table_name=t),
      (SELECT string_agg(quote_ident(column_name), ',') FROM information_schema.columns WHERE table_schema='public' AND information_schema.columns.table_name=t),
      (SELECT string_agg(quote_ident(column_name), ',') FROM information_schema.columns WHERE table_schema='public' AND information_schema.columns.table_name=t), t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;
-- Existing media/couple lookups may read public profiles; password hashes and writes stay server-only.
CREATE POLICY web_public_profile ON public.users FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT(user_id,username,avatar_url,role,created_at) ON public.users TO anon, authenticated;
-- The interview catalogue is public; reference answers/rubrics are only read on the server.
CREATE POLICY web_public_question_catalogue ON public.questions FOR SELECT TO anon, authenticated USING (deleted_at IS NULL);
GRANT SELECT(id,title,content,type,difficulty,code_template,topic,source,created_at,deleted_at) ON public.questions TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.web_ai_usage (
  user_id uuid NOT NULL REFERENCES public.users(user_id),
  action text NOT NULL,
  quota_date date NOT NULL,
  daily_used integer NOT NULL DEFAULT 0,
  minute_start timestamptz NOT NULL,
  minute_used integer NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, action, quota_date)
);
ALTER TABLE public.web_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.web_ai_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.web_ai_usage TO service_role;
CREATE OR REPLACE FUNCTION public.consume_web_ai_quota(p_user_id uuid, p_action text, p_units integer, p_daily_limit integer, p_minute_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE usage public.web_ai_usage%ROWTYPE;
  quota_day date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  minute_now timestamptz := date_trunc('minute', now());
BEGIN
  IF p_units < 1 OR p_units > p_daily_limit OR p_daily_limit < 1 OR p_minute_limit < 1 OR p_action NOT IN ('judge','generate','ruankao_generate') THEN RETURN false; END IF;
  INSERT INTO public.web_ai_usage(user_id, action, quota_date, minute_start)
    VALUES(p_user_id, p_action, quota_day, minute_now) ON CONFLICT DO NOTHING;
  SELECT * INTO usage FROM public.web_ai_usage WHERE user_id=p_user_id AND action=p_action AND quota_date=quota_day FOR UPDATE;
  IF usage.daily_used + p_units > p_daily_limit THEN RETURN false; END IF;
  IF usage.minute_start = minute_now AND usage.minute_used >= p_minute_limit THEN RETURN false; END IF;
  UPDATE public.web_ai_usage SET daily_used=daily_used+p_units, minute_start=minute_now,
    minute_used=CASE WHEN usage.minute_start=minute_now THEN usage.minute_used+1 ELSE 1 END
    WHERE user_id=p_user_id AND action=p_action AND quota_date=quota_day;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.consume_web_ai_quota(uuid,text,integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_web_ai_quota(uuid,text,integer,integer,integer) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
