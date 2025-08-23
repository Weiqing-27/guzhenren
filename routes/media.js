// routes/media.js
const express = require("express");
const router = express.Router();

// 上传媒体文件信息
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

// 获取指定用户的所有媒体记录
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

// 获取单个媒体记录详情
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

// 删除媒体记录
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