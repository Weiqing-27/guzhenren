const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// 创建Supabase客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createAnyuTables() {
  try {
    console.log('开始创建安隅APP数据表...');
    
    // 按正确顺序创建表
    const tables = [
      { name: '分类表', func: 'create_categories_table' },
      { name: '账单表', func: 'create_bills_table' },
      { name: '情感事件表', func: 'create_emotional_events_table' },
      { name: '观点反思表', func: 'create_perspectives_table' },
      { name: '食谱表', func: 'create_recipes_table' },
      { name: '订单表', func: 'create_orders_table' }
    ];

    for (const table of tables) {
      console.log(`正在创建${table.name}...`);
      const { error } = await supabase.rpc(table.func);
      if (error) {
        console.log(`${table.name}可能已存在或创建失败:`, error.message);
      } else {
        console.log(`✅ ${table.name}创建成功`);
      }
    }

    console.log('所有表创建完成！');
  } catch (error) {
    console.error('创建表时发生错误:', error);
  }
}

// 定义创建各个表的函数
async function defineTableCreationFunctions() {
  try {
    console.log('定义表创建函数...');
    
    // 1. 创建分类表函数（必须最先创建）
    await supabase.rpc('create_or_replace_function', {
      name: 'create_categories_table',
      body: `
        CREATE TABLE IF NOT EXISTS categories (
          id SERIAL PRIMARY KEY,
          user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
          name VARCHAR(50) NOT NULL,
          type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'outcome')),
          icon VARCHAR(50),
          color VARCHAR(7) DEFAULT '#000000',
          is_default BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
        CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type);
      `
    });

    // 2. 创建账单表函数
    await supabase.rpc('create_or_replace_function', {
      name: 'create_bills_table',
      body: `
        CREATE TABLE IF NOT EXISTS bills (
          id SERIAL PRIMARY KEY,
          user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
          amount DECIMAL(10,2) NOT NULL,
          type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'outcome')),
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          description TEXT,
          date DATE NOT NULL DEFAULT CURRENT_DATE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_bills_user_id ON bills(user_id);
        CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(date);
        CREATE INDEX IF NOT EXISTS idx_bills_type ON bills(type);
        CREATE INDEX IF NOT EXISTS idx_bills_category_id ON bills(category_id);
      `
    });

    // 3. 创建情感事件表函数
    await supabase.rpc('create_or_replace_function', {
      name: 'create_emotional_events_table',
      body: `
        CREATE TABLE IF NOT EXISTS emotional_events (
          id SERIAL PRIMARY KEY,
          user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
          title VARCHAR(200) NOT NULL,
          content TEXT,
          mood VARCHAR(20) NOT NULL CHECK (mood IN ('happy', 'sad', 'angry', 'neutral', 'excited', 'anxious')),
          date DATE NOT NULL DEFAULT CURRENT_DATE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_emotional_events_user_id ON emotional_events(user_id);
        CREATE INDEX IF NOT EXISTS idx_emotional_events_date ON emotional_events(date);
      `
    });

    // 4. 创建观点反思表函数
    await supabase.rpc('create_or_replace_function', {
      name: 'create_perspectives_table',
      body: `
        CREATE TABLE IF NOT EXISTS perspectives (
          id SERIAL PRIMARY KEY,
          user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
          event_id INTEGER REFERENCES emotional_events(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          perspective_type VARCHAR(20) NOT NULL CHECK (perspective_type IN ('reflection', 'insight', 'action')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_perspectives_user_id ON perspectives(user_id);
        CREATE INDEX IF NOT EXISTS idx_perspectives_event_id ON perspectives(event_id);
      `
    });

    // 5. 创建食谱表函数
    await supabase.rpc('create_or_replace_function', {
      name: 'create_recipes_table',
      body: `
        CREATE TABLE IF NOT EXISTS recipes (
          id SERIAL PRIMARY KEY,
          user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          category VARCHAR(50),
          difficulty VARCHAR(10) CHECK (difficulty IN ('easy', 'medium', 'hard')),
          cooking_time INTEGER, -- 分钟
          ingredients JSONB, -- 存储食材数组
          steps JSONB, -- 存储步骤数组
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);
        CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
      `
    });

    // 6. 创建订单表函数
    await supabase.rpc('create_or_replace_function', {
      name: 'create_orders_table',
      body: `
        CREATE TABLE IF NOT EXISTS meal_orders (
          id SERIAL PRIMARY KEY,
          user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
          recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
          scheduled_date DATE NOT NULL,
          servings INTEGER DEFAULT 1,
          notes TEXT,
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_meal_orders_user_id ON meal_orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_meal_orders_recipe_id ON meal_orders(recipe_id);
        CREATE INDEX IF NOT EXISTS idx_meal_orders_scheduled_date ON meal_orders(scheduled_date);
      `
    });

    console.log('表创建函数定义完成！');
  } catch (error) {
    console.error('定义表创建函数时发生错误:', error);
  }
}

// 插入默认数据
async function insertDefaultData() {
  try {
    console.log('插入默认数据...');
    
    // 插入默认分类
    const defaultCategories = [
      // 收入分类
      { name: '工资', type: 'income', icon: 'salary', color: '#4CAF50', is_default: true },
      { name: '奖金', type: 'income', icon: 'bonus', color: '#8BC34A', is_default: true },
      { name: '投资收益', type: 'income', icon: 'investment', color: '#CDDC39', is_default: true },
      { name: '其他收入', type: 'income', icon: 'other-income', color: '#FFEB3B', is_default: true },
      // 支出分类
      { name: '餐饮', type: 'outcome', icon: 'food', color: '#F44336', is_default: true },
      { name: '交通', type: 'outcome', icon: 'transport', color: '#E91E63', is_default: true },
      { name: '购物', type: 'outcome', icon: 'shopping', color: '#9C27B0', is_default: true },
      { name: '娱乐', type: 'outcome', icon: 'entertainment', color: '#673AB7', is_default: true },
      { name: '住房', type: 'outcome', icon: 'housing', color: '#3F51B5', is_default: true },
      { name: '医疗', type: 'outcome', icon: 'medical', color: '#2196F3', is_default: true },
      { name: '教育', type: 'outcome', icon: 'education', color: '#03A9F4', is_default: true },
      { name: '其他支出', type: 'outcome', icon: 'other-outcome', color: '#00BCD4', is_default: true }
    ];

    const { error: categoryError } = await supabase
      .from('categories')
      .insert(defaultCategories);

    if (categoryError) {
      console.log('默认分类可能已存在:', categoryError.message);
    } else {
      console.log('✅ 默认分类插入成功');
    }

    console.log('默认数据插入完成！');
  } catch (error) {
    console.error('插入默认数据时发生错误:', error);
  }
}

// 执行创建
async function main() {
  await defineTableCreationFunctions();
  await createAnyuTables();
  await insertDefaultData();
}

main();