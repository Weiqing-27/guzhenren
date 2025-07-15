require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3001;

// 验证环境变量
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('错误: 缺少Supabase环境变量');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 添加Supabase连接测试
supabase
  .from('custom_user')
  .select('*')
  .limit(1)
  .then(({ error }) => {
    if (error) {
      console.error('Supabase连接错误:', error.message);
    } else {
      console.log('成功连接到Supabase数据库');
    }
  });

app.use(cors({
  origin: ['https://www.weiqing0229.top','https://xxproject-admin.vercel.app',/\.vercel\.app$/], 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
  credentials: true
}));

app.use(express.json());

// 用户注册 - 已修复
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  // 验证输入数据
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  try {
    // 检查用户名是否存在 - 更健壮的查询
    const { data: existingUser, error: selectError } = await supabase
      .from('custom_user')
      .select('username')
      .eq('username', username);

    if (selectError) {
      console.error('Supabase查询错误:', selectError);
      return res.status(500).json({ error: '数据库查询错误' });
    }

    if (existingUser && existingUser.length > 0) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    // 密码加密 - 添加更安全的检查
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: '密码必须是至少6个字符的字符串' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 创建用户 - 添加错误处理
    const { data: newUser, error: insertError } = await supabase
      .from('custom_user')
      .insert([{
        username,
        password_hash: passwordHash
      }])
      .select();

    if (insertError) {
      console.error('用户创建错误:', insertError);
      return res.status(500).json({ error: '用户创建失败' });
    }

    res.status(201).json({
      id: newUser[0].id,
      username: newUser[0].username
    });
  } catch (error) {
    console.error('注册错误:', error.message);
    res.status(500).json({ error: '服务器错误', details: error.message });
  }
});

// 用户登录 - 已优化
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  // 验证输入
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  try {
    // 查询用户
    const { data: users, error } = await supabase
      .from('custom_user')
      .select('*')
      .eq('username', username);

    if (error) {
      console.error('登录查询错误:', error);
      return res.status(500).json({ error: '数据库查询错误' });
    }

    if (!users || users.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const user = users[0];

    // 验证密码
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    res.status(200).json({
      code: 20000,
      message: '登录成功',
      data: {
        id: user.id,
        username: user.username
      }
    });
  } catch (error) {
    console.error('登录错误:', error.message);
    res.status(500).json({ error: '服务器错误', details: error.message });
  }
});

// 添加健康检查端点
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    database: supabase ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});
// 处理根路由
app.get('/', (req, res) => {
  res.json({
    message: 'API is running',
    routes: ['/login', '/register', '/health']
  });
});

// 处理favicon（避免404）
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 处理未定义路由
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});
// app.listen(PORT, () => {
//   console.log(`后端运行在 http://localhost:${PORT}`);
// });
module.exports = app; // 用于部署到Vercel