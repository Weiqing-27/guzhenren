const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3001';
let authToken = '';
let testUserId = null;

async function testAuth() {
  console.log('\n=== 测试用户认证功能 ===');
  
  // 注册测试用户
  try {
    const registerResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'anyutestuser',
        password: 'testpassword123'
      })
    });
    
    const registerResult = await registerResponse.json();
    console.log('注册结果:', registerResult);
    
    if (registerResult.userId) {
      testUserId = registerResult.userId;
    }
  } catch (error) {
    console.error('注册测试失败:', error.message);
  }
  
  // 登录测试
  try {
    const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'anyutestuser',
        password: 'testpassword123'
      })
    });
    
    const loginResult = await loginResponse.json();
    console.log('登录结果:', loginResult);
    
    if (loginResult.data && loginResult.data.userId) {
      testUserId = loginResult.data.userId;
      console.log('登录成功，用户ID:', testUserId);
    }
  } catch (error) {
    console.error('登录测试失败:', error.message);
  }
}

async function testBills() {
  console.log('\n=== 测试账单管理功能 ===');
  
  // 创建测试分类
  let categoryId = null;
  try {
    const categoryResponse = await fetch(`${BASE_URL}/api/anyu/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '测试分类',
        type: 'outcome',
        icon: 'test',
        color: '#FF0000'
      })
    });
    
    const categoryResult = await categoryResponse.json();
    console.log('创建分类结果:', categoryResult);
    categoryId = categoryResult.data?.id;
  } catch (error) {
    console.error('创建分类失败:', error.message);
  }
  
  // 创建账单
  if (categoryId) {
    try {
      const billResponse = await fetch(`${BASE_URL}/api/anyu/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 100.50,
          type: 'outcome',
          category_id: categoryId,
          description: '测试账单',
          date: '2024-01-15'
        })
      });
      
      const billResult = await billResponse.json();
      console.log('创建账单结果:', billResult);
    } catch (error) {
      console.error('创建账单失败:', error.message);
    }
  }
  
  // 获取账单列表
  try {
    const billsResponse = await fetch(`${BASE_URL}/api/anyu/bills`);
    const billsResult = await billsResponse.json();
    console.log('账单列表:', billsResult);
  } catch (error) {
    console.error('获取账单列表失败:', error.message);
  }
}

async function testCategories() {
  console.log('\n=== 测试分类管理功能 ===');
  
  // 获取分类列表
  try {
    const categoriesResponse = await fetch(`${BASE_URL}/api/anyu/categories?type=outcome`);
    const categoriesResult = await categoriesResponse.json();
    console.log('支出分类列表:', categoriesResult);
  } catch (error) {
    console.error('获取分类列表失败:', error.message);
  }
}

async function testStatistics() {
  console.log('\n=== 测试统计功能 ===');
  
  // 月度统计
  try {
    const monthlyResponse = await fetch(`${BASE_URL}/api/anyu/statistics/monthly?year=2024&month=1`);
    const monthlyResult = await monthlyResponse.json();
    console.log('月度统计:', monthlyResult);
  } catch (error) {
    console.error('获取月度统计失败:', error.message);
  }
  
  // 年度统计
  try {
    const yearlyResponse = await fetch(`${BASE_URL}/api/anyu/statistics/yearly?year=2024`);
    const yearlyResult = await yearlyResponse.json();
    console.log('年度统计:', yearlyResult);
  } catch (error) {
    console.error('获取年度统计失败:', error.message);
  }
}

async function testEmotional() {
  console.log('\n=== 测试情感交流功能 ===');
  
  // 创建情感事件
  try {
    const eventResponse = await fetch(`${BASE_URL}/api/anyu/emotional/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '今天的开心事',
        content: '测试情感事件内容',
        mood: 'happy',
        date: '2024-01-15'
      })
    });
    
    const eventResult = await eventResponse.json();
    console.log('创建情感事件结果:', eventResult);
  } catch (error) {
    console.error('创建情感事件失败:', error.message);
  }
  
  // 获取情感事件列表
  try {
    const eventsResponse = await fetch(`${BASE_URL}/api/anyu/emotional/events`);
    const eventsResult = await eventsResponse.json();
    console.log('情感事件列表:', eventsResult);
  } catch (error) {
    console.error('获取情感事件列表失败:', error.message);
  }
}

async function testMealPlans() {
  console.log('\n=== 测试餐饮计划功能 ===');
  
  // 创建食谱
  try {
    const recipeResponse = await fetch(`${BASE_URL}/api/anyu/meal-plans/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '测试食谱',
        description: '这是一个测试食谱',
        category: '主食',
        difficulty: 'easy',
        cooking_time: 30,
        ingredients: ['米饭', '鸡蛋'],
        steps: ['步骤1', '步骤2']
      })
    });
    
    const recipeResult = await recipeResponse.json();
    console.log('创建食谱结果:', recipeResult);
  } catch (error) {
    console.error('创建食谱失败:', error.message);
  }
  
  // 获取食谱列表
  try {
    const recipesResponse = await fetch(`${BASE_URL}/api/anyu/meal-plans/recipes`);
    const recipesResult = await recipesResponse.json();
    console.log('食谱列表:', recipesResult);
  } catch (error) {
    console.error('获取食谱列表失败:', error.message);
  }
}

async function runTests() {
  console.log('开始测试安隅APP功能...\n');
  
  await testAuth();
  await testBills();
  await testCategories();
  await testStatistics();
  await testEmotional();
  await testMealPlans();
  
  console.log('\n=== 测试完成 ===');
}

// 运行测试
runTests().catch(console.error);