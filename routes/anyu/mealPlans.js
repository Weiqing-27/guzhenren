const express = require("express");
const router = express.Router();

// 获取食谱列表
router.get("/recipes", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { category, difficulty } = req.query;

  try {
    let query = supabase
      .from("recipes")
      .select("*")
      .order('name');

    // 应用筛选条件
    if (category) {
      query = query.eq('category', category);
    }
    
    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    const { data, error } = await query;

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
        results: data || []
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

// 创建食谱
router.post("/recipes", async (req, res) => {
  const { name, description, category, difficulty, cooking_time, ingredients, steps } = req.body;
  const supabase = req.app.get('supabase');

  // 验证必填字段
  if (!name) {
    return res.status(400).json({
      code: 400,
      message: "食谱名称不能为空"
    });
  }

  // 验证难度等级
  if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
    return res.status(400).json({
      code: 400,
      message: "难度等级必须是: easy, medium, hard"
    });
  }

  // 验证烹饪时间
  if (cooking_time && (isNaN(cooking_time) || parseInt(cooking_time) <= 0)) {
    return res.status(400).json({
      code: 400,
      message: "烹饪时间必须是大于0的数字"
    });
  }

  try {
    const recipeData = {
      name,
      description: description || '',
      category: category || '其他',
      difficulty: difficulty || 'medium',
      cooking_time: cooking_time ? parseInt(cooking_time) : null,
      ingredients: ingredients || [],
      steps: steps || []
    };

    const { data, error } = await supabase
      .from("recipes")
      .insert([recipeData])
      .select("*");

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
      data: data[0]
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

// 获取订单列表
router.get("/orders", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { status, date_from, date_to } = req.query;

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
        recipe:recipes(id, name, cooking_time)
      `)
      .order('scheduled_date', { ascending: true })
      .order('created_at', { ascending: false });

    // 应用筛选条件
    if (status) {
      query = query.eq('status', status);
    }
    
    if (date_from) {
      query = query.gte('scheduled_date', date_from);
    }
    
    if (date_to) {
      query = query.lte('scheduled_date', date_to);
    }

    const { data, error } = await query;

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
        results: data || []
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

// 创建订单
router.post("/orders", async (req, res) => {
  const { recipe_id, scheduled_date, servings, notes } = req.body;
  const supabase = req.app.get('supabase');

  // 验证必填字段
  if (!recipe_id || !scheduled_date) {
    return res.status(400).json({
      code: 400,
      message: "食谱ID和预定日期不能为空"
    });
  }

  // 验证食谱ID格式
  if (isNaN(recipe_id)) {
    return res.status(400).json({
      code: 400,
      message: "无效的食谱ID"
    });
  }

  // 验证预定日期格式
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(scheduled_date)) {
    return res.status(400).json({
      code: 400,
      message: "日期格式不正确，应为 YYYY-MM-DD"
    });
  }

  // 验证份数
  if (servings && (isNaN(servings) || parseInt(servings) <= 0)) {
    return res.status(400).json({
      code: 400,
      message: "份数必须是大于0的数字"
    });
  }

  try {
    // 检查食谱是否存在
    const { data: recipe, error: recipeError } = await supabase
      .from("recipes")
      .select("id")
      .eq('id', recipe_id)
      .single();

    if (recipeError || !recipe) {
      return res.status(404).json({
        code: 404,
        message: "关联的食谱不存在"
      });
    }

    const orderData = {
      recipe_id: parseInt(recipe_id),
      scheduled_date,
      servings: servings ? parseInt(servings) : 1,
      notes: notes || '',
      status: 'pending'
    };

    const { data, error } = await supabase
      .from("meal_orders")
      .insert([orderData])
      .select(`
        id,
        scheduled_date,
        servings,
        notes,
        status,
        created_at,
        recipe:recipes(id, name)
      `);

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
      data: data[0]
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

// 更新订单状态
router.patch("/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const supabase = req.app.get('supabase');

  // 验证ID格式
  if (!id || isNaN(id)) {
    return res.status(400).json({
      code: 400,
      message: "无效的订单ID"
    });
  }

  // 验证状态
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      code: 400,
      message: "订单状态必须是: pending, confirmed, completed, cancelled"
    });
  }

  try {
    const { data, error } = await supabase
      .from("meal_orders")
      .update({ status })
      .eq('id', id)
      .select(`
        id,
        scheduled_date,
        servings,
        notes,
        status,
        created_at,
        recipe:recipes(id, name)
      `);

    if (error) {
      console.error("更新订单状态错误:", error);
      return res.status(500).json({
        code: 500,
        message: "更新订单状态失败",
        error: error.message
      });
    }

    if (data && data.length > 0) {
      res.status(200).json({
        code: 200,
        message: "订单状态更新成功",
        data: data[0]
      });
    } else {
      res.status(404).json({
        code: 404,
        message: "订单不存在"
      });
    }
  } catch (error) {
    console.error("更新订单状态异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

module.exports = router;