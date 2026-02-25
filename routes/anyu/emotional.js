const express = require("express");
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

// 应用认证中间件到所有路由
router.use(authenticate);

// 获取情感事件列表 - 只返回当前用户的数据
router.get("/events", async (req, res) => {
  const supabase = req.app.get('supabase');
  const {
    page = 1,
    page_size = 10,
    mood,
    date_from,
    date_to
  } = req.query;

  try {
    let query = supabase
      .from("emotional_events")
      .select(`
        id,
        title,
        content,
        mood,
        date,
        created_at
      `, { count: 'exact' })
      .eq('user_id', req.user.userId) // 只查询当前用户的数据
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    // 应用过滤条件
    if (mood) {
      query = query.eq('mood', mood);
    }
    
    if (date_from) {
      query = query.gte('date', date_from);
    }
    
    if (date_to) {
      query = query.lte('date', date_to);
    }

    // 分页处理
    const startIndex = (parseInt(page) - 1) * parseInt(page_size);
    query = query.range(startIndex, startIndex + parseInt(page_size) - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("获取情感事件列表错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取情感事件列表失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取情感事件列表成功",
      data: {
        events: data || [],
        pagination: {
          current_page: parseInt(page),
          page_size: parseInt(page_size),
          total: count || 0,
          total_pages: Math.ceil((count || 0) / parseInt(page_size))
        }
      }
    });
  } catch (error) {
    console.error("获取情感事件列表异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 创建情感事件 - 关联当前用户
router.post("/events", async (req, res) => {
  const { title, content, mood, date } = req.body;
  const supabase = req.app.get('supabase');

  // 验证必填字段
  if (!title || !content || !mood || !date) {
    return res.status(400).json({
      code: 400,
      message: "标题、内容、情绪和日期都是必填项"
    });
  }

  // 验证情绪类型
  const validMoods = ['happy', 'sad', 'angry', 'anxious', 'excited', 'calm', 'tired', 'other'];
  if (!validMoods.includes(mood)) {
    return res.status(400).json({
      code: 400,
      message: "情绪类型无效"
    });
  }

  try {
    // 创建情感事件
    const { data, error } = await supabase
      .from("emotional_events")
      .insert([{
        title,
        content,
        mood,
        date,
        user_id: req.user.userId // 关联当前用户
      }])
      .select()
      .single();

    if (error) {
      console.error("创建情感事件错误:", error);
      return res.status(500).json({
        code: 500,
        message: "创建情感事件失败",
        error: error.message
      });
    }

    res.status(201).json({
      code: 201,
      message: "情感事件创建成功",
      data: data
    });
  } catch (error) {
    console.error("创建情感事件异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 添加观点反思 - 关联当前用户的情感事件
router.post("/perspectives", async (req, res) => {
  const { event_id, perspective, reflection } = req.body;
  const supabase = req.app.get('supabase');

  // 验证必填字段
  if (!event_id || !perspective) {
    return res.status(400).json({
      code: 400,
      message: "事件ID和观点都是必填项"
    });
  }

  try {
    // 首先验证情感事件是否存在且属于当前用户
    const { data: event, error: eventError } = await supabase
      .from("emotional_events")
      .select("id, user_id")
      .eq("id", event_id)
      .eq("user_id", req.user.userId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({
        code: 404,
        message: "情感事件不存在或无权限访问"
      });
    }

    // 创建观点反思
    const { data, error } = await supabase
      .from("emotional_perspectives")
      .insert([{
        event_id,
        perspective,
        reflection: reflection || '',
        user_id: req.user.userId // 关联当前用户
      }])
      .select(`
        id,
        perspective,
        reflection,
        created_at,
        event:emotional_events(id, title, date)
      `)
      .single();

    if (error) {
      console.error("创建观点反思错误:", error);
      return res.status(500).json({
        code: 500,
        message: "创建观点反思失败",
        error: error.message
      });
    }

    res.status(201).json({
      code: 201,
      message: "观点反思创建成功",
      data: data
    });
  } catch (error) {
    console.error("创建观点反思异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 获取事件的观点列表 - 只返回当前用户的数据
router.get("/events/:id/perspectives", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 首先验证情感事件是否存在且属于当前用户
    const { data: event, error: eventError } = await supabase
      .from("emotional_events")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({
        code: 404,
        message: "情感事件不存在或无权限访问"
      });
    }

    // 查询观点反思
    const { data, error } = await supabase
      .from("emotional_perspectives")
      .select(`
        id,
        perspective,
        reflection,
        created_at
      `)
      .eq("event_id", id)
      .eq("user_id", req.user.userId) // 只查询当前用户的数据
      .order("created_at", { ascending: false });

    if (error) {
      console.error("获取观点列表错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取观点列表失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取观点列表成功",
      data: data || []
    });
  } catch (error) {
    console.error("获取观点列表异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

module.exports = router;