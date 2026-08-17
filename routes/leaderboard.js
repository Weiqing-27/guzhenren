const express = require("express");
const router = express.Router();

/**
 * 【功能描述】
 * 获取通用游戏排行榜列表
 *
 * 【业务逻辑】
 * 1. 解析 limit/offset 分页参数
 * 2. 按分数降序查询 leaderboard 表
 * 3. 附带总记录数返回分页元数据
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().order().range()、count head 查询
 * - 涉及知识点：Express GET 路由、Supabase 分页与排序
 */
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

/**
 * 【功能描述】
 * 提交玩家分数到排行榜
 *
 * 【业务逻辑】
 * 1. 校验 player_name 与 score 必填
 * 2. 插入 leaderboard 表新记录
 * 3. 返回插入结果
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().insert().select()
 * - 涉及知识点：Express POST 路由、请求体校验、Supabase 写入
 */
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
