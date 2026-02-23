const express = require("express");
const router = express.Router();

// 获取分类列表
router.get("/", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { type } = req.query;

  try {
    let query = supabase
      .from("categories")
      .select("*")
      .order('name');

    // 根据类型过滤
    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;

    if (error) {
      console.error("获取分类列表错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取分类列表失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取分类列表成功",
      data: {
        results: data || []
      }
    });
  } catch (error) {
    console.error("获取分类列表异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 创建分类
router.post("/", async (req, res) => {
  const { name, type, icon, color } = req.body;
  const supabase = req.app.get('supabase');

  // 验证必填字段
  if (!name || !type) {
    return res.status(400).json({
      code: 400,
      message: "分类名称和类型不能为空"
    });
  }

  // 验证类型
  if (!['income', 'outcome'].includes(type)) {
    return res.status(400).json({
      code: 400,
      message: "类型必须是 income 或 outcome"
    });
  }

  // 验证颜色格式
  if (color && !/^#[0-9A-F]{6}$/i.test(color)) {
    return res.status(400).json({
      code: 400,
      message: "颜色格式不正确，应为 #RRGGBB 格式"
    });
  }

  try {
    const categoryData = {
      name,
      type,
      icon: icon || 'default',
      color: color || '#000000',
      is_default: false
    };

    const { data, error } = await supabase
      .from("categories")
      .insert([categoryData])
      .select("*");

    if (error) {
      console.error("创建分类错误:", error);
      return res.status(500).json({
        code: 500,
        message: "创建分类失败",
        error: error.message
      });
    }

    res.status(201).json({
      code: 201,
      message: "分类创建成功",
      data: data[0]
    });
  } catch (error) {
    console.error("创建分类异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 更新分类
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, icon, color } = req.body;
  const supabase = req.app.get('supabase');

  // 验证ID格式
  if (!id || isNaN(id)) {
    return res.status(400).json({
      code: 400,
      message: "无效的分类ID"
    });
  }

  // 验证颜色格式
  if (color && !/^#[0-9A-F]{6}$/i.test(color)) {
    return res.status(400).json({
      code: 400,
      message: "颜色格式不正确，应为 #RRGGBB 格式"
    });
  }

  try {
    const updateData = {};
    
    if (name !== undefined) {
      updateData.name = name;
    }
    
    if (icon !== undefined) {
      updateData.icon = icon;
    }
    
    if (color !== undefined) {
      updateData.color = color;
    }

    const { data, error } = await supabase
      .from("categories")
      .update(updateData)
      .eq('id', id)
      .select("*");

    if (error) {
      console.error("更新分类错误:", error);
      return res.status(500).json({
        code: 500,
        message: "更新分类失败",
        error: error.message
      });
    }

    if (data && data.length > 0) {
      res.status(200).json({
        code: 200,
        message: "分类更新成功",
        data: data[0]
      });
    } else {
      res.status(404).json({
        code: 404,
        message: "分类不存在"
      });
    }
  } catch (error) {
    console.error("更新分类异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

// 删除分类
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const supabase = req.app.get('supabase');

  // 验证ID格式
  if (!id || isNaN(id)) {
    return res.status(400).json({
      code: 400,
      message: "无效的分类ID"
    });
  }

  try {
    // 检查是否是系统默认分类
    const { data: category, error: checkError } = await supabase
      .from("categories")
      .select("is_default")
      .eq('id', id)
      .single();

    if (checkError) {
      console.error("检查分类错误:", checkError);
      return res.status(500).json({
        code: 500,
        message: "检查分类失败",
        error: checkError.message
      });
    }

    if (category.is_default) {
      return res.status(400).json({
        code: 400,
        message: "不能删除系统默认分类"
      });
    }

    // 检查是否有账单使用此分类
    const { data: bills, error: billCheckError } = await supabase
      .from("bills")
      .select("id")
      .eq('category_id', id)
      .limit(1);

    if (billCheckError) {
      console.error("检查账单关联错误:", billCheckError);
      return res.status(500).json({
        code: 500,
        message: "检查账单关联失败",
        error: billCheckError.message
      });
    }

    if (bills && bills.length > 0) {
      return res.status(400).json({
        code: 400,
        message: "该分类已被账单使用，无法删除"
      });
    }

    // 执行删除
    const { error } = await supabase
      .from("categories")
      .delete()
      .eq('id', id);

    if (error) {
      console.error("删除分类错误:", error);
      return res.status(500).json({
        code: 500,
        message: "删除分类失败",
        error: error.message
      });
    }

    res.status(204).json({
      code: 204,
      message: "分类删除成功"
    });
  } catch (error) {
    console.error("删除分类异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

module.exports = router;