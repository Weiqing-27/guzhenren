-- 将 couple_media 从旧 custom_user 用户体系迁移到当前 users 用户体系。
-- 在 Supabase SQL Editor 执行。NOT VALID 保留可能存在的旧用户历史记录，
-- 同时保证今后新写入的 user_id 必须存在于 users.user_id。

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.couple_media'::regclass
      AND c.contype = 'f'
      AND a.attname = 'user_id'
  LOOP
    EXECUTE format('ALTER TABLE public.couple_media DROP CONSTRAINT %I', fk.conname);
  END LOOP;
END $$;

ALTER TABLE public.couple_media
  ADD CONSTRAINT couple_media_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.users(user_id)
  ON DELETE CASCADE
  NOT VALID;

CREATE INDEX IF NOT EXISTS idx_couple_media_user_created
  ON public.couple_media(user_id, created_at DESC);
