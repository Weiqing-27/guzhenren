const express = require("express");
const { authenticate } = require('../../middleware/auth');
const router = express.Router();

// 应用认证中间件到所有路由
router.use(authenticate);

// 获取分类列表 - 只返回当前用户的数据和默认分类
router.get("/", async (req, res) => {
  const supabase = req.app.get('supabase');
  const { type } = req.query;

  try {
    // 查询当前用户的分类和默认分类
    let query = supabase
      .from("categories")
      .select(`
        id,
        name,
        type,
        icon,
        color,
        is_default,
        created_at
      `)
      .or(`user_id.eq.${req.user.userId},user_id.is.null`)  // 查询当前用户或默认分类
      .order('created_at', { ascending: true });

    // 如果指定了类型，添加过滤条件
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
      data: data || []
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
      message: "名称和类型都是必填项"
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
    // 检查同名分类是否已存在（同一用户下）
    const { data: existingCategory, error: checkError } = await supabase
      .from("categories")
      .select("id")
      .eq("name", name)
      .eq("user_id", req.user.userId)
      .eq("type", type);

    if (checkError) {
      console.error("检查分类存在性错误:", checkError);
      return res.status(500).json({
        code: 500,
        message: "检查分类失败",
        error: checkError.message
      });
    }

    if (existingCategory && existingCategory.length > 0) {
      return res.status(400).json({
        code: 400,
        message: "该类型的分类名称已存在"
      });
    }

    // 创建分类
    const { data, error } = await supabase
      .from("categories")
      .insert([{
        name,
        type,
        icon: icon || 'default',
        color: color || '#000000',
        is_default: false,
        user_id: req.user.userId // 关联当前用户
      }])
      .select()
      .single();

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
      data: data
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

  try {
    // 首先验证分类是否存在且属于当前用户
    const { data: existingCategory, error: checkError } = await supabase
      .from("categories")
      .select("id, user_id, is_default")
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .single();

    if (checkError || !existingCategory) {
      return res.status(404).json({
        code: 404,
        message: "分类不存在或无权限访问"
      });
    }

    // 不允许修改默认分类
    if (existingCategory.is_default) {
      return res.status(400).json({
        code: 400,
        message: "不能修改默认分类"
      });
    }

    // 准备更新数据
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;

    // 如果要更新名称，检查是否与其他分类重复
    if (name !== undefined) {
      const { data: duplicateCategory, error: duplicateCheck } = await supabase
        .from("categories")
        .select("id")
        .eq("name", name)
        .eq("user_id", req.user.userId)
        .neq("id", id);

      if (duplicateCheck) {
        console.error("检查分类名称重复错误:", duplicateCheck);
        return res.status(500).json({
          code: 500,
          message: "检查分类名称失败",
          error: duplicateCheck.message
        });
      }

      if (duplicateCategory && duplicateCategory.length > 0) {
        return res.status(400).json({
          code: 400,
          message: "该分类名称已存在"
        });
      }
    }

    // 更新分类
    const { data, error } = await supabase
      .from("categories")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .select()
      .single();

    if (error) {
      console.error("更新分类错误:", error);
      return res.status(500).json({
        code: 500,
        message: "更新分类失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "分类更新成功",
      data: data
    });
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

  try {
    // 首先验证分类是否存在且属于当前用户
    const { data: existingCategory, error: checkError } = await supabase
      .from("categories")
      .select("id, user_id, is_default")
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .single();

    if (checkError || !existingCategory) {
      return res.status(404).json({
        code: 404,
        message: "分类不存在或无权限访问"
      });
    }

    // 不允许删除默认分类
    if (existingCategory.is_default) {
      return res.status(400).json({
        code: 400,
        message: "不能删除默认分类"
      });
    }

    // 检查是否有账单关联此分类
    const { data: relatedBills, error: billCheck } = await supabase
      .from("bills")
      .select("id")
      .eq("category_id", id)
      .eq("user_id", req.user.userId)
      .limit(1);

    if (billCheck) {
      console.error("检查关联账单错误:", billCheck);
      return res.status(500).json({
        code: 500,
        message: "检查关联账单失败",
        error: billCheck.message
      });
    }

    if (relatedBills && relatedBills.length > 0) {
      return res.status(400).json({
        code: 400,
        message: "该分类下有关联的账单，无法删除"
      });
    }

    // 删除分类
    const { error } = await supabase
      .from("categories")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.userId);

    if (error) {
      console.error("删除分类错误:", error);
      return res.status(500).json({
        code: 500,
        message: "删除分类失败",
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
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