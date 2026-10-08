-- 薪资模块：请在 Supabase SQL Editor 中一次性执行
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.salary_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  salary_month DATE NOT NULL CHECK (EXTRACT(DAY FROM salary_month) = 1),
  employee_name VARCHAR(100) NOT NULL DEFAULT '',
  currency VARCHAR(3) NOT NULL DEFAULT 'CNY',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  expected_attendance_days NUMERIC(6,2),
  actual_attendance_days NUMERIC(6,2),
  gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT salary_records_user_month_unique UNIQUE (user_id, salary_month)
);

CREATE TABLE IF NOT EXISTS public.salary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salary_record_id UUID NOT NULL REFERENCES public.salary_records(id) ON DELETE CASCADE,
  item_name VARCHAR(100) NOT NULL,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('earning', 'deduction')),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  percentage NUMERIC(7,3),
  value_text VARCHAR(100) NOT NULL DEFAULT '',
  included_in_total BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_records_user_month ON public.salary_records(user_id, salary_month DESC);
CREATE INDEX IF NOT EXISTS idx_salary_items_record_sort ON public.salary_items(salary_record_id, sort_order);

CREATE OR REPLACE FUNCTION public.set_salary_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_salary_records_updated_at ON public.salary_records;
CREATE TRIGGER trg_salary_records_updated_at
BEFORE UPDATE ON public.salary_records
FOR EACH ROW EXECUTE FUNCTION public.set_salary_updated_at();

DROP TRIGGER IF EXISTS trg_salary_items_updated_at ON public.salary_items;
CREATE TRIGGER trg_salary_items_updated_at
BEFORE UPDATE ON public.salary_items
FOR EACH ROW EXECUTE FUNCTION public.set_salary_updated_at();

-- 客户端不直连表；仅后端 service role 在通过自定义 JWT 校验后读写。
ALTER TABLE public.salary_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.salary_records FROM anon, authenticated;
REVOKE ALL ON public.salary_items FROM anon, authenticated;
