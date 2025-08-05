const express = require("express");
const router = express.Router();

// 保存贪吃蛇分数接口
router.post("/scores", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { name, score } = req.body;

  // 验证输入
  if (!name || typeof score !== "number" || score < 0) {
    return res.status(400).json({ error: "参数不合法: 需要 name 和非负数 score" });
  }

  try {
    // 插入分数记录
    const { data, error } = await supabase
      .from("scores")
      .insert([{ name, score }])
      .select();

    if (error) {
      console.error("保存贪吃蛇分数错误:", error);
      return res.status(500).json({ error: "保存分数失败", details: error.message });
    }

    res.status(201).json({
      code:"200",
      message: "贪吃蛇分数保存成功",
      data,
    });
  } catch (error) {
    console.error("服务器异常:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 获取贪吃蛇排行榜接口
router.get("/leaderboard", async (req, res) => {
  const supabase = req.app.get('supabase');
  
  try {
    const limit = parseInt(req.query.limit) || 100; // 默认前10名
    const offset = parseInt(req.query.offset) || 0;

    // 查询排行榜
    const { data: leaderboard, error } = await supabase
      .from("scores")
      .select("name, score, created_at")
      .order("score", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("获取贪吃蛇排行榜错误:", error);
      return res.status(500).json({ error: "获取排行榜失败", details: error.message });
    }

    // 查询总记录数
    const { count } = await supabase
      .from("scores")
      .select("*", { count: "exact", head: true });

    res.status(200).json({
      success: true,
      data: {
        leaderboard,
        pagination: {
          total: count || 0,
          limit,
          offset,
        },
      },
    });
  } catch (error) {
    console.error("服务器异常:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

module.exports = router;