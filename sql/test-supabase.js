require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent; // 修正引入方式
const fetch = require('node-fetch'); // 确保引入 node-fetch

// 设置代理（如果需要）
const proxyUrl = 'http://127.0.0.1:1080'; // 替换为你的代理地址
const agent = new HttpsProxyAgent(proxyUrl);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    global: {
      fetch, // 使用 node-fetch
      agent // 使用代理
    }
  }
);

async function testConnection() {
  console.log('测试 Supabase 连接...');
  
  // 测试认证
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'test@example.com',
      password: 'testpassword'
    });
    
    if (error) {
      console.error('认证测试失败:', error.message);
    } else {
      console.log('认证测试成功:', data.user.email);
    }
  } catch (err) {
    console.error('认证测试异常:', err);
  }
  
  // 测试数据库查询
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('查询测试失败:', error.message);
    } else {
      console.log('查询测试成功:', data.length ? '有数据' : '无数据');
    }
  } catch (err) {
    console.error('查询测试异常:', err);
  }
}

testConnection();