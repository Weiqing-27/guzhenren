const express = require("express");
const router = express.Router();

// 获取账单列表
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
        count: count,
        next: hasNext ? `/api/anyu/bills/?page=${parseInt(page) + 1}&page_size=${page_size}` : null,
        previous: hasPrevious ? `/api/anyu/bills/?page=${parseInt(page) - 1}&page_size=${page_size}` : null,
        results: data || []
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

  // 验证必填字段
  if (!amount || !type || !category_id) {
    return res.status(400).json({
      code: 400,
      message: "金额、类型和分类ID不能为空"
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
    const billData = {
      amount: parseFloat(amount),
      type,
      category_id: parseInt(category_id),
      description: description || '',
      date: date || new Date().toISOString().split('T')[0]
    };

    const { data, error } = await supabase
      .from("bills")
      .insert([billData])
      .select(`
        id,
        amount,
        type,
        description,
        date,
        created_at,
        category:categories(id, name)
      `);

    if (error) {
      console.error("创建账单错误:", error);
      return res.status(500).json({
        code: 500,
        message: "创建账单失败",
        error: error.message
      });
    }

    res.status(201).json({
      code: 201,
      message: "账单创建成功",
      data: data[0]
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
        updated_at,
        category:categories(id, name, icon)
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error("获取账单详情错误:", error);
      return res.status(404).json({
        code: 404,
        message: "账单不存在",
        error: error.message
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
    const updateData = {};
    
    if (amount !== undefined) {
      if (isNaN(amount) || parseFloat(amount) <= 0) {
        return res.status(400).json({
          code: 400,
          message: "金额必须是大于0的数字"
        });
      }
      updateData.amount = parseFloat(amount);
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

    const { data, error } = await supabase
      .from("bills")
      .update(updateData)
      .eq('id', id)
      .select(`
        id,
        amount,
        type,
        description,
        date,
        updated_at,
        category:categories(id, name, icon)
      `);

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
    const { error } = await supabase
      .from("bills")
      .delete()
      .eq('id', id);

    if (error) {
      console.error("删除账单错误:", error);
      return res.status(500).json({
        code: 500,
        message: "删除账单失败",
        error: error.message
      });
    }

    res.status(204).json({
      code: 204,
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