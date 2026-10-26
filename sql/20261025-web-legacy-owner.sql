-- Explicit user-authorized allocation: ownerless legacy web records belong to username weiqing.
-- Execute AFTER 20261025-web-security.sql. Never changes records that already have an owner.
BEGIN;
SELECT 'tasks' AS table_name, count(*) AS ownerless_records FROM public.tasks WHERE user_id IS NULL
UNION ALL SELECT 'diaries', count(*) FROM public.diaries WHERE user_id IS NULL
UNION ALL SELECT 'submissions', count(*) FROM public.submissions WHERE user_id IS NULL
UNION ALL SELECT 'linked_task_plans', count(*) FROM public.task_plans p JOIN public.tasks t ON t.id=p.task_id WHERE p.user_id IS NULL AND t.user_id IS NULL;
DO $$
DECLARE target_id uuid; matching_users integer; changed_rows bigint;
BEGIN
  SELECT count(*) INTO matching_users FROM public.users WHERE username = 'weiqing';
  IF matching_users <> 1 THEN
    RAISE EXCEPTION 'Historical owner allocation aborted: expected exactly one username=weiqing, found %', matching_users;
  END IF;
  SELECT user_id INTO target_id FROM public.users WHERE username = 'weiqing';
  IF target_id IS NULL THEN RAISE EXCEPTION 'Historical owner allocation aborted: weiqing has no user_id'; END IF;
  UPDATE public.tasks SET user_id=target_id WHERE user_id IS NULL;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RAISE NOTICE 'Allocated % tasks to weiqing', changed_rows;
  UPDATE public.diaries SET user_id=target_id WHERE user_id IS NULL;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RAISE NOTICE 'Allocated % diaries to weiqing', changed_rows;
  UPDATE public.submissions SET user_id=target_id WHERE user_id IS NULL;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RAISE NOTICE 'Allocated % submissions to weiqing', changed_rows;
  -- A plan follows its confirmed parent task, and only plans linked to this account are allocated.
  UPDATE public.task_plans p SET user_id=target_id FROM public.tasks t
    WHERE p.task_id=t.id AND p.user_id IS NULL AND t.user_id=target_id;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RAISE NOTICE 'Allocated % linked task_plans to weiqing', changed_rows;
END $$;
SELECT 'tasks' AS table_name, count(*) AS remaining_ownerless FROM public.tasks WHERE user_id IS NULL
UNION ALL SELECT 'diaries', count(*) FROM public.diaries WHERE user_id IS NULL
UNION ALL SELECT 'submissions', count(*) FROM public.submissions WHERE user_id IS NULL
UNION ALL SELECT 'unlinked_or_other_owner_task_plans', count(*) FROM public.task_plans WHERE user_id IS NULL;
COMMIT;
