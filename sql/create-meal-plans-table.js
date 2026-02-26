const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// 创建Supabase客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function createMealPlansTable() {
  try {
    console.log('🚀 开始检查meal_plans表...');
    
    // 首先尝试创建表（如果不存在）
    const createTableSQL = `
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
    `;
    
    // 由于不能直接执行原始SQL，我们尝试通过其他方式验证表是否存在
    try {
      const { data, error } = await supabase
        .from('meal_plans')
        .select('id')
        .limit(1);
      
      if (error && error.code === '42P01') {
        console.log('❌ meal_plans表不存在，需要在Supabase控制台手动创建');
        console.log('📋 请在Supabase控制台的SQL编辑器中执行以下SQL:');
        console.log(createTableSQL);
        console.log('\n然后创建索引:');
        console.log(`
CREATE INDEX IF NOT EXISTS idx_meal_plans_user_id ON meal_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_planned_date ON meal_plans(planned_date);
CREATE INDEX IF NOT EXISTS idx_meal_plans_status ON meal_plans(status);
CREATE INDEX IF NOT EXISTS idx_meal_plans_difficulty ON meal_plans(difficulty);
        `);
        console.log('\n最后创建更新时间触发器:');
        console.log(`
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_meal_plans_updated_at ON meal_plans;
CREATE TRIGGER update_meal_plans_updated_at 
    BEFORE UPDATE ON meal_plans 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
        `);
        return;
      }
      
      console.log('✅ meal_plans表已存在');
      
    } catch (checkError) {
      if (checkError.message.includes('relation "meal_plans" does not exist')) {
        console.log('❌ meal_plans表不存在');
        console.log('📋 请在Supabase控制台的SQL编辑器中执行以下SQL:');
        console.log(createTableSQL);
        return;
      }
    }

    // 创建索引（实际使用时也需要在SQL编辑器中执行）
    console.log('🔍 检查索引...');
    // 索引通常也需要通过SQL编辑器创建

    // 插入示例数据
    console.log('📝 尝试插入示例数据...');
    const samplePlans = [
      {
        user_id: null, // 临时设置为null，实际使用时应该有关联的用户ID
        title: '番茄炒蛋',
        description: '经典的家常菜',
        ingredients: JSON.stringify(['鸡蛋', '番茄', '葱', '盐', '油']),
        steps: JSON.stringify(['打散鸡蛋', '切番茄', '热锅下油', '先炒鸡蛋', '再加番茄', '调味出锅']),
        difficulty: 'easy',
        estimated_time: 15,
        status: 'pending',
        planned_date: new Date().toISOString().split('T')[0]
      },
      {
        user_id: null, // 临时设置为null，实际使用时应该有关联的用户ID
        title: '红烧肉',
        description: '传统中式菜肴',
        ingredients: JSON.stringify(['五花肉', '冰糖', '生抽', '老抽', '料酒', '姜片']),
        steps: JSON.stringify(['五花肉切块', '焯水去腥', '炒糖色', '下肉翻炒', '加调料炖煮', '收汁装盘']),
        difficulty: 'medium',
        estimated_time: 60,
        status: 'pending',
        planned_date: new Date(Date.now() + 86400000).toISOString().split('T')[0] // 明天
      }
    ];

    const { data: insertedData, error: insertError } = await supabase
      .from('meal_plans')
      .insert(samplePlans)
      .select();

    if (insertError) {
      console.log('⚠️ 示例数据插入出现问题:', insertError.message);
    } else {
      console.log('✅ 示例数据插入成功');
      console.log('插入的数据:', insertedData);
    }

    console.log('🎉 meal_plans表检查完成！');
    
  } catch (error) {
    console.error('❌ 检查meal_plans表时发生错误:', error);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  createMealPlansTable();
}

module.exports = { createMealPlansTable };