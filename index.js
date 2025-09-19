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

app.use(
  cors({
    origin: [
      "https://www.weiqing0229.top",
      "https://xxproject.weiqing23.cn",
      "https://xxproject-admin.vercel.app",
      /\.vercel\.app$/,
      "http://localhost:5173",
      "http://localhost:3001",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-requested-with"],
    credentials: true,
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
  res.status(500).json({ 
    error: "服务器内部错误",
    message: err.message 
  });
});

// 在启动服务器前测试数据库连接
testSupabaseConnection().then(isConnected => {
  if (isConnected) {
    const server = app.listen(PORT, () => {
      console.log(`后端运行在 http://localhost:${PORT}`);
    });
    
    // 处理服务器错误
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${PORT} 已被占用，请关闭占用该端口的进程或更改端口号`);
        // 尝试使用其他端口
        const alternativePort = parseInt(PORT) + 1;
        console.log(`尝试使用备用端口: ${alternativePort}`);
        app.listen(alternativePort, () => {
          console.log(`后端运行在 http://localhost:${alternativePort}`);
        }).on('error', (err) => {
          console.error('备用端口也已被占用:', err);
          process.exit(1);
        });
      } else {
        console.error('服务器错误:', err);
        process.exit(1);
      }
    });
  } else {
    console.error("无法连接到数据库，服务器启动失败");
    process.exit(1);
  }
});

module.exports = app; // 用于部署到Vercel