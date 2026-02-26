require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

// 导入路由模块
const authRoutes = require("./routes/auth");
const leaderboardRoutes = require("./routes/leaderboard");
const snakeRoutes = require("./routes/snake");
const coupleRoutes = require('./routes/couple');
const coupleRelationshipRoutes = require('./routes/coupleRelationship');
const mediaRoutes = require('./routes/media');
const novelTrainingRoutes = require('./routes/novelTraining');
const blogRoutes = require('./routes/blog');
const imageRoutes = require('./routes/images');
const diariesRoutes = require('./routes/diaries');
const tasksRoutes = require('./routes/tasks'); // 新增任务路由
const anyuRoutes = require('./routes/anyu'); // 新增安隅APP路由

const app = express();
const PORT = process.env.PORT || 3001;

// 全局错误处理
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err);
  console.error('错误堆栈:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
  console.error('Promise:', promise);
});

// 验证环境变量
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error("错误: 缺少Supabase环境变量");
  process.exit(1);
}

// 创建带配置的supabase客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    db: {
      retryAttempts: 3,
      retryInterval: 2000,
    },
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        'User-Agent': 'guzhenren-blog-app/1.0'
      }
    }
  }
);

// 将supabase客户端添加到应用中，供路由使用
app.set('supabase', supabase);

// 添加Supabase连接测试
const testSupabaseConnection = async () => {
  try {
    const { error } = await supabase
      .from("custom_user")
      .select("*")
      .limit(1);
      
    if (error) {
      console.error("Supabase连接错误:", error.message);
      return false;
    } else {
      console.log("成功连接到Supabase数据库");
      return true;
    }
  } catch (err) {
    console.error("Supabase连接异常:", err.message);
    return false;
  }
};

// 中间件
app.use(express.json({ limit: '10mb' })); // 增加body大小限制，便于处理base64图片
app.use(express.urlencoded({ extended: true }));

// 显式处理所有OPTIONS请求，确保预检请求能正确响应
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.use(
  cors({
    origin: [
      "https://www.weiqing0229.top",
      "https://xxproject.weiqing23.cn",
      "https://xxproject-admin.vercel.app",
      /\.vercel\.app$/,
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3001",
      "https://jianli.weiqing23.cn"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"], // 添加PATCH方法
    allowedHeaders: ["Content-Type", "Authorization", "x-requested-with"],
    credentials: true,
    optionsSuccessStatus: 200 // 重要：确保OPTIONS请求返回200状态码
  })
);

// 挂载路由
app.use("/api/auth", authRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/snake", snakeRoutes);
app.use('/api/couple', coupleRoutes);
app.use('/api/couple-relationship', coupleRelationshipRoutes);
app.use('/api', mediaRoutes);
app.use('/api/novel-training', novelTrainingRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api', imageRoutes); // 添加图片路由
app.use('/api', diariesRoutes); // 添加富文本日记路由
app.use('/api/tasks', tasksRoutes); // 添加任务路由
app.use('/api/anyu', anyuRoutes); // 添加安隅APP路由

// 添加健康检查端点
app.get("/health", async (req, res) => {
  const isConnected = await testSupabaseConnection();
  res.status(200).json({
    status: "ok",
    database: isConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// 处理根路由
app.get("/", (req, res) => {
  res.json({
    message: '后端已运行',
  });
});

// 处理favicon（避免404）
app.get("/favicon.ico", (req, res) => res.status(204).end());

// 保存分数（保留原始接口以确保向后兼容）
app.post("/api/scores", async (req, res) => {
  const { name, score } = req.body;
  const supabase = req.app.get('supabase');

  if (!name || !score) {
    return res.status(400).json({ error: "姓名和分数不能为空" });
  }

  try {
    const { data, error } = await supabase
      .from("scores")
      .insert([
        {
          name,
          score,
          date: new Date().toISOString(),
        },
      ])
      .select();

    if (error) throw error;

    // 获取更新后的排行榜
    const { data: leaderboard } = await supabase
      .from("scores")
      .select("name, score")
      .order("score", { ascending: false })
      .limit(10);

    res.status(201).json({
      message: "分数保存成功",
      leaderboard: leaderboard || [],
    });
  } catch (error) {
    console.error("保存分数错误:", error);
    res.status(500).json({ error: "保存分数失败" });
  }
});

// 获取排行榜（保留原始接口以确保向后兼容）
app.get("/api/leaderboard", async (req, res) => {
  const supabase = req.app.get('supabase');
  
  try {
    const { data, error } = await supabase
      .from("scores")
      .select("name, score")
      .order("score", { ascending: false })
      .limit(10);

    if (error) throw error;

    res.status(200).json(data || []);
  } catch (error) {
    console.error("获取排行榜错误:", error);
    res.status(500).json({ error: "获取排行榜失败" });
  }
});

// 处理未定义路由
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err.stack);
  res.status(500).json({ error: "服务器内部错误" });
});

// 启动服务器
const startServer = async () => {
  try {
    const isConnected = await testSupabaseConnection();
    if (!isConnected) {
      console.error("无法连接到数据库，服务器启动失败");
      process.exit(1);
    }
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`服务器运行在端口 ${PORT}`);
    });
  } catch (error) {
    console.error("启动服务器时发生错误:", error);
    process.exit(1);
  }
};

// 如果直接运行此脚本，则启动服务器
if (require.main === module) {
  startServer();
}

module.exports = app;