const express = require("express");
const router = express.Router();

// 获取情感事件列表
router.get("/events", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { page = 1, page_size = 10 } = req.query;

  try {
    const startIndex = (parseInt(page) - 1) * parseInt(page_size);

    const { data, error, count } = await supabase
      .from("emotional_events")
      .select("*", { count: 'exact' })
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(startIndex, startIndex + parseInt(page_size) - 1);

    if (error) {
      console.error("获取情感事件列表错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取情感事件列表失败",
        error: error.message
      });
    }

    const totalPages = Math.ceil(count / parseInt(page_size));
    const hasNext = parseInt(page) < totalPages;
    const hasPrevious = parseInt(page) > 1;

    res.status(200).json({
      code: 200,
      message: "获取情感事件列表成功",
      data: {
        count: count,
        next: hasNext ? `/api/anyu/emotional/events?page=${parseInt(page) + 1}&page_size=${page_size}` : null,
        previous: hasPrevious ? `/api/anyu/emotional/events?page=${parseInt(page) - 1}&page_size=${page_size}` : null,
        results: data || []
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

// 创建情感事件
router.post("/events", async (req, res) => {
  const { title, content, mood, date } = req.body;
  const supabase = req.app.get('supabase');

  // 验证必填字段
  if (!title || !mood) {
    return res.status(400).json({
      code: 400,
      message: "标题和情绪状态不能为空"
    });
  }

  // 验证情绪状态
  const validMoods = ['happy', 'sad', 'angry', 'neutral', 'excited', 'anxious'];
  if (!validMoods.includes(mood)) {
    return res.status(400).json({
      code: 400,
      message: "情绪状态必须是: happy, sad, angry, neutral, excited, anxious"
    });
  }

  try {
    const eventData = {
      title,
      content: content || '',
      mood,
      date: date || new Date().toISOString().split('T')[0]
    };

    const { data, error } = await supabase
      .from("emotional_events")
      .insert([eventData])
      .select("*");

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
      data: data[0]
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

// 添加观点/反思
router.post("/perspectives", async (req, res) => {
  const { event_id, content, perspective_type } = req.body;
  const supabase = req.app.get('supabase');

  // 验证必填字段
  if (!event_id || !content || !perspective_type) {
    return res.status(400).json({
      code: 400,
      message: "事件ID、内容和观点类型不能为空"
    });
  }

  // 验证观点类型
  const validTypes = ['reflection', 'insight', 'action'];
  if (!validTypes.includes(perspective_type)) {
    return res.status(400).json({
      code: 400,
      message: "观点类型必须是: reflection, insight, action"
    });
  }

  // 验证事件ID格式
  if (isNaN(event_id)) {
    return res.status(400).json({
      code: 400,
      message: "无效的事件ID"
    });
  }

  try {
    // 检查事件是否存在
    const { data: event, error: eventError } = await supabase
      .from("emotional_events")
      .select("id")
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({
        code: 404,
        message: "关联的情感事件不存在"
      });
    }

    const perspectiveData = {
      event_id: parseInt(event_id),
      content,
      perspective_type
    };

    const { data, error } = await supabase
      .from("perspectives")
      .insert([perspectiveData])
      .select(`
        id,
        content,
        perspective_type,
        created_at,
        event:emotional_events(id, title)
      `);

    if (error) {
      console.error("创建观点错误:", error);
      return res.status(500).json({
        code: 500,
        message: "创建观点失败",
        error: error.message
      });
    }

    res.status(201).json({
      code: 201,
      message: "观点添加成功",
      data: data[0]
    });
  } catch (error) {
    console.error("添加观点异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 获取事件的个人观点
router.get("/events/:id/perspectives", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  // 验证ID格式
  if (!id || isNaN(id)) {
    return res.status(400).json({
      code: 400,
      message: "无效的事件ID"
    });
  }

  try {
    const { data, error } = await supabase
      .from("perspectives")
      .select(`
        id,
        content,
        perspective_type,
        created_at
      `)
      .eq('event_id', id)
      .order('created_at', { ascending: false });

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
      data: {
        results: data || []
      }
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