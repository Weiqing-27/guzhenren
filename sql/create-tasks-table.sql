-- 创建任务表
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) DEFAULT 'work', -- work|study|project
  priority VARCHAR(20) DEFAULT 'medium', -- low|medium|high
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  start_date DATE,
  end_date DATE,
  status VARCHAR(50) DEFAULT 'todo', -- todo|in-progress|completed
  -- user_id字段设置为允许NULL，符合个人项目规范
  user_id UUID DEFAULT NULL, -- 根据个人项目规范，允许为空
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引提高查询性能
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
-- 由于user_id可能为空，为其创建索引时需要注意
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON tasks(start_date);
CREATE INDEX IF NOT EXISTS idx_tasks_end_date ON tasks(end_date);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- 如果需要支持计划类型（周/月/年），创建一个简化版的计划表
-- 根据个人项目规范，移除外键约束，仅使用整数关联
CREATE TABLE IF NOT EXISTS task_plans (
  id SERIAL PRIMARY KEY,
  task_id INTEGER DEFAULT NULL, -- 引用tasks表的id，但不设置外键约束，允许为空
  plan_type VARCHAR(20) DEFAULT 'week', -- week|month|year
  plan_title VARCHAR(255),
  plan_description TEXT,
  start_date DATE,
  end_date DATE,
  status VARCHAR(50) DEFAULT 'active', -- active|completed|archived
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 为计划表创建索引
CREATE INDEX IF NOT EXISTS idx_task_plans_task_id ON task_plans(task_id);
CREATE INDEX IF NOT EXISTS idx_task_plans_plan_type ON task_plans(plan_type);
CREATE INDEX IF NOT EXISTS idx_task_plans_status ON task_plans(status);