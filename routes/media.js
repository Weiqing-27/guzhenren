// routes/media.js
const express = require("express");
const router = express.Router();

/**
 * 【功能描述】
 * 为指定用户创建一条情侣媒体记录（标题、描述、媒体 URL 等）。
 *
 * 【业务逻辑】
 * 1. 从请求体读取媒体字段及 user_id。
 * 2. 在 custom_user 表中验证用户是否存在。
 * 3. 向 couple_media 表插入新记录并返回。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().select().single、supabase.from().insert
 * - 涉及知识点：外键用户校验、Supabase insert + select
 */
router.post("/media", async (req, res) => {
  const {
    title,
    description,
    media_type,
    media_url,
    thumbnail_url,
    user_id
  } = req.body;
  
  const supabase = req.app.get('supabase');

  try {
    // 首先验证用户是否存在
    const { data: userData, error: userError } = await supabase
      .from("custom_user")
      .select("userId")
      .eq("userId", user_id)
      .single();

    if (userError || !userData) {
      return res.status(400).json({
        error: "用户不存在",
        details: `用户ID ${user_id} 在系统中找不到`
      });
    }

    
    // 插入新的媒体记录
    const { data, error } = await supabase
      .from("couple_media")
      .insert([
        {
          title,
          description,
          media_type,
          media_url,
          thumbnail_url,
          user_id
        }
      ])
      .select();

    if (error) {
      console.error("添加媒体记录错误:", error);
      return res.status(500).json({ error: "添加媒体记录失败" });
    }

    res.status(201).json({
      code: 201,
      message: "媒体记录添加成功",
      data: data[0]
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

/**
 * 【功能描述】
 * 获取指定用户的全部情侣媒体记录，按创建时间倒序。
 *
 * 【业务逻辑】
 * 1. 从路径参数获取 userId。
 * 2. 验证 custom_user 中该用户存在。
 * 3. 查询 couple_media 表中 user_id 匹配的记录并返回。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().eq().order
 * - 涉及知识点：路径参数、Supabase 条件查询与排序
 */
router.get("/media/:userId", async (req, res) => {
  const { userId } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 验证用户是否存在
    const { data: userData, error: userError } = await supabase
      .from("custom_user")
      .select("userId")
      .eq("userId", userId)
      .single();

    if (userError || !userData) {
      return res.status(400).json({
        error: "用户不存在",
        details: `用户ID ${userId} 在系统中找不到`
      });
    }

    // 查询该用户的所有媒体记录
    const { data, error } = await supabase
      .from("couple_media")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("获取媒体记录错误:", error);
      return res.status(500).json({ error: "获取媒体记录失败" });
    }

    res.status(200).json({
      code: 200,
      message: "获取媒体记录成功",
      data: data
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

/**
 * 【功能描述】
 * 根据媒体 ID 获取单条情侣媒体详情，并关联发布者用户信息。
 *
 * 【业务逻辑】
 * 1. 从路径参数获取媒体 id。
 * 2. 查询 couple_media 并 join custom_user 获取 username、avatar_url。
 * 3. 记录不存在时返回 404，否则返回详情。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select（嵌套关联）、single
 * - 涉及知识点：Supabase 外键关联查询、PostgREST embed
 */
router.get("/media/detail/:id", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  try {
    const { data, error } = await supabase
      .from("couple_media")
      .select(`
        *,
        custom_user(username, avatar_url)
      `)
      .eq("id", id)
      .single();

    if (error) {
      console.error("获取媒体详情错误:", error);
      return res.status(500).json({ error: "获取媒体详情失败" });
    }

    if (!data) {
      return res.status(404).json({ error: "媒体记录不存在" });
    }

    res.status(200).json({
      code: 200,
      message: "获取媒体详情成功",
      data: data
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

/**
 * 【功能描述】
 * 根据 ID 删除一条情侣媒体记录。
 *
 * 【业务逻辑】
 * 1. 从路径参数获取媒体 id。
 * 2. 在 couple_media 表中按 id 执行删除。
 * 3. 返回删除成功或失败响应。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.from().delete().eq
 * - 涉及知识点：Supabase 单行删除、Express REST 路由
 */
router.delete("/media/:id", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  try {
    const { error } = await supabase
      .from("couple_media")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("删除媒体记录错误:", error);
      return res.status(500).json({ error: "删除媒体记录失败" });
    }

    res.status(200).json({
      code: 200,
      message: "删除成功"
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

module.exports = router;
