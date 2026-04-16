-- 创建 questions 题目表
CREATE TABLE IF NOT EXISTS questions (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('theory', 'coding')),
  difficulty VARCHAR(50) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  code_template TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建 submissions 提交记录表
CREATE TABLE IF NOT EXISTS submissions (
  id BIGSERIAL PRIMARY KEY,
  question_id BIGINT REFERENCES questions(id) ON DELETE CASCADE,
  user_code TEXT NOT NULL,
  ai_result TEXT NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('正确', '错误')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 为 questions 表添加索引
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_questions_created_at ON questions(created_at DESC);

-- 为 submissions 表添加索引
CREATE INDEX IF NOT EXISTS idx_submissions_question_id ON submissions(question_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at DESC);

-- 添加注释
COMMENT ON TABLE questions IS '前端面试题目表';
COMMENT ON COLUMN questions.id IS '题目ID';
COMMENT ON COLUMN questions.title IS '题目名称';
COMMENT ON COLUMN questions.content IS '题目描述';
COMMENT ON COLUMN questions.type IS '题目类型: theory(理论题) 或 coding(编程题)';
COMMENT ON COLUMN questions.difficulty IS '难度等级: easy, medium, hard';
COMMENT ON COLUMN questions.code_template IS '代码模板(仅编程题需要)';
COMMENT ON COLUMN questions.created_at IS '创建时间';

COMMENT ON TABLE submissions IS '用户提交记录表';
COMMENT ON COLUMN submissions.id IS '提交记录ID';
COMMENT ON COLUMN submissions.question_id IS '关联的题目ID';
COMMENT ON COLUMN submissions.user_code IS '用户提交的代码';
COMMENT ON COLUMN submissions.ai_result IS 'AI判题结果原文';
COMMENT ON COLUMN submissions.status IS '判题状态: 正确/错误';
COMMENT ON COLUMN submissions.created_at IS '提交时间';
