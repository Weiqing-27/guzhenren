-- Run using the Supabase SQL Editor before deploying the code workspace API.
-- App JWTs are checked by Express; only its service-role client may access this table.
BEGIN;

CREATE TABLE IF NOT EXISTS public.code_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL CONSTRAINT code_workspaces_user_id_fkey REFERENCES public.users(user_id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL CHECK (length(btrim(title)) > 0),
  category VARCHAR(60) NOT NULL DEFAULT '未分类',
  html TEXT NOT NULL DEFAULT '' CHECK (octet_length(html) <= 200000),
  css TEXT NOT NULL DEFAULT '' CHECK (octet_length(css) <= 200000),
  js TEXT NOT NULL DEFAULT '' CHECK (octet_length(js) <= 200000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (octet_length(html) + octet_length(css) + octet_length(js) <= 500000)
);
-- Also constrain a table created by an earlier deployment of this migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'code_workspaces_user_id_fkey'
      AND conrelid = 'public.code_workspaces'::regclass
  ) THEN
    ALTER TABLE public.code_workspaces ADD CONSTRAINT code_workspaces_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS code_workspaces_owner_updated_idx ON public.code_workspaces(user_id, updated_at DESC, id);
ALTER TABLE public.code_workspaces ENABLE ROW LEVEL SECURITY;
-- Re-running also closes any previous direct-browser policy/column-grant access.
DO $$
DECLARE old_policy text; columns_list text;
BEGIN
  FOR old_policy IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='code_workspaces' LOOP
    EXECUTE format('DROP POLICY %I ON public.code_workspaces', old_policy);
  END LOOP;
  SELECT string_agg(quote_ident(column_name), ',') INTO columns_list
    FROM information_schema.columns WHERE table_schema='public' AND table_name='code_workspaces';
  EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON TABLE public.code_workspaces FROM PUBLIC, anon, authenticated', columns_list, columns_list, columns_list, columns_list);
END $$;
REVOKE ALL ON TABLE public.code_workspaces FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.code_workspaces TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
