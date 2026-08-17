// routes/couple.js
const express = require("express");
const router = express.Router();

/**
 * 【功能描述】
 * 为指定用户创建一条情侣吵架/ dispute 记录。
 *
 * 【业务逻辑】
 * 1. 从请求体读取吵架日期、原因、等级、描述等字段及 user_id。
 * 2. 在 custom_user 表中验证用户是否存在。
 * 3. 向 couple_disputes 表插入新记录并返回。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().select().single、supabase.from().insert
 * - 涉及知识点：用户存在性校验、Supabase 批量 insert + select
 */
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
    user_id
  } = req.body;
  
  const supabase = req.app.get('supabase');

  try {
    // 首先验证用户是否存在
    console.log(`正在查询用户: ${user_id}`);
    
    // 使用正确的字段名和类型进行查询
    const { data: userData, error: userError } = await supabase
      .from("custom_user")
      .select("userId, username")
      .eq("userId", user_id)  // 确保字段名正确
      .single();

    console.log("用户查询结果:", userData, userError);

    if (userError || !userData) {
      return res.status(400).json({ 
        error: "用户不存在", 
        details: `用户ID ${user_id} 在系统中找不到` 
      });
    }

    // 插入新的吵架记录
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
          user_id
        }
      ])
      .select();

    if (error) {
      console.error("添加记录错误:", error);
      return res.status(500).json({ error: "添加记录失败" });
    }

    res.status(201).json({
      code: 201,
      message: "记录添加成功",
      data: data[0]
    });
  } catch (error) {
    console.error("服务器错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

/**
 * 【功能描述】
 * 获取指定用户的吵架记录列表，按 dispute_date 倒序排列。
 *
 * 【业务逻辑】
 * 1. 从路径参数获取 userId。
 * 2. 验证 custom_user 中该用户存在。
 * 3. 查询 couple_disputes 表中该 user_id 的全部记录并返回。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().eq().order
 * - 涉及知识点：路径参数、Supabase 条件查询与排序
 */
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

/**
 * 【功能描述】
 * 获取指定用户的吵架统计数据（总数、已解决数、解决率及时间序列数据）。
 *
 * 【业务逻辑】
 * 1. 验证 userId 对应用户存在。
 * 2. 查询该用户全部 dispute 的 dispute_date 与 is_resolved。
 * 3. 计算 total、resolved 及 resolution_rate，连同原始 frequency_data 返回。
 *
 * 【技术实现】
 * - 涉及方法：router.get、Array.filter、Supabase select + order
 * - 涉及知识点：内存聚合统计、解决率百分比计算
 */
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

    // 获取该用户的吵架频率统计
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

/**
 * 【功能描述】
 * 获取指定用户的吵架记录列表（与 /disputes/:userId 重复注册的路由，逻辑相同）。
 *
 * 【业务逻辑】
 * 1. 从路径参数获取 userId。
 * 2. 验证 custom_user 中该用户存在。
 * 3. 查询 couple_disputes 表中该 user_id 的全部记录，按 dispute_date 倒序返回。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().eq().order
 * - 涉及知识点：Express 重复路由注册（后者覆盖前者）、Supabase 条件查询
 */
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

/**
 * 【功能描述】
 * 根据 ID 更新一条吵架记录的可编辑字段。
 *
 * 【业务逻辑】
 * 1. 从路径参数获取记录 id，从请求体读取待更新字段。
 * 2. 在 couple_disputes 表中按 id 执行 update。
 * 3. 若无匹配记录返回 404，否则返回更新后的记录。
 *
 * 【技术实现】
 * - 涉及方法：router.put、supabase.from().update().eq().select
 * - 涉及知识点：部分字段更新、Supabase update 返回行
 */
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

/**
 * 【功能描述】
 * 根据 ID 删除一条吵架记录。
 *
 * 【业务逻辑】
 * 1. 从路径参数获取记录 id。
 * 2. 在 couple_disputes 表中按 id 执行 delete。
 * 3. 返回删除成功或失败响应。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.from().delete().eq
 * - 涉及知识点：Supabase 单行删除
 */
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

/**
 * 【功能描述】
 * 为指定吵架记录添加一条评论。
 *
 * 【业务逻辑】
 * 1. 从请求体读取 comment、dispute_id、user_id。
 * 2. 验证 custom_user 中评论者存在。
 * 3. 向 dispute_comments 表插入评论并返回。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert
 * - 涉及知识点：关联评论表、用户校验
 */
router.post("/comments", async (req, res) => {
  const { comment, dispute_id, user_id } = req.body;
  const supabase = req.app.get('supabase');

  try {

    // 验证用户是否存在
    const { data: userData, error: userError } = await supabase
      .from("custom_user")  // 确认表名是否正确
      .select("userId")
      .eq("userId", user_id)
      .single();

    if (userError || !userData) {
      return res.status(400).json({
        error: "用户不存在",
        details: `用户ID ${user_id} 在系统中找不到`
      });
    }


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

/**
 * 【功能描述】
 * 获取指定吵架记录下的全部评论，含评论者用户名与头像。
 *
 * 【业务逻辑】
 * 1. 从路径参数获取 disputeId。
 * 2. 查询 dispute_comments 并关联 custom_user。
 * 3. 按 created_at 升序返回评论列表。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select（嵌套关联）、order
 * - 涉及知识点：Supabase 外键 embed、一对多评论查询
 */
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

/**
 * 【功能描述】
 * 为指定吵架记录创建一条提醒（reminder）。
 *
 * 【业务逻辑】
 * 1. 从请求体读取 reminder_date、dispute_id、user_id。
 * 2. 向 dispute_reminders 表插入提醒记录。
 * 3. 返回创建成功的提醒数据。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert
 * - 涉及知识点：提醒表 CRUD、Supabase insert + select
 */
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

module.exports = router;
