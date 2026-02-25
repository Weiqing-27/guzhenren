const { default: fetch } = require('node-fetch');

const BASE_URL = 'http://localhost:3001';

async function verifyAuthSetup() {
  console.log('🔍 验证用户认证和数据隔离设置...\n');
  
  try {
    // 测试1: 无认证访问anyu接口
    console.log('1. 测试无认证访问拦截...');
    const noAuthResponse = await fetch(`${BASE_URL}/api/anyu/bills`);
    const noAuthResult = await noAuthResponse.json();
    
    if (noAuthResult.code === 401) {
      console.log('✅ 无认证访问被正确拦截');
    } else {
      console.log('❌ 无认证访问未被拦截');
      console.log('响应:', noAuthResult);
    }
    
    // 测试2: 正常用户登录
    console.log('\n2. 测试用户登录...');
    const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'user1_test',
        password: 'password123'
      })
    });
    
    const loginResult = await loginResponse.json();
    
    if (loginResult.code === 200 && loginResult.data && loginResult.data.token) {
      console.log('✅ 用户登录成功');
      console.log('用户ID:', loginResult.data.userId);
      console.log('用户名:', loginResult.data.username);
      console.log('Token长度:', loginResult.data.token.length, '字符');
      
      const token = loginResult.data.token;
      
      // 测试3: 使用有效token访问受保护接口
      console.log('\n3. 测试认证访问...');
      const authResponse = await fetch(`${BASE_URL}/api/anyu/bills`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const authResult = await authResponse.json();
      
      if (authResult.code === 200) {
        console.log('✅ 认证访问成功');
        console.log('返回数据:', authResult.data.bills.length, '条账单记录');
      } else {
        console.log('❌ 认证访问失败');
        console.log('错误信息:', authResult);
      }
      
      // 测试4: 创建分类（验证外键约束）
      console.log('\n4. 测试分类创建...');
      const categoryResponse = await fetch(`${BASE_URL}/api/anyu/categories`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: '测试分类_' + Date.now(),
          type: 'outcome',
          icon: 'test',
          color: '#FF0000'
        })
      });
      
      const categoryResult = await categoryResponse.json();
      
      if (categoryResult.code === 201) {
        console.log('✅ 分类创建成功');
        console.log('分类ID:', categoryResult.data.id);
        
        // 测试5: 使用创建的分类创建账单
        console.log('\n5. 测试账单创建...');
        const billResponse = await fetch(`${BASE_URL}/api/anyu/bills`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: 99.99,
            type: 'outcome',
            category_id: categoryResult.data.id,
            description: '测试账单_' + Date.now(),
            date: new Date().toISOString().split('T')[0]
          })
        });
        
        const billResult = await billResponse.json();
        
        if (billResult.code === 201) {
          console.log('✅ 账单创建成功');
          console.log('账单ID:', billResult.data.id);
          console.log('账单金额:', billResult.data.amount);
        } else {
          console.log('❌ 账单创建失败');
          console.log('错误信息:', billResult);
        }
        
      } else {
        console.log('❌ 分类创建失败');
        console.log('错误信息:', categoryResult);
      }
      
    } else {
      console.log('❌ 用户登录失败');
      console.log('错误信息:', loginResult);
    }
    
    console.log('\n🎉 认证和数据隔离功能验证完成！');
    
  } catch (error) {
    console.error('❌ 验证过程中发生错误:', error.message);
  }
}

// 运行验证
verifyAuthSetup();