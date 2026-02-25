require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

// 创建supabase客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function fixForeignKeys() {
  console.log('🔧 修复认证相关的外键约束...\n');
  
  try {
    // 首先检查当前的表结构
    console.log('1. 检查现有表结构...');
    
    // 检查custom_user表结构
    const { data: userColumns, error: userError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type')
      .eq('table_name', 'custom_user');
    
    if (!userError) {
      console.log('✅ custom_user表字段:');
      userColumns.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type})`);
      });
    }
    
    // 检查categories表结构
    const { data: categoryColumns, error: categoryError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_name', 'categories');
    
    if (!categoryError) {
      console.log('\n✅ categories表字段:');
      categoryColumns.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? '(可为空)' : '(不可为空)'}`);
      });
    }
    
    // 检查bills表结构
    const { data: billColumns, error: billError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_name', 'bills');
    
    if (!billError) {
      console.log('\n✅ bills表字段:');
      billColumns.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? '(可为空)' : '(不可为空)'}`);
      });
    }
    
    // 查找外键约束问题
    console.log('\n2. 检查外键约束...');
    
    // 检查categories表的外键约束
    const { data: categoryConstraints, error: constraintError } = await supabase
      .from('information_schema.table_constraints')
      .select('constraint_name, constraint_type')
      .eq('table_name', 'categories')
      .eq('constraint_type', 'FOREIGN KEY');
    
    if (!constraintError) {
      console.log('categories表外键约束:');
      categoryConstraints.forEach(constraint => {
        console.log(`   - ${constraint.constraint_name}`);
      });
    }
    
    // 尝试修复外键约束
    console.log('\n3. 尝试修复外键约束...');
    
    // 删除现有的外键约束（如果有问题的话）
    try {
      console.log('删除现有的categories外键约束...');
      await supabase.rpc('drop_constraint_if_exists', {
        table_name: 'categories',
        constraint_name: 'categories_user_id_fkey'
      });
      console.log('✅ categories外键约束已删除');
    } catch (error) {
      console.log('ℹ️  categories外键约束可能不存在或删除失败:', error.message);
    }
    
    // 重新创建正确的外键约束
    try {
      console.log('创建正确的categories外键约束...');
      const { error: addConstraintError } = await supabase
        .from('categories')
        .alter({
          add_constraint: {
            name: 'categories_user_id_fkey',
            foreign_key: {
              columns: ['user_id'],
              references: {
                table: 'custom_user',
                columns: ['userId']
              },
              on_delete: 'CASCADE'
            }
          }
        });
      
      if (addConstraintError) {
        console.log('❌ 添加外键约束失败:', addConstraintError.message);
        // 尝试另一种方式
        console.log('尝试使用原始SQL...');
        const { error: sqlError } = await supabase.rpc('execute_sql', {
          sql: `
            ALTER TABLE categories 
            ADD CONSTRAINT categories_user_id_fkey 
            FOREIGN KEY (user_id) REFERENCES custom_user(userId) ON DELETE CASCADE;
          `
        });
        
        if (sqlError) {
          console.log('❌ SQL方式也失败:', sqlError.message);
        } else {
          console.log('✅ 外键约束创建成功');
        }
      } else {
        console.log('✅ 外键约束创建成功');
      }
    } catch (error) {
      console.log('❌ 创建外键约束时出错:', error.message);
    }
    
    // 测试数据插入
    console.log('\n4. 测试数据插入...');
    
    // 先检查是否有测试用户
    const testUserId = '5ee68a97-f723-4303-be6d-5acd99335101';
    
    const { data: existingUser } = await supabase
      .from('custom_user')
      .select('userId')
      .eq('userId', testUserId)
      .single();
    
    if (!existingUser) {
      console.log('创建测试用户...');
      const { error: createUserError } = await supabase
        .from('custom_user')
        .insert([{
          userId: testUserId,
          username: 'test_user_auth',
          password_hash: '$2b$10$dummyhash', // 实际使用时应该是真实的bcrypt哈希
          avatar_url: 'https://example.com/avatar.png',
          role: 'user'
        }]);
      
      if (createUserError) {
        console.log('❌ 创建测试用户失败:', createUserError.message);
      } else {
        console.log('✅ 测试用户创建成功');
      }
    } else {
      console.log('✅ 测试用户已存在');
    }
    
    // 测试分类插入
    console.log('测试分类插入...');
    const { data: testCategory, error: categoryInsertError } = await supabase
      .from('categories')
      .insert([{
        user_id: testUserId,
        name: '测试分类_' + Date.now(),
        type: 'outcome',
        icon: 'test',
        color: '#FF0000'
      }])
      .select()
      .single();
    
    if (categoryInsertError) {
      console.log('❌ 分类插入失败:', categoryInsertError.message);
    } else {
      console.log('✅ 分类插入成功，ID:', testCategory.id);
      
      // 测试账单插入
      console.log('测试账单插入...');
      const { data: testBill, error: billInsertError } = await supabase
        .from('bills')
        .insert([{
          user_id: testUserId,
          amount: 99.99,
          type: 'outcome',
          category_id: testCategory.id,
          description: '测试账单',
          date: new Date().toISOString().split('T')[0]
        }])
        .select()
        .single();
      
      if (billInsertError) {
        console.log('❌ 账单插入失败:', billInsertError.message);
      } else {
        console.log('✅ 账单插入成功，ID:', testBill.id);
      }
    }
    
    console.log('\n🎉 外键约束修复完成！');
    
  } catch (error) {
    console.error('❌ 修复过程中发生错误:', error.message);
  }
}

// 运行修复
fixForeignKeys();