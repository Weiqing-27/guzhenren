const express = require("express");
const router = express.Router();
const XLSX = require("xlsx");

// 获取富文本内容列表
router.get("/diaries", async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get("supabase");
  } catch (err) {
    console.error("获取Supabase客户端错误:", err);
    return res.status(500).json({
      code: 500,
      message: "服务器配置错误",
      data: null,
    });
  }

  if (!supabase) {
    return res.status(500).json({
      code: 500,
      message: "数据库连接未初始化",
      data: null,
    });
  }

  const { page = 1, limit = 10, type } = req.query;
  const offset = (page - 1) * limit;

  try {
    // 检查diaries表是否存在
    const { error: tableError } = await supabase
      .from("diaries")
      .select("id")
      .limit(1);

    if (tableError) {
      console.error("Diaries表访问错误:", tableError);
      // 添加更详细的错误信息
      return res.status(500).json({
        code: 500,
        message: "数据库表访问失败",
        data: null,
        error: tableError.message,
        details: tableError.details || null,
      });
    }

    let query = supabase
      .from("diaries")
      .select(
        `
        id, title, type, content, created_at, updated_at
      `,
        { count: "exact" }
      )
      .range(offset, offset + parseInt(limit) - 1)
      .order("created_at", { ascending: false });

    // 根据类型筛选
    if (type) {
      query = query.eq("type", type);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error("获取日记列表错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取日记列表失败",
        data: null,
        error: error.message,
        details: error.details || null,
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取日记列表成功",
      data: {
        diaries: data || [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
      },
    });
  } catch (error) {
    console.error("获取日记列表异常:", error.message);
    console.error("错误堆栈:", error.stack);

    // 添加更详细的网络错误处理
    if (error.message.includes("fetch failed")) {
      return res.status(500).json({
        code: 500,
        message: "网络连接失败，请检查网络设置或稍后重试",
        data: null,
        error: error.message,
        hint: "这可能是由于网络连接问题或Supabase服务暂时不可用导致的",
      });
    }

    res.status(500).json({
      code: 500,
      message: "服务器错误",
      data: null,
      error: error.message,
    });
  }
});

// 获取统计信息
router.get("/diaries/stats", async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get("supabase");
  } catch (err) {
    console.error("获取Supabase客户端错误:", err);
    return res.status(500).json({
      code: 500,
      message: "服务器配置错误",
      data: null,
    });
  }

  if (!supabase) {
    return res.status(500).json({
      code: 500,
      message: "数据库连接未初始化",
      data: null,
    });
  }

  try {
    // 获取总记录数和总字数
    const { data: allDiaries, error: allDiariesError } = await supabase
      .from("diaries")
      .select("content, type");

    if (allDiariesError) {
      console.error("获取日记统计信息错误:", allDiariesError);
      // 添加更详细的错误处理
      return res.status(500).json({
        code: 500,
        message: "获取日记统计信息失败",
        data: null,
        error: allDiariesError.message,
        details: allDiariesError.details || null,
      });
    }

    // 计算总记录数
    const totalRecords = allDiaries.length;

    // 计算总字数
    const totalCharacters = allDiaries.reduce((total, diary) => {
      return total + (diary.content ? diary.content.length : 0);
    }, 0);

    // 按类型统计
    const typeStats = {};
    allDiaries.forEach((diary) => {
      if (diary.type) {
        if (!typeStats[diary.type]) {
          typeStats[diary.type] = { count: 0, characters: 0 };
        }
        typeStats[diary.type].count += 1;
        typeStats[diary.type].characters += diary.content
          ? diary.content.length
          : 0;
      }
    });

    res.status(200).json({
      code: 200,
      message: "获取统计信息成功",
      data: {
        totalRecords,
        totalCharacters,
        typeStats,
      },
    });
  } catch (error) {
    console.error("获取统计信息异常:", error.message);

    // 添加更详细的网络错误处理
    if (error.message.includes("fetch failed")) {
      return res.status(500).json({
        code: 500,
        message: "网络连接失败，请检查网络设置或稍后重试",
        data: null,
        error: error.message,
        hint: "这可能是由于网络连接问题或Supabase服务暂时不可用导致的",
      });
    }

    res.status(500).json({
      code: 500,
      message: "服务器错误",
      data: null,
      error: error.message,
    });
  }
});

// 获取单篇富文本内容
router.get("/diaries/:id", async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get("supabase");
  } catch (err) {
    console.error("获取Supabase客户端错误:", err);
    return res.status(500).json({
      code: 500,
      message: "服务器配置错误",
      data: null,
    });
  }

  if (!supabase) {
    return res.status(500).json({
      code: 500,
      message: "数据库连接未初始化",
      data: null,
    });
  }

  const { id } = req.params;

  // 检查ID是否为空
  if (!id) {
    return res.status(400).json({
      code: 400,
      message: "无效的ID",
      data: null,
    });
  }

  try {
    const { data, error } = await supabase
      .from("diaries")
      .select(
        `
        id, title, type, content, created_at, updated_at
      `
      )
      .eq("id", id)
      .single();

    if (error) {
      console.error("获取日记详情错误:", error);
      return res.status(500).json({
        code: 500,
        message: "获取日记详情失败",
        data: null,
        error: error.message,
        details: error.details || null,
      });
    }

    if (!data) {
      return res.status(404).json({
        code: 404,
        message: "未找到指定的日记",
        data: null,
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取日记详情成功",
      data: data,
    });
  } catch (error) {
    console.error("获取日记详情异常:", error.message);

    // 添加更详细的网络错误处理
    if (error.message.includes("fetch failed")) {
      return res.status(500).json({
        code: 500,
        message: "网络连接失败，请检查网络设置或稍后重试",
        data: null,
        error: error.message,
        hint: "这可能是由于网络连接问题或Supabase服务暂时不可用导致的",
      });
    }

    res.status(500).json({
      code: 500,
      message: "服务器错误",
      data: null,
      error: error.message,
    });
  }
});

// 创建新的富文本内容
router.post("/diaries", async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get("supabase");
  } catch (err) {
    console.error("获取Supabase客户端错误:", err);
    return res.status(500).json({
      code: 500,
      message: "服务器配置错误",
      data: null,
    });
  }

  if (!supabase) {
    return res.status(500).json({
      code: 500,
      message: "数据库连接未初始化",
      data: null,
    });
  }

  const { title, type, content } = req.body;

  // 验证必填字段
  if (!title || !type || !content) {
    return res.status(400).json({
      code: 400,
      message: "标题、类型和内容不能为空",
      data: null,
    });
  }

  try {
    const { data, error } = await supabase
      .from("diaries")
      .insert([
        {
          title,
          type,
          content,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("创建日记错误:", error);
      return res.status(500).json({
        code: 500,
        message: "创建日记失败",
        data: null,
        error: error.message,
        details: error.details || null,
      });
    }

    res.status(201).json({
      code: 201,
      message: "日记创建成功",
      data: data,
    });
  } catch (error) {
    console.error("创建日记异常:", error.message);

    // 添加更详细的网络错误处理
    if (error.message.includes("fetch failed")) {
      return res.status(500).json({
        code: 500,
        message: "网络连接失败，请检查网络设置或稍后重试",
        data: null,
        error: error.message,
        hint: "这可能是由于网络连接问题或Supabase服务暂时不可用导致的",
      });
    }

    res.status(500).json({
      code: 500,
      message: "服务器错误",
      data: null,
      error: error.message,
    });
  }
});

// 更新富文本内容
router.put("/diaries/:id", async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get("supabase");
  } catch (err) {
    console.error("获取Supabase客户端错误:", err);
    return res.status(500).json({
      code: 500,
      message: "服务器配置错误",
      data: null,
    });
  }

  if (!supabase) {
    return res.status(500).json({
      code: 500,
      message: "数据库连接未初始化",
      data: null,
    });
  }

  const { id } = req.params;
  const { title, type, content } = req.body;

  // 检查ID是否为空
  if (!id) {
    return res.status(400).json({
      code: 400,
      message: "无效的ID",
      data: null,
    });
  }

  // 验证至少有一个要更新的字段
  if (!title && !type && !content) {
    return res.status(400).json({
      code: 400,
      message: "至少提供一个要更新的字段（标题、类型或内容）",
      data: null,
    });
  }

  try {
    const updates = {};
    if (title) updates.title = title;
    if (type) updates.type = type;
    if (content) updates.content = content;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("diaries")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("更新日记错误:", error);
      return res.status(500).json({
        code: 500,
        message: "更新日记失败",
        data: null,
        error: error.message,
        details: error.details || null,
      });
    }

    if (!data) {
      return res.status(404).json({
        code: 404,
        message: "未找到指定的日记",
        data: null,
      });
    }

    res.status(200).json({
      code: 200,
      message: "日记更新成功",
      data: data,
    });
  } catch (error) {
    console.error("更新日记异常:", error.message);

    // 添加更详细的网络错误处理
    if (error.message.includes("fetch failed")) {
      return res.status(500).json({
        code: 500,
        message: "网络连接失败，请检查网络设置或稍后重试",
        data: null,
        error: error.message,
        hint: "这可能是由于网络连接问题或Supabase服务暂时不可用导致的",
      });
    }

    res.status(500).json({
      code: 500,
      message: "服务器错误",
      data: null,
      error: error.message,
    });
  }
});

// 删除富文本内容
router.delete("/diaries/:id", async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get("supabase");
  } catch (err) {
    console.error("获取Supabase客户端错误:", err);
    return res.status(500).json({
      code: 500,
      message: "服务器配置错误",
      data: null,
    });
  }

  if (!supabase) {
    return res.status(500).json({
      code: 500,
      message: "数据库连接未初始化",
      data: null,
    });
  }

  const { id } = req.params;

  // 检查ID是否为空
  if (!id) {
    return res.status(400).json({
      code: 400,
      message: "无效的ID",
      data: null,
    });
  }

  try {
    const { data, error } = await supabase
      .from("diaries")
      .delete()
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("删除日记错误:", error);
      return res.status(500).json({
        code: 500,
        message: "删除日记失败",
        data: null,
        error: error.message,
        details: error.details || null,
      });
    }

    if (!data) {
      return res.status(404).json({
        code: 404,
        message: "未找到指定的日记",
        data: null,
      });
    }

    res.status(200).json({
      code: 200,
      message: "日记删除成功",
      data: data,
    });
  } catch (error) {
    console.error("删除日记异常:", error.message);

    // 添加更详细的网络错误处理
    if (error.message.includes("fetch failed")) {
      return res.status(500).json({
        code: 500,
        message: "网络连接失败，请检查网络设置或稍后重试",
        data: null,
        error: error.message,
        hint: "这可能是由于网络连接问题或Supabase服务暂时不可用导致的",
      });
    }

    res.status(500).json({
      code: 500,
      message: "服务器错误",
      data: null,
      error: error.message,
    });
  }
});

router.post("/diaries/import-excel", async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get("supabase");
  } catch (err) {
    console.error("获取Supabase客户端错误:", err);
    return res
      .status(500)
      .json({ code: 500, message: "服务器配置错误", data: null });
  }

  if (!supabase) {
    return res
      .status(500)
      .json({ code: 500, message: "数据库连接未初始化", data: null });
  }

  const { fileData } = req.body;

  // 验证输入数据
  if (!fileData) {
    return res.status(400).json({
      code: 400,
      message: "请提供Excel文件数据",
      data: null
    });
  }

  try {
    // 从Base64字符串读取Excel文件
    const workbook = XLSX.read(fileData, { type: 'base64' });

    // 获取第一个工作表
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // 将工作表转换为JSON
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // 验证数据格式（至少应该有标题行和一行数据）
    if (!jsonData || jsonData.length < 2) {
      return res.status(400).json({
        code: 400,
        message: "Excel文件中没有足够的数据",
        data: null,
      });
    }

    // 解析数据，假定第一行是标题（日期，工作内容）
    const headers = jsonData[0];
    let dateColumnIndex = -1;
    let contentColumnIndex = -1;

    // 查找"日期"和"工作内容"列
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === "日期") {
        dateColumnIndex = i;
      } else if (headers[i] === "工作内容") {
        contentColumnIndex = i;
      }
    }

    // 如果没找到对应的列，则默认第一列是日期，第二列是工作内容
    if (dateColumnIndex === -1) dateColumnIndex = 0;
    if (contentColumnIndex === -1) contentColumnIndex = 1;

    // 准备要插入的数据
    const entries = [];
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (row[dateColumnIndex] && row[contentColumnIndex]) {
        entries.push({
          date: row[dateColumnIndex],
          content: row[contentColumnIndex],
        });
      }
    }

    if (entries.length === 0) {
      return res.status(400).json({
        code: 400,
        message: "Excel文件中没有有效数据",
        data: null,
      });
    }

    // 准备要插入到数据库的数据
    const diariesToInsert = entries.map((entry) => ({
      title:
        typeof entry.date === "string"
          ? entry.date
          : new Date(entry.date).toLocaleDateString("zh-CN"),
      type: "daily_report", // 默认类型为日报
      content: entry.content,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    // 批量插入数据到数据库
    const { data, error } = await supabase
      .from("diaries")
      .insert(diariesToInsert)
      .select();

    if (error) {
      console.error("导入日记错误:", error);
      return res.status(500).json({
        code: 500,
        message: "导入日记失败",
        data: null,
        error: error.message,
      });
    }

    res.status(201).json({
      code: 201,
      message: `成功导入${data.length}条日记`,
      data: data,
    });
  } catch (error) {
    console.error("导入日记异常:", error.message);
    res
      .status(500)
      .json({
        code: 500,
        message: "服务器错误或Excel文件解析错误",
        data: null,
        error: error.message,
      });
  }
});

module.exports = router;
