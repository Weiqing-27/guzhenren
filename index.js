// Vercel 已注入环境变量；本地开发才读 .env
if (!process.env.VERCEL) {
  require('dotenv').config({ quiet: true });
}

const express = require("express");

// 先校验环境变量，再加载路由（避免缺变量或路由加载失败时 FUNCTION_INVOCATION_FAILED）
const missingEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error('[启动失败] 缺少环境变量:', missingEnv.join(', '));
  if (process.env.VERCEL) {
    module.exports = express().all('*', (req, res) => {
      res.status(503).json({
        code: 503,
        message: `后端环境变量未配置: ${missingEnv.join(', ')}`,
        hint: '请在 Vercel → Settings → Environment Variables 添加并 Redeploy',
      });
    });
  } else {
    process.exit(1);
  }
  return;
}

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
const questionsRoutes = require('./routes/questions'); // 新增前端面试题路由
const jizhangRoutes = require('./routes/jizhang'); // 记账本 APP
const resumesRoutes = require('./routes/resumes'); // 简历模块
const ruankaoRoutes = require('./routes/ruankao'); // 软考高项复习模块
const catVlogRoutes = require('./routes/catVlog'); // 糖宝墨宝猫咪Vlog模块
const foodMenuRoutes = require('./routes/foodMenu'); // 情侣点餐菜单&订单模块

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

// 服务端管理客户端（绕过 RLS，供软考等服务端模块读写）
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// 将supabase客户端添加到应用中，供路由使用
app.set('supabase', supabase);
app.set('supabaseAdmin', supabaseAdmin);

/**
 * 【功能描述】
 * 探测 Supabase 是否可连通（对 custom_user 表做 limit 1 查询）。
 *
 * 【业务逻辑】
 * 1. 执行轻量 select；有 error → 记日志并返回 false；
 * 2. 无 error → 记成功日志并返回 true；
 * 3. 抛异常同样返回 false，供健康检查与启动门禁使用。
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().limit()、console.error/log
 * - 涉及知识点：启动前依赖探测、健康检查、async/await、布尔型连通性结果
 */
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

const corsAllowList = [
    "https://www.weiqing0229.top",
    "https://xxproject.weiqing23.cn",
    "https://xxproject-admin.vercel.app",
    /\.vercel\.app$/,
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:3001",
    "http://localhost:8080",
    "https://jianli.weiqing23.cn"
  ]

function isAllowedCorsOrigin(origin) {
  if (!origin) return true
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true
  return corsAllowList.some((item) => (item instanceof RegExp ? item.test(origin) : item === origin))
}

const corsOptions = {
  origin: (origin, callback) => {
    callback(null, isAllowedCorsOrigin(origin))
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-requested-with"],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 中间件
app.use(express.json({ limit: '50mb' })); // 提高限制，支持猫咪Vlog短视频 base64 上传
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
app.use('/api', questionsRoutes); // 添加前端面试题路由
app.use('/api/jizhang', jizhangRoutes); // 记账本模块
app.use('/api/resumes', resumesRoutes); // 简历模块
app.use('/api/ruankao', ruankaoRoutes); // 软考高项复习模块
app.use('/api/cat-vlog', catVlogRoutes); // 糖宝墨宝猫咪Vlog模块
app.use('/api', foodMenuRoutes); // 情侣点餐：/api/food/*、/api/order/*

/**
 * 【功能描述】
 * 健康检查：返回服务状态与数据库连通结果。
 *
 * 【业务逻辑】
 * 1. 调用 testSupabaseConnection；
 * 2. 固定 HTTP 200，body 含 status、database(connected|disconnected)、timestamp。
 *
 * 【技术实现】
 * - 涉及方法：testSupabaseConnection()、Date.toISOString()
 * - 涉及知识点：运维探针、liveness/readiness 简化实现
 */
app.get("/health", async (req, res) => {
  const isConnected = await testSupabaseConnection();
  res.status(200).json({
    status: "ok",
    database: isConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

/**
 * 【功能描述】
 * 根路径探活，确认进程已启动。
 *
 * 【业务逻辑】
 * 直接返回 { message: '后端已运行' }。
 *
 * 【技术实现】
 * - 涉及方法：res.json()
 * - 涉及知识点：Express 根路由、部署后浏览器快速验证
 */
app.get("/", (req, res) => {
  res.json({
    message: '后端已运行',
  });
});

// 处理favicon（避免404）
app.get("/favicon.ico", (req, res) => res.status(204).end());

/**
 * 【功能描述】
 * 遗留接口：保存游戏分数并返回最新 Top10 排行榜（向后兼容）。
 *
 * 【业务逻辑】
 * 1. 校验 name、score 非空；
 * 2. 向 scores 表插入一条含 date 的记录；
 * 3. 再查 score 降序 Top10；
 * 4. 201 返回 message + leaderboard。
 *
 * 【技术实现】
 * - 涉及方法：req.app.get('supabase')、from().insert().select()、order().limit()
 * - 涉及知识点：向后兼容 API、应用级依赖注入（app.set/get）、排行榜查询
 */
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

/**
 * 【功能描述】
 * 遗留接口：获取 scores 表 Top10 排行榜（向后兼容；另有 /api/leaderboard 路由模块）。
 *
 * 【业务逻辑】
 * 1. 按 score 降序取 10 条 name+score；
 * 2. 成功 200 返回数组；失败 500。
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().order().limit()
 * - 涉及知识点：排行榜查询、与独立 leaderboard 路由并存的历史兼容层
 */
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

/**
 * 【功能描述】
 * Express 全局错误处理中间件：捕获未处理错误并统一返回 500。
 *
 * 【业务逻辑】
 * 1. 打印 err.stack；
 * 2. 响应 { error: "服务器内部错误" }（不向前端泄露堆栈）。
 *
 * 【技术实现】
 * - 涉及方法：console.error、四参数错误中间件 (err, req, res, next)
 * - 涉及知识点：Express 错误中间件签名、生产环境错误脱敏
 */
app.use((err, req, res, next) => {
  console.error('服务器错误:', err.stack);
  res.status(500).json({ error: "服务器内部错误" });
});

/**
 * 【功能描述】
 * 启动 HTTP 服务：先确认数据库连通，再 listen。
 *
 * 【业务逻辑】
 * 1. testSupabaseConnection 失败 → 打日志并 process.exit(1)；
 * 2. 成功则在 0.0.0.0:PORT 监听并打印端口。
 *
 * 【技术实现】
 * - 涉及方法：app.listen()、process.exit()
 * - 涉及知识点：启动门禁、绑定全网卡便于容器/云主机访问、require.main === module 区分被导入与直接运行
 */
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
