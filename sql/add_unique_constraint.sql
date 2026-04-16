-- 为 questions 表添加唯一约束，防止重复题目
-- 如果表已存在且没有该约束，执行此脚本

-- 检查并添加唯一约束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uk_questions_title'
  ) THEN
    ALTER TABLE questions ADD CONSTRAINT uk_questions_title UNIQUE (title);
    RAISE NOTICE '成功添加唯一约束 uk_questions_title';
  ELSE
    RAISE NOTICE '唯一约束 uk_questions_title 已存在';
  END IF;
END $$;

-- 验证约束是否添加成功
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'questions'::regclass 
  AND conname = 'uk_questions_title';
