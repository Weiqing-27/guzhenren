const express = require("express");
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

// 应用认证中间件到所有路由
router.use(authenticate);

// 获取账单列表 - 只返回当前用户的数据
router.get("/", async (req, res) => {
  const supabase = req.app.get('supabase');
  const {
    page = 1,
    page_size = 10,
    category,
    date_from,
    date_to,
    type
  } = req.query;

  try {
    let query = supabase
      .from("bills")
      .select(`
        id,
        amount,
        type,
        description,
        date,
        created_at,
        category:categories(id, name, icon)
      `, { count: 'exact' })
      .eq('user_id', req.user.userId) // 只查询当前用户的数据
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    // 应用过滤条件
    if (category) {
      query = query.eq('category_id', category);
    }
    
    if (date_from) {
      query = query.gte('date', date_from);
    }
    
    if (date_to) {
      query = query.lte('date', date_to);
    }
    
    if (type) {
      query = query.eq('type', type);
    }

    // 分页处理
    const startIndex = (parseInt(page) - 1) * parseInt(page_size);
    query = query.range(startIndex, startIndex + parseInt(page_size) - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("获取账单列表错误:", error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取账单列表失败",
        error: error.message 
      });
    }

    const totalPages = Math.ceil(count / parseInt(page_size));
    const hasNext = parseInt(page) < totalPages;
    const hasPrevious = parseInt(page) > 1;

    res.status(200).json({
      code: 200,
      message: "获取账单列表成功",
      data: {
        bills: data || [],
        pagination: {
          current_page: parseInt(page),
          page_size: parseInt(page_size),
          total: count || 0,
          total_pages: Math.ceil((count || 0) / parseInt(page_size))
        }
      }
    });
  } catch (error) {
    console.error("获取账单列表异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      error: error.message 
    });
  }
});

// 创建账单
router.post("/", async (req, res) => {
  const { amount, type, category_id, description, date } = req.body;
  const supabase = req.app.get('supabase');

  // 参数验证
  if (!amount || !type || !category_id || !date) {
    return res.status(400).json({
      code: 400,
      message: "金额、类型、分类和日期都是必填项"
    });
  }

  // 验证金额格式
  if (isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({
      code: 400,
      message: "金额必须是大于0的数字"
    });
  }

  // 验证类型
  if (!['income', 'outcome'].includes(type)) {
    return res.status(400).json({
      code: 400,
      message: "类型必须是 income 或 outcome"
    });
  }

  try {
    // 处理分类ID：如果传入的是字符串，尝试查找对应的分类ID
    let categoryIdToUse = category_id;
    
    // 如果category_id是字符串，尝试作为分类名称查找
    if (typeof category_id === 'string') {
      const { data: categoryByName, error: nameError } = await supabase
        .from("categories")
        .select("id")
        .eq("name", category_id)
        .eq("user_id", req.user.userId)
        .or(`user_id.is.null`)
        .single();

      if (categoryByName && !nameError) {
        categoryIdToUse = categoryByName.id;
      } else {
        // 如果按名称没找到，再尝试按ID查找（可能传入的是字符串数字）
        const parsedId = parseInt(category_id);
        if (!isNaN(parsedId)) {
          categoryIdToUse = parsedId;
        }
      }
    }

    // 验证分类是否存在且有访问权限
    // 允许两种情况：1) 默认分类(user_id为null) 2) 当前用户的自定义分类
    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("id, user_id")
      .eq("id", categoryIdToUse);

    if (categoryError || !category || category.length === 0) {
      return res.status(400).json({
        code: 400,
        message: "分类不存在或无权限访问"
      });
    }

    // 检查是否为默认分类或当前用户的分类
    const isDefaultCategory = category[0].user_id === null;
    const isUserCategory = category[0].user_id === req.user.userId;

    if (!isDefaultCategory && !isUserCategory) {
      return res.status(400).json({
        code: 400,
        message: "分类不存在或无权限访问"
      });
    }

    // 创建账单
    const { data, error: insertError } = await supabase
      .from("bills")
      .insert([{
        amount: parseFloat(amount),
        type,
        category_id: categoryIdToUse,
        description: description || '',
        date: date,
        user_id: req.user.userId // 关联当前用户
      }])
      .select(`
        id,
        amount,
        type,
        description,
        date,
        created_at,
        category:categories(id, name, icon)
      `)
      .single();

    if (insertError) {
      console.error("创建账单错误:", insertError);
      return res.status(500).json({
        code: 500,
        message: "创建账单失败",
        error: insertError.message
      });
    }

    res.status(201).json({
      code: 201,
      message: "账单创建成功",
      data: data
    });
  } catch (error) {
    console.error("创建账单异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 获取单个账单
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  // 验证ID格式
  if (!id || isNaN(id)) {
    return res.status(400).json({
      code: 400,
      message: "无效的账单ID"
    });
  }

  try {
    const { data, error } = await supabase
      .from("bills")
      .select(`
        id,
        amount,
        type,
        description,
        date,
        created_at,
        category:categories(id, name, icon)
      `)
      .eq("id", id)
      .eq("user_id", req.user.userId) // 只查询当前用户的数据
      .single();

    if (error) {
      console.error("获取账单详情错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取账单详情失败",
        error: error.message
      });
    }

    if (!data) {
      return res.status(404).json({
        code: 404,
        message: "账单不存在或无权限访问"
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取账单详情成功",
      data: data
    });
  } catch (error) {
    console.error("获取账单详情异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 更新账单
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { amount, type, category_id, description, date } = req.body;
  const supabase = req.app.get('supabase');

  // 验证ID格式
  if (!id || isNaN(id)) {
    return res.status(400).json({
      code: 400,
      message: "无效的账单ID"
    });
  }

  try {
    // 首先验证账单是否存在且属于当前用户
    const { data: existingBill, error: checkError } = await supabase
      .from("bills")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .single();

    if (checkError || !existingBill) {
      return res.status(404).json({
        code: 404,
        message: "账单不存在或无权限访问"
      });
    }

    // 如果提供了分类ID，验证分类权限
    if (category_id) {
      // 处理分类ID：如果传入的是字符串，尝试查找对应的分类ID
      let categoryIdToUse = category_id;
      
      // 如果category_id是字符串，尝试作为分类名称查找
      if (typeof category_id === 'string') {
        const { data: categoryByName, error: nameError } = await supabase
          .from("categories")
          .select("id")
          .eq("name", category_id)
          .eq("user_id", req.user.userId)
          .or(`user_id.is.null`)
          .single();

        if (categoryByName && !nameError) {
          categoryIdToUse = categoryByName.id;
        } else {
          // 如果按名称没找到，再尝试按ID查找（可能传入的是字符串数字）
          const parsedId = parseInt(category_id);
          if (!isNaN(parsedId)) {
            categoryIdToUse = parsedId;
          }
        }
      }
      
      const { data: category, error } = await supabase
        .from("categories")
        .select("id, user_id")
        .eq("id", categoryIdToUse);

      if (error || !category || category.length === 0) {
        return res.status(400).json({
          code: 400,
          message: "分类不存在或无权限访问"
        });
      }

      // 检查是否为默认分类或当前用户的分类
      const isDefaultCategory = category[0].user_id === null;
      const isUserCategory = category[0].user_id === req.user.userId;

      if (!isDefaultCategory && !isUserCategory) {
        return res.status(400).json({
          code: 400,
          message: "分类不存在或无权限访问"
        });
      }
    }

    // 准备更新数据
    const updateData = {};
    if (amount !== undefined) {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return res.status(400).json({
          code: 400,
          message: "金额必须是大于0的数字"
        });
      }
      updateData.amount = amountNum;
    }
    
    // 更新分类ID时处理字符串分类名
    if (category_id !== undefined) {
      let categoryIdToUse = category_id;
      
      // 如果category_id是字符串，尝试作为分类名称查找
      if (typeof category_id === 'string') {
        const { data: categoryByName, error: nameError } = await supabase
          .from("categories")
          .select("id")
          .eq("name", category_id)
          .eq("user_id", req.user.userId)
          .or(`user_id.is.null`)
          .single();

        if (categoryByName && !nameError) {
          categoryIdToUse = categoryByName.id;
        } else {
          // 如果按名称没找到，再尝试按ID查找（可能传入的是字符串数字）
          const parsedId = parseInt(category_id);
          if (!isNaN(parsedId)) {
            categoryIdToUse = parsedId;
          }
        }
      }
      updateData.category_id = categoryIdToUse;
    }
    
    if (type !== undefined) {
      if (!['income', 'outcome'].includes(type)) {
        return res.status(400).json({
          code: 400,
          message: "类型必须是 income 或 outcome"
        });
      }
      updateData.type = type;
    }
    
    if (category_id !== undefined) {
      updateData.category_id = parseInt(category_id);
    }
    
    if (description !== undefined) {
      updateData.description = description;
    }
    
    if (date !== undefined) {
      updateData.date = date;
    }

    // 添加更新时间
    updateData.updated_at = new Date().toISOString();

    // 更新账单
    const { data, error } = await supabase
      .from("bills")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .select(`
        id,
        amount,
        type,
        description,
        date,
        created_at,
        category:categories(id, name, icon)
      `)
      .single();

    if (error) {
      console.error("更新账单错误:", error);
      return res.status(500).json({
        code: 500,
        message: "更新账单失败",
        error: error.message
      });
    }

    if (data && data.length > 0) {
      res.status(200).json({
        code: 200,
        message: "账单更新成功",
        data: data[0]
      });
    } else {
      res.status(404).json({
        code: 404,
        message: "账单不存在"
      });
    }
  } catch (error) {
    console.error("更新账单异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 删除账单
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  // 验证ID格式
  if (!id || isNaN(id)) {
    return res.status(400).json({
      code: 400,
      message: "无效的账单ID"
    });
  }

  try {
    // 首先验证账单是否存在且属于当前用户
    const { data: existingBill, error: checkError } = await supabase
      .from("bills")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .single();

    if (checkError || !existingBill) {
      return res.status(404).json({
        code: 404,
        message: "账单不存在或无权限访问"
      });
    }

    // 删除账单
    const { error } = await supabase
      .from("bills")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.userId);

    if (error) {
      console.error("删除账单错误:", error);
      return res.status(500).json({
        code: 500,
        message: "删除账单失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "账单删除成功"
    });
  } catch (error) {
    console.error("删除账单异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

module.exports = router;