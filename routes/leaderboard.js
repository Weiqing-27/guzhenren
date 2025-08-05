const express = require("express");
const router = express.Router();

// 获取排行榜接口
router.get("/", async (req, res) => {
  const supabase = req.app.get('supabase');
  
  try {
    // 从查询参数获取可选参数
    const limit = parseInt(req.query.limit) || 100; // 默认返回前10名
    const offset = parseInt(req.query.offset) || 0; // 分页偏移量

    // 查询排行榜数据
    const { data: leaderboard, error } = await supabase
      .from("leaderboard")
      .select("player_name, score, created_at")
      .order("score", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("获取排行榜错误:", error);
      return res.status(500).json({
        error: "获取排行榜失败",
        details: error.message,
      });
    }

    // 查询总记录数用于分页
    const { count } = await supabase
      .from("leaderboard")
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
    console.error("获取排行榜异常:", error);
    res.status(500).json({
      error: "服务器错误",
      details: error.message,
    });
  }
});

// 提交分数接口
router.post("/", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { player_name, score } = req.body;

  // 验证输入
  if (!player_name || typeof score !== "number") {
    return res.status(400).json({
      error: "参数不合法: 需要 player_name 和 score",
    });
  }

  try {
    // 插入新记录
    const { data, error } = await supabase
      .from("leaderboard")
      .insert([{ player_name, score }])
      .select();

    if (error) {
      console.error("提交分数错误:", error);
      return res.status(500).json({
        error: "提交分数失败",
        details: error.message,
      });
    }

    res.status(201).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("提交分数异常:", error);
    res.status(500).json({
      error: "服务器错误",
      details: error.message,
    });
  }
});

module.exports = router;