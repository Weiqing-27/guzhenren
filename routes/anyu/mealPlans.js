const express = require("express");
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

// 应用认证中间件到所有路由
router.use(authenticate);

// 先定义具体的路由，避免与:id参数路由冲突
/**
 * 【功能描述】
 * 分页获取当前用户的食谱列表。
 *
 * 【业务逻辑】
 * 1. 从查询参数读取分页、分类、难度等过滤条件。
 * 2. 按创建时间倒序查询当前用户的食谱。
 * 3. 返回食谱列表及分页元数据。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().eq().order().range()
 * - 涉及知识点：路由注册顺序（具体路径优先于 :id）、Supabase 分页
 */
router.get("/recipes", async (req, res) => {
  const supabase = req.app.get('supabase');
  const {
    page = 1,
    page_size = 10,
    category,
    difficulty
  } = req.query;

  try {
    let query = supabase
      .from("recipes")
      .select(`
        id,
        name,
        description,
        category,
        difficulty,
        cooking_time,
        ingredients,
        steps,
        created_at
      `, { count: 'exact' })
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false });

    // 应用过滤条件
    if (category) {
      query = query.eq('category', category);
    }
    
    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    // 分页处理
    const startIndex = (parseInt(page) - 1) * parseInt(page_size);
    query = query.range(startIndex, startIndex + parseInt(page_size) - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("获取食谱列表错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取食谱列表失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取食谱列表成功",
      data: {
        recipes: data || [],
        pagination: {
          current_page: parseInt(page),
          page_size: parseInt(page_size),
          total: count || 0,
          total_pages: Math.ceil((count || 0) / parseInt(page_size))
        }
      }
    });
  } catch (error) {
    console.error("获取食谱列表异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

/**
 * 【功能描述】
 * 为当前用户创建一条食谱记录。
 *
 * 【业务逻辑】
 * 1. 校验名称、食材、步骤必填，难度可选且须为合法值。
 * 2. 将 ingredients/steps 规范为数组，填充默认难度和烹饪时长。
 * 3. 插入 recipes 表并返回新记录。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().select().single()
 * - 涉及知识点：数组字段规范化、枚举值校验、默认值填充
 */
router.post("/recipes", async (req, res) => {
  const { 
    name, 
    description, 
    category, 
    difficulty, 
    cooking_time, 
    ingredients, 
    steps 
  } = req.body;
  const supabase = req.app.get('supabase');

  // 验证必填字段
  if (!name || !ingredients || !steps) {
    return res.status(400).json({
      code: 400,
      message: "食谱名称、食材和步骤都是必填项"
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
    // 创建食谱
    const { data, error } = await supabase
      .from("recipes")
      .insert([{
        name,
        description: description || '',
        category: category || '',
        difficulty: difficulty || 'medium',
        cooking_time: cooking_time || 30,
        ingredients: Array.isArray(ingredients) ? ingredients : [ingredients],
        steps: Array.isArray(steps) ? steps : [steps],
        user_id: req.user.userId
      }])
      .select()
      .single();

    if (error) {
      console.error("创建食谱错误:", error);
      return res.status(500).json({
        code: 500,
        message: "创建食谱失败",
        error: error.message
      });
    }

    res.status(201).json({
      code: 201,
      message: "食谱创建成功",
      data: data
    });
  } catch (error) {
    console.error("创建食谱异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

/**
 * 【功能描述】
 * 分页获取当前用户的餐饮订单列表。
 *
 * 【业务逻辑】
 * 1. 从查询参数读取分页、状态、日期范围等过滤条件。
 * 2. 按预定日期和创建时间倒序查询，并关联食谱信息。
 * 3. 返回订单列表及分页元数据。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().eq().order().range()
 * - 涉及知识点：Supabase 外键嵌套 select、分页与多条件过滤
 */
router.get("/orders", async (req, res) => {
  const supabase = req.app.get('supabase');
  const {
    page = 1,
    page_size = 10,
    status,
    date_from,
    date_to
  } = req.query;

  try {
    let query = supabase
      .from("meal_orders")
      .select(`
        id,
        scheduled_date,
        servings,
        notes,
        status,
        created_at,
        recipe:recipe_id (
          id,
          name,
          cooking_time
        )
      `, { count: 'exact' })
      .eq('user_id', req.user.userId)
      .order('scheduled_date', { ascending: false })
      .order('created_at', { ascending: false });

    // 应用过滤条件
    if (status) {
      query = query.eq('status', status);
    }
    
    if (date_from) {
      query = query.gte('scheduled_date', date_from);
    }
    
    if (date_to) {
      query = query.lte('scheduled_date', date_to);
    }

    // 分页处理
    const startIndex = (parseInt(page) - 1) * parseInt(page_size);
    query = query.range(startIndex, startIndex + parseInt(page_size) - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("获取订单列表错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取订单列表失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取订单列表成功",
      data: {
        orders: data || [],
        pagination: {
          current_page: parseInt(page),
          page_size: parseInt(page_size),
          total: count || 0,
          total_pages: Math.ceil((count || 0) / parseInt(page_size))
        }
      }
    });
  } catch (error) {
    console.error("获取订单列表异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

/**
 * 【功能描述】
 * 基于已有食谱为当前用户创建餐饮订单。
 *
 * 【业务逻辑】
 * 1. 校验 recipe_id 和 scheduled_date 必填。
 * 2. 确认食谱存在且属于当前用户。
 * 3. 以 pending 状态创建订单，默认份数为 1。
 * 4. 返回含食谱摘要的新订单。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().select().single()
 * - 涉及知识点：外键关联校验、嵌套 select 返回关联数据
 */
router.post("/orders", async (req, res) => {
  const { 
    recipe_id, 
    scheduled_date, 
    servings, 
    notes 
  } = req.body;
  const supabase = req.app.get('supabase');

  // 验证必填字段
  if (!recipe_id || !scheduled_date) {
    return res.status(400).json({
      code: 400,
      message: "食谱ID和预定日期都是必填项"
    });
  }

  try {
    // 验证食谱是否存在且属于当前用户
    const { data: recipe, error: recipeError } = await supabase
      .from("recipes")
      .select("id")
      .eq("id", recipe_id)
      .eq("user_id", req.user.userId)
      .single();

    if (recipeError || !recipe) {
      return res.status(404).json({
        code: 404,
        message: "食谱不存在或无权限访问"
      });
    }

    // 创建订单
    const { data, error } = await supabase
      .from("meal_orders")
      .insert([{
        recipe_id,
        scheduled_date,
        servings: servings || 1,
        notes: notes || '',
        status: 'pending',
        user_id: req.user.userId
      }])
      .select(`
        id,
        scheduled_date,
        servings,
        notes,
        status,
        created_at,
        recipe:recipe_id (
          id,
          name
        )
      `)
      .single();

    if (error) {
      console.error("创建订单错误:", error);
      return res.status(500).json({
        code: 500,
        message: "创建订单失败",
        error: error.message
      });
    }

    res.status(201).json({
      code: 201,
      message: "订单创建成功",
      data: data
    });
  } catch (error) {
    console.error("创建订单异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

/**
 * 【功能描述】
 * 更新指定餐饮订单的状态。
 *
 * 【业务逻辑】
 * 1. 校验 status 为 pending/confirmed/completed/cancelled 之一。
 * 2. 确认订单存在且属于当前用户。
 * 3. 更新状态并返回含食谱信息的最新订单。
 *
 * 【技术实现】
 * - 涉及方法：router.patch、supabase.from().update().eq().select().single()
 * - 涉及知识点：PATCH 部分更新、状态机枚举校验
 */
router.patch("/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const supabase = req.app.get('supabase');

  // 验证状态
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      code: 400,
      message: "状态必须是 pending、confirmed、completed 或 cancelled"
    });
  }

  try {
    // 首先验证订单是否存在且属于当前用户
    const { data: existingOrder, error: checkError } = await supabase
      .from("meal_orders")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .single();

    if (checkError || !existingOrder) {
      return res.status(404).json({
        code: 404,
        message: "订单不存在或无权限访问"
      });
    }

    // 更新状态
    const { data, error } = await supabase
      .from("meal_orders")
      .update({ status })
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .select(`
        id,
        scheduled_date,
        servings,
        notes,
        status,
        created_at,
        recipe:recipe_id (
          id,
          name
        )
      `)
      .single();

    if (error) {
      console.error("更新订单状态错误:", error);
      return res.status(500).json({
        code: 500,
        message: "更新订单状态失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "订单状态更新成功",
      data: data
    });
  } catch (error) {
    console.error("更新订单状态异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 然后定义通用的餐饮计划相关路由
/**
 * 【功能描述】
 * 分页获取当前用户的餐饮计划列表。
 *
 * 【业务逻辑】
 * 1. 从查询参数读取分页、计划日期、难度、状态等过滤条件。
 * 2. 按 planned_date 和 created_at 倒序查询。
 * 3. 返回餐饮计划列表及分页元数据。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().eq().order().range()
 * - 涉及知识点：根路径路由、Supabase 精确计数与分页
 */
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

/**
 * 【功能描述】
 * 为当前用户创建一条餐饮计划。
 *
 * 【业务逻辑】
 * 1. 校验标题、食材、步骤、计划日期必填，难度可选。
 * 2. 规范 ingredients/steps 为数组，填充默认难度、时长和 pending 状态。
 * 3. 插入 meal_plans 表并返回新记录。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().select().single()
 * - 涉及知识点：JSON 数组字段存储、枚举校验、默认值
 */
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

/**
 * 【功能描述】
 * 更新指定餐饮计划的状态。
 *
 * 【业务逻辑】
 * 1. 校验 status 为 pending/cooking/completed/cancelled 之一。
 * 2. 确认计划存在且属于当前用户。
 * 3. 更新状态并返回最新计划数据。
 *
 * 【技术实现】
 * - 涉及方法：router.put、supabase.from().update().eq().select().single()
 * - 涉及知识点：子路径路由 /:id/status、状态枚举校验
 */
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

/**
 * 【功能描述】
 * 获取当前用户指定 ID 的餐饮计划详情。
 *
 * 【业务逻辑】
 * 1. 按 ID 和用户 ID 查询 meal_plans 表。
 * 2. 不存在或无权限时返回 404。
 * 3. 成功则返回完整计划数据。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().eq().single()
 * - 涉及知识点：路径参数路由、单条记录查询、用户数据隔离
 */
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

/**
 * 【功能描述】
 * 更新当前用户指定 ID 的餐饮计划内容。
 *
 * 【业务逻辑】
 * 1. 确认计划存在且属于当前用户。
 * 2. 按需构建更新字段，规范 ingredients/steps 为数组。
 * 3. 校验难度枚举后写入并返回最新数据。
 *
 * 【技术实现】
 * - 涉及方法：router.put、supabase.from().update().eq().select().single()
 * - 涉及知识点：部分字段更新、动态 updateData 构建
 */
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

/**
 * 【功能描述】
 * 删除当前用户指定 ID 的餐饮计划。
 *
 * 【业务逻辑】
 * 1. 确认计划存在且属于当前用户。
 * 2. 执行删除操作。
 * 3. 返回删除成功响应。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.from().delete().eq()
 * - 涉及知识点：删除前所有权校验、用户数据隔离
 */
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

// 这里不需要替换任何内容，因为上面的SEARCH/REPLACE块已经完成了路由顺序的重排

module.exports = router;
