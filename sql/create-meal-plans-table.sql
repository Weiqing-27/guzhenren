-- 创建餐饮计划表 (meal_plans)
CREATE TABLE IF NOT EXISTS meal_plans (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    ingredients JSONB NOT NULL,
    steps JSONB NOT NULL,
    difficulty VARCHAR(10) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    estimated_time INTEGER DEFAULT 30,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'cooking', 'completed', 'cancelled')),
    planned_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_meal_plans_user_id ON meal_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_planned_date ON meal_plans(planned_date);
CREATE INDEX IF NOT EXISTS idx_meal_plans_status ON meal_plans(status);
CREATE INDEX IF NOT EXISTS idx_meal_plans_difficulty ON meal_plans(difficulty);

-- 添加更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_meal_plans_updated_at 
    BEFORE UPDATE ON meal_plans 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- 插入一些示例数据（可选）
INSERT INTO meal_plans (user_id, title, description, ingredients, steps, difficulty, estimated_time, status, planned_date) VALUES
(NULL, '番茄炒蛋', '经典的家常菜', '["鸡蛋", "番茄", "葱", "盐", "油"]', '["打散鸡蛋", "切番茄", "热锅下油", "先炒鸡蛋", "再加番茄", "调味出锅"]', 'easy', 15, 'pending', CURRENT_DATE),
(NULL, '红烧肉', '传统中式菜肴', '["五花肉", "冰糖", "生抽", "老抽", "料酒", "姜片"]', '["五花肉切块", "焯水去腥", "炒糖色", "下肉翻炒", "加调料炖煮", "收汁装盘"]', 'medium', 60, 'pending', CURRENT_DATE + 1)
ON CONFLICT DO NOTHING;