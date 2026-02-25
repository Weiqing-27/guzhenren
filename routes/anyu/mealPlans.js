const express = require("express");
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

// 应用认证中间件到所有路由
router.use(authenticate);

// 获取餐饮计划列表 - 只返回当前用户的数据
router.get("/", async (req, res) => {
  const supabase = req.app.get('supabase');
  const {
    page = 1,
    page_size = 10,
    date,
    difficulty,
    status
  } = req.query;

  try {
    let query = supabase
      .from("meal_plans")
      .select(`
        id,
        title,
        description,
        ingredients,
        steps,
        difficulty,
        estimated_time,
        status,
        planned_date,
        created_at
      `, { count: 'exact' })
      .eq('user_id', req.user.userId) // 只查询当前用户的数据
      .order('planned_date', { ascending: false })
      .order('created_at', { ascending: false });

    // 应用过滤条件
    if (date) {
      query = query.eq('planned_date', date);
    }
    
    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }
    
    if (status) {
      query = query.eq('status', status);
    }

    // 分页处理
    const startIndex = (parseInt(page) - 1) * parseInt(page_size);
    query = query.range(startIndex, startIndex + parseInt(page_size) - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("获取餐饮计划列表错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取餐饮计划列表失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取餐饮计划列表成功",
      data: {
        meal_plans: data || [],
        pagination: {
          current_page: parseInt(page),
          page_size: parseInt(page_size),
          total: count || 0,
          total_pages: Math.ceil((count || 0) / parseInt(page_size))
        }
      }
    });
  } catch (error) {
    console.error("获取餐饮计划列表异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 创建餐饮计划 - 关联当前用户
router.post("/", async (req, res) => {
  const { 
    title, 
    description, 
    ingredients, 
    steps, 
    difficulty, 
    estimated_time, 
    planned_date 
  } = req.body;
  const supabase = req.app.get('supabase');

  // 验证必填字段
  if (!title || !ingredients || !steps || !planned_date) {
    return res.status(400).json({
      code: 400,
      message: "标题、食材、步骤和计划日期都是必填项"
    });
  }

  // 验证难度等级
  const validDifficulties = ['easy', 'medium', 'hard'];
  if (difficulty && !validDifficulties.includes(difficulty)) {
    return res.status(400).json({
      code: 400,
      message: "难度等级必须是 easy、medium 或 hard"
    });
  }

  try {
    // 创建餐饮计划
    const { data, error } = await supabase
      .from("meal_plans")
      .insert([{
        title,
        description: description || '',
        ingredients: Array.isArray(ingredients) ? ingredients : [ingredients],
        steps: Array.isArray(steps) ? steps : [steps],
        difficulty: difficulty || 'medium',
        estimated_time: estimated_time || 30,
        status: 'pending', // 默认状态为待完成
        planned_date,
        user_id: req.user.userId // 关联当前用户
      }])
      .select()
      .single();

    if (error) {
      console.error("创建餐饮计划错误:", error);
      return res.status(500).json({
        code: 500,
        message: "创建餐饮计划失败",
        error: error.message
      });
    }

    res.status(201).json({
      code: 201,
      message: "餐饮计划创建成功",
      data: data
    });
  } catch (error) {
    console.error("创建餐饮计划异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 更新餐饮计划状态 - 只允许更新自己的计划
router.put("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const supabase = req.app.get('supabase');

  // 验证状态
  const validStatuses = ['pending', 'cooking', 'completed', 'cancelled'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      code: 400,
      message: "状态必须是 pending、cooking、completed 或 cancelled"
    });
  }

  try {
    // 首先验证餐饮计划是否存在且属于当前用户
    const { data: existingPlan, error: checkError } = await supabase
      .from("meal_plans")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .single();

    if (checkError || !existingPlan) {
      return res.status(404).json({
        code: 404,
        message: "餐饮计划不存在或无权限访问"
      });
    }

    // 更新状态
    const { data, error } = await supabase
      .from("meal_plans")
      .update({ status })
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .select()
      .single();

    if (error) {
      console.error("更新餐饮计划状态错误:", error);
      return res.status(500).json({
        code: 500,
        message: "更新餐饮计划状态失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "餐饮计划状态更新成功",
      data: data
    });
  } catch (error) {
    console.error("更新餐饮计划状态异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 获取单个餐饮计划详情 - 只允许查看自己的计划
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  try {
    const { data, error } = await supabase
      .from("meal_plans")
      .select(`
        id,
        title,
        description,
        ingredients,
        steps,
        difficulty,
        estimated_time,
        status,
        planned_date,
        created_at
      `)
      .eq("id", id)
      .eq("user_id", req.user.userId) // 只查询当前用户的数据
      .single();

    if (error) {
      console.error("获取餐饮计划详情错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取餐饮计划详情失败",
        error: error.message
      });
    }

    if (!data) {
      return res.status(404).json({
        code: 404,
        message: "餐饮计划不存在或无权限访问"
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取餐饮计划详情成功",
      data: data
    });
  } catch (error) {
    console.error("获取餐饮计划详情异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 更新餐饮计划 - 只允许更新自己的计划
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { 
    title, 
    description, 
    ingredients, 
    steps, 
    difficulty, 
    estimated_time, 
    planned_date 
  } = req.body;
  const supabase = req.app.get('supabase');

  try {
    // 首先验证餐饮计划是否存在且属于当前用户
    const { data: existingPlan, error: checkError } = await supabase
      .from("meal_plans")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .single();

    if (checkError || !existingPlan) {
      return res.status(404).json({
        code: 404,
        message: "餐饮计划不存在或无权限访问"
      });
    }

    // 准备更新数据
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (ingredients !== undefined) updateData.ingredients = Array.isArray(ingredients) ? ingredients : [ingredients];
    if (steps !== undefined) updateData.steps = Array.isArray(steps) ? steps : [steps];
    if (difficulty !== undefined) {
      const validDifficulties = ['easy', 'medium', 'hard'];
      if (validDifficulties.includes(difficulty)) {
        updateData.difficulty = difficulty;
      }
    }
    if (estimated_time !== undefined) updateData.estimated_time = estimated_time;
    if (planned_date !== undefined) updateData.planned_date = planned_date;

    // 更新餐饮计划
    const { data, error } = await supabase
      .from("meal_plans")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .select()
      .single();

    if (error) {
      console.error("更新餐饮计划错误:", error);
      return res.status(500).json({
        code: 500,
        message: "更新餐饮计划失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "餐饮计划更新成功",
      data: data
    });
  } catch (error) {
    console.error("更新餐饮计划异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 删除餐饮计划 - 只允许删除自己的计划
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 首先验证餐饮计划是否存在且属于当前用户
    const { data: existingPlan, error: checkError } = await supabase
      .from("meal_plans")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .single();

    if (checkError || !existingPlan) {
      return res.status(404).json({
        code: 404,
        message: "餐饮计划不存在或无权限访问"
      });
    }

    // 删除餐饮计划
    const { error } = await supabase
      .from("meal_plans")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.userId);

    if (error) {
      console.error("删除餐饮计划错误:", error);
      return res.status(500).json({
        code: 500,
        message: "删除餐饮计划失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "餐饮计划删除成功"
    });
  } catch (error) {
    console.error("删除餐饮计划异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

module.exports = router;