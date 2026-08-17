/**
 * 【功能描述】
 * 检查认证相关数据表是否存在，并验证 custom_user 与业务表的外键关系。
 *
 * 【业务逻辑】
 * 1. 依次探测 custom_user、categories、bills 表是否可查询
 * 2. 使用固定测试 userId 验证用户是否存在，不存在则创建
 * 3. 输出后续修复建议（如需运行 create-anyu-app-tables.js）
 *
 * 【技术实现】
 * - 涉及方法：@supabase/supabase-js、supabase.from().select().limit()
 * - 涉及知识点：表存在性探测、测试用户种子数据
 *
 * 用法：node sql/init-auth-tables.js
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

// 创建supabase客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 【功能描述】
 * 探测认证与业务表状态，必要时创建测试用户以验证外键链路。
 *
 * 【业务逻辑】
 * 1. 查询 custom_user / categories / bills 各取 1 条记录
 * 2. 检查测试 userId 是否存在，不存在则 insert
 * 3. 打印初始化检查结论与修复指引
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().limit()、insert().single()
 * - 涉及知识点：Anon Key 权限、外键前置条件
 */
async function initAuthTables() {
  console.log('🔧 初始化认证相关数据表...\n');
  
  try {
    // 检查用户表是否存在
    console.log('1. 检查用户表...');
    const { data: userData, error: userError } = await supabase
      .from('custom_user')
      .select('*')
      .limit(1);
    
    if (userError) {
      console.log('❌ 用户表查询失败:', userError.message);
      // 可能需要创建用户表
      console.log('💡 可能需要先运行 create-anyu-app-tables.js 脚本');
    } else {
      console.log('✅ 用户表存在，记录数:', userData ? userData.length : 0);
    }
    
    // 检查分类表
    console.log('\n2. 检查分类表...');
    const { data: categoryData, error: categoryError } = await supabase
      .from('categories')
      .select('*')
      .limit(1);
    
    if (categoryError) {
      console.log('❌ 分类表查询失败:', categoryError.message);
    } else {
      console.log('✅ 分类表存在，记录数:', categoryData ? categoryData.length : 0);
    }
    
    // 检查账单表
    console.log('\n3. 检查账单表...');
    const { data: billData, error: billError } = await supabase
      .from('bills')
      .select('*')
      .limit(1);
    
    if (billError) {
      console.log('❌ 账单表查询失败:', billError.message);
    } else {
      console.log('✅ 账单表存在，记录数:', billData ? billData.length : 0);
    }
    
    // 检查外键约束
    console.log('\n4. 验证外键关系...');
    
    // 尝试插入一条测试数据来验证外键
    const testUserId = '5ee68a97-f723-4303-be6d-5acd99335101'; // 已知存在的用户ID
    
    console.log('测试用户ID:', testUserId);
    
    // 验证用户是否存在
    const { data: existingUser, error: checkUserError } = await supabase
      .from('custom_user')
      .select('userId')
      .eq('userId', testUserId)
      .single();
    
    if (checkUserError || !existingUser) {
      console.log('❌ 测试用户不存在，创建测试用户...');
      
      // 创建测试用户
      const { data: newUser, error: createUserError } = await supabase
        .from('custom_user')
        .insert([{
          userId: testUserId,
          username: 'test_user_for_auth',
          password_hash: '$2b$10$example_hash_here', // 示例哈希
          avatar_url: 'https://example.com/avatar.png',
          role: 'user'
        }])
        .select()
        .single();
      
      if (createUserError) {
        console.log('❌ 创建测试用户失败:', createUserError.message);
      } else {
        console.log('✅ 测试用户创建成功');
      }
    } else {
      console.log('✅ 测试用户存在');
    }
    
    console.log('\n📋 数据库初始化检查完成！');
    console.log('\n💡 如果仍有外键约束错误，请确保：');
    console.log('   1. 运行了 create-anyu-app-tables.js 脚本');
    console.log('   2. 数据库表结构正确');
    console.log('   3. 外键关系已正确建立');
    
  } catch (error) {
    console.error('❌ 初始化过程中发生错误:', error.message);
  }
}

// 运行初始化
initAuthTables();
