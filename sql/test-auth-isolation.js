/**
 * 【功能描述】
 * 多用户认证与数据隔离集成测试，验证 JWT 鉴权与用户间数据不可见。
 *
 * 【业务逻辑】
 * 1. 注册/登录 user1_test 与 user2_test
 * 2. user1 创建分类与账单，user2 不应看到 user1 数据
 * 3. 无 Token 访问应返回 401
 *
 * 【技术实现】
 * - 涉及方法：node-fetch、Authorization Bearer Header
 * - 涉及知识点：多租户数据隔离、JWT 认证
 *
 * 用法：node sql/test-auth-isolation.js
 */

const { default: fetch } = require('node-fetch');

const BASE_URL = 'http://localhost:3001';
let user1Token = '';
let user2Token = '';
let user1Id = null;
let user2Id = null;

/**
 * 【功能描述】
 * 注册或登录两个测试用户并保存 token。
 *
 * 【业务逻辑】
 * 1. 注册 user1_test
 * 2. user2 先尝试登录，失败则注册
 *
 * 【技术实现】
 * - 涉及方法：fetch POST /api/auth/register、/api/auth/login
 * - 涉及知识点：幂等注册（用户已存在时登录）
 */
async function testUserRegistration() {
  console.log('\n=== 测试用户注册功能 ===');
  
  // 注册第一个用户
  try {
    const registerResponse1 = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'user1_test',
        password: 'password123'
      })
    });
    
    const registerResult1 = await registerResponse1.json();
    console.log('用户1注册结果:', registerResult1);
    
    if (registerResult1.code === 201 && registerResult1.data) {
      user1Id = registerResult1.data.userId;
      user1Token = registerResult1.data.token;
      console.log('✅ 用户1注册成功');
    }
  } catch (error) {
    console.error('❌ 用户1注册失败:', error.message);
  }
  
  // 注册第二个用户
  try {
    // 先尝试登录，如果失败再注册
    const loginResponse2 = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'user2_test',
        password: 'password123'
      })
    });
    
    const loginResult2 = await loginResponse2.json();
    
    if (loginResult2.code === 200 && loginResult2.data) {
      user2Id = loginResult2.data.userId;
      user2Token = loginResult2.data.token;
      console.log('✅ 用户2登录成功');
    } else {
      // 用户不存在，进行注册
      const registerResponse2 = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'user2_test',
          password: 'password123'
        })
      });
      
      const registerResult2 = await registerResponse2.json();
      console.log('用户2注册结果:', registerResult2);
      
      if (registerResult2.code === 201 && registerResult2.data) {
        user2Id = registerResult2.data.userId;
        user2Token = registerResult2.data.token;
        console.log('✅ 用户2注册成功');
      }
    }
  } catch (error) {
    console.error('❌ 用户2注册/登录失败:', error.message);
  }
}

/**
 * 【功能描述】
 * 测试 user1_test 登录并刷新 token。
 *
 * 【业务逻辑】
 * 1. POST /api/auth/login 获取 user1Token
 *
 * 【技术实现】
 * - 涉及方法：fetch POST
 * - 涉及知识点：JWT token 获取
 */
async function testUserLogin() {
  console.log('\n=== 测试用户登录功能 ===');
  
  try {
    const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'user1_test',
        password: 'password123'
      })
    });
    
    const loginResult = await loginResponse.json();
    console.log('登录结果:', loginResult);
    
    if (loginResult.code === 200 && loginResult.data) {
      user1Token = loginResult.data.token;
      console.log('✅ 登录成功，获得token');
    }
  } catch (error) {
    console.error('❌ 登录测试失败:', error.message);
  }
}

/**
 * 【功能描述】
 * 验证 user1 与 user2 之间的账单数据隔离及无认证拦截。
 *
 * 【业务逻辑】
 * 1. user1 带 token 创建分类与账单
 * 2. user2 获取账单列表，不应含 user1 数据
 * 3. 无 Authorization 访问应返回 401
 *
 * 【技术实现】
 * - 涉及方法：fetch 带 Bearer token
 * - 涉及知识点：行级数据隔离、401 未授权
 */
async function testDataIsolation() {
  console.log('\n=== 测试数据隔离功能 ===');
  
  // 确保两个用户都有token
  if (!user1Token) {
    console.log('❌ 用户1 token缺失');
    return;
  }
  
  if (!user2Token) {
    console.log('❌ 用户2 token缺失，尝试重新获取');
    try {
      const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'user2_test',
          password: 'password123'
        })
      });
      
      const loginResult = await loginResponse.json();
      if (loginResult.code === 200 && loginResult.data) {
        user2Token = loginResult.data.token;
        console.log('✅ 用户2重新登录成功');
      }
    } catch (error) {
      console.error('❌ 用户2重新登录失败:', error.message);
      return;
    }
  }
  
  // 用户1创建分类
  let categoryId = null;
  try {
    const categoryResponse = await fetch(`${BASE_URL}/api/anyu/categories`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user1Token}`
      },
      body: JSON.stringify({
        name: '用户1的分类',
        type: 'outcome',
        icon: 'test',
        color: '#FF0000'
      })
    });
    
    const categoryResult = await categoryResponse.json();
    console.log('用户1创建分类结果:', categoryResult);
    categoryId = categoryResult.data?.id;
  } catch (error) {
    console.error('❌ 用户1创建分类失败:', error.message);
  }
  
  // 用户1创建账单
  if (categoryId) {
    try {
      const billResponse = await fetch(`${BASE_URL}/api/anyu/bills`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user1Token}`
        },
        body: JSON.stringify({
          amount: 100.50,
          type: 'outcome',
          category_id: categoryId,
          description: '用户1的测试账单',
          date: '2024-01-15'
        })
      });
      
      const billResult = await billResponse.json();
      console.log('用户1创建账单结果:', billResult);
    } catch (error) {
      console.error('❌ 用户1创建账单失败:', error.message);
    }
  }
  
  // 用户2尝试访问用户1的数据
  try {
    const billsResponse = await fetch(`${BASE_URL}/api/anyu/bills`, {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user2Token}`
      }
    });
    
    const billsResult = await billsResponse.json();
    console.log('用户2获取账单列表结果:', billsResult);
    
    // 验证用户2看不到用户1的数据
    if (billsResult.code === 200 && billsResult.data && billsResult.data.bills) {
      const user2Bills = billsResult.data.bills;
      const hasUser1Data = user2Bills.some(bill => 
        bill.description && bill.description.includes('用户1')
      );
      
      if (!hasUser1Data && user2Bills.length === 0) {
        console.log('✅ 数据隔离正常：用户2无法看到用户1的数据');
      } else if (hasUser1Data) {
        console.log('❌ 数据隔离异常：用户2看到了用户1的数据');
      } else {
        console.log('✅ 数据隔离正常：用户2看到的是自己的空数据');
      }
    }
  } catch (error) {
    console.error('❌ 用户2获取账单列表失败:', error.message);
  }
  
  // 无认证访问测试
  try {
    const unauthorizedResponse = await fetch(`${BASE_URL}/api/anyu/bills`);
    const unauthorizedResult = await unauthorizedResponse.json();
    console.log('无认证访问结果:', unauthorizedResult);
    
    if (unauthorizedResult.code === 401) {
      console.log('✅ 无认证访问被正确拦截');
    } else {
      console.log('❌ 无认证访问未被拦截');
    }
  } catch (error) {
    console.error('❌ 无认证访问测试失败:', error.message);
  }
}

/**
 * 【功能描述】
 * 认证与数据隔离测试套件入口。
 *
 * 【业务逻辑】
 * 1. testUserRegistration → testUserLogin → testDataIsolation
 *
 * 【技术实现】
 * - 涉及方法：async/await 顺序编排
 * - 涉及知识点：集成测试套件
 */
async function runTests() {
  console.log('🚀 开始测试用户认证和数据隔离功能...\n');
  
  await testUserRegistration();
  await testUserLogin();
  await testDataIsolation();
  
  console.log('\n🏁 测试完成！');
}

// 运行测试
runTests().catch(error => {
  console.error('测试过程中发生错误:', error);
});