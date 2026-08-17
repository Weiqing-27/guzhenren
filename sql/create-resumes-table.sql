/*
 * 【功能描述】
 * 简历模块建表：每用户一份简历，内容以 JSONB 存储。
 *
 * 【业务逻辑】
 * 1. CREATE TABLE resumes（user_id UNIQUE、content JSONB）
 * 2. 创建 user_id 与 updated_at 索引
 *
 * 【技术实现】
 * - 涉及表：resumes
 * - 涉及知识点：JSONB 文档存储、UNIQUE user_id 一对一
 *
 * 用法：在 Supabase SQL Editor 中执行
 */

-- 简历表：每用户一份简历，内容以 JSONB 存储
CREATE TABLE IF NOT EXISTS resumes (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_updated_at ON resumes(updated_at);
