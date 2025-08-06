// routes/couple.js
const express = require("express");
const router = express.Router();

// 添加吵架记录
// 添加吵架记录
router.post("/disputes", async (req, res) => {
  const {
    dispute_date,
    reason,
    is_quarrel,
    anger_level,
    quarrel_level,
    description,
    is_resolved,
    who_is_wrong,
    who_should_apologize,
    user_id,
    couple_id
  } = req.body;
  
  const supabase = req.app.get('supabase');

  try {
    // 修正：只验证 userId 字段
    const { data: userData, error: userError } = await supabase
      .from("custom_user")
      .select("userId, username")
      .eq("userId", user_id)
      .single();

    if (userError || !userData) {
      console.error("用户不存在:", userError);
      return res.status(400).json({ 
        error: "用户不存在", 
        details: `用户ID ${user_id} 在系统中找不到` 
      });
    }

    // 验证情侣关系是否存在（可选）
    if (couple_id) {
      const { data: coupleData, error: coupleError } = await supabase
        .from("couples")
        .select("id")
        .eq("id", couple_id)
        .single();

      if (coupleError || !coupleData) {
        console.error("情侣关系不存在:", coupleError);
        return res.status(400).json({ 
          error: "情侣关系不存在", 
          details: `情侣ID ${couple_id} 在系统中找不到` 
        });
      }
    }

    const { data, error } = await supabase
      .from("couple_disputes")
      .insert([
        {
          dispute_date,
          reason,
          is_quarrel,
          anger_level,
          quarrel_level,
          description,
          is_resolved,
          who_is_wrong,
          who_should_apologize,
          user_id,  // 直接使用传入的 user_id
          couple_id
        }
      ])
      .select();

    if (error) {
      console.error("创建吵架记录错误:", error);
      return res.status(500).json({ error: "创建记录失败" });
    }

    res.status(201).json({
      code: 201,
      message: "记录创建成功",
      data: data[0]
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 获取吵架记录列表（按时间排序）
router.get("/disputes/:userId", async (req, res) => {
  const { userId } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 首先验证用户是否存在
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

    // 直接根据用户ID查询该用户创建的吵架记录
    const { data, error } = await supabase
      .from("couple_disputes")
      .select("*")
      .eq("user_id", userId)
      .order("dispute_date", { ascending: false });

    if (error) {
      console.error("获取记录错误:", error);
      return res.status(500).json({ error: "获取记录失败" });
    }

    res.status(200).json({
      code: 200,
      message: "获取记录成功",
      data: data
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 更新吵架记录
router.put("/disputes/:id", async (req, res) => {
  const { id } = req.params;
  const {
    reason,
    is_quarrel,
    anger_level,
    quarrel_level,
    description,
    is_resolved,
    who_is_wrong,
    who_should_apologize
  } = req.body;
  
  const supabase = req.app.get('supabase');

  try {
    const { data, error } = await supabase
      .from("couple_disputes")
      .update({
        reason,
        is_quarrel,
        anger_level,
        quarrel_level,
        description,
        is_resolved,
        who_is_wrong,
        who_should_apologize
      })
      .eq("id", id)
      .select();

    if (error) {
      console.error("更新记录错误:", error);
      return res.status(500).json({ error: "更新记录失败" });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "记录不存在" });
    }

    res.status(200).json({
      code: 200,
      message: "更新成功",
      data: data[0]
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 删除吵架记录
router.delete("/disputes/:id", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  try {
    const { error } = await supabase
      .from("couple_disputes")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("删除记录错误:", error);
      return res.status(500).json({ error: "删除记录失败" });
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

// 添加评论
router.post("/comments", async (req, res) => {
  const { comment, dispute_id, user_id } = req.body;
  const supabase = req.app.get('supabase');

  try {
    const { data, error } = await supabase
      .from("dispute_comments")
      .insert([
        {
          comment,
          dispute_id,
          user_id
        }
      ])
      .select();

    if (error) {
      console.error("添加评论错误:", error);
      return res.status(500).json({ error: "添加评论失败" });
    }

    res.status(201).json({
      code: 201,
      message: "评论添加成功",
      data: data[0]
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 获取特定记录的评论
router.get("/comments/:disputeId", async (req, res) => {
  const { disputeId } = req.params;
  const supabase = req.app.get('supabase');

  try {
    const { data, error } = await supabase
      .from("dispute_comments")
      .select(`
        *,
        custom_user(username, avatar_url)
      `)
      .eq("dispute_id", disputeId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("获取评论错误:", error);
      return res.status(500).json({ error: "获取评论失败" });
    }

    res.status(200).json({
      code: 200,
      message: "获取评论成功",
      data: data
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 创建提醒
router.post("/reminders", async (req, res) => {
  const { reminder_date, dispute_id, user_id } = req.body;
  const supabase = req.app.get('supabase');

  try {
    const { data, error } = await supabase
      .from("dispute_reminders")
      .insert([
        {
          reminder_date,
          dispute_id,
          user_id
        }
      ])
      .select();

    if (error) {
      console.error("创建提醒错误:", error);
      return res.status(500).json({ error: "创建提醒失败" });
    }

    res.status(201).json({
      code: 201,
      message: "提醒创建成功",
      data: data[0]
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

// 获取统计信息
router.get("/statistics/:userId", async (req, res) => {
  const { userId } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 首先验证用户是否存在
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

    // 直接根据用户ID获取该用户的吵架频率统计
    const { data: frequencyData, error: frequencyError } = await supabase
      .from("couple_disputes")
      .select("dispute_date, is_resolved")
      .eq("user_id", userId)
      .order("dispute_date", { ascending: true });

    if (frequencyError) {
      console.error("获取统计信息错误:", frequencyError);
      return res.status(500).json({ error: "获取统计信息失败" });
    }

    // 计算解决率
    const total = frequencyData.length;
    const resolved = frequencyData.filter(item => item.is_resolved).length;
    const resolutionRate = total > 0 ? (resolved / total) * 100 : 0;

    res.status(200).json({
      code: 200,
      message: "获取统计信息成功",
      data: {
        total_disputes: total,
        resolved_disputes: resolved,
        resolution_rate: resolutionRate.toFixed(2),
        frequency_data: frequencyData
      }
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

module.exports = router;