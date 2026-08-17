const express = require("express");
const router = express.Router();
const XLSX = require("xlsx");

/**
 * 【功能描述】
 * 分页获取日记（富文本）列表，支持按 type 筛选。
 *
 * 【业务逻辑】
 * 1. 从 app 获取 Supabase 客户端并校验可用性。
 * 2. 解析 page、limit、type 查询参数，计算 offset。
 * 3. 探测 diaries 表可访问性，构建分页查询并按 created_at 倒序。
 * 4. 返回日记列表及 pagination 元数据；网络异常时给出友好提示。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().range().order、count exact
 * - 涉及知识点：Supabase 分页、表存在性探测、fetch failed 错误识别
 */
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

/**
 * 【功能描述】
 * 获取日记汇总统计：总条数、总字数及按 type 分组统计。
 *
 * 【业务逻辑】
 * 1. 校验 Supabase 客户端可用。
 * 2. 全量查询 diaries 的 content、type 字段。
 * 3. 内存计算 totalRecords、totalCharacters 及 typeStats 聚合。
 * 4. 返回统计结果。
 *
 * 【技术实现】
 * - 涉及方法：router.get、Array.reduce、forEach 聚合
 * - 涉及知识点：全表扫描统计、客户端内存聚合
 */
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

/**
 * 【功能描述】
 * 根据 ID 获取单篇日记详情。
 *
 * 【业务逻辑】
 * 1. 校验 Supabase 客户端及路径 id 非空。
 * 2. 按 id 查询 diaries 表单条记录。
 * 3. 无数据返回 404，否则返回完整日记字段。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().eq().single
 * - 涉及知识点：REST 资源详情、Supabase single 查询
 */
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

/**
 * 【功能描述】
 * 创建一篇新日记（富文本内容）。
 *
 * 【业务逻辑】
 * 1. 校验 Supabase 客户端可用。
 * 2. 校验 title、type、content 必填。
 * 3. 插入 diaries 表并设置 created_at、updated_at 为当前 ISO 时间。
 * 4. 返回 201 及新创建记录。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().single
 * - 涉及知识点：请求体验证、ISO 8601 时间戳
 */
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

/**
 * 【功能描述】
 * 部分更新指定 ID 的日记字段（title、type、content）。
 *
 * 【业务逻辑】
 * 1. 校验 id 非空，且至少提供一个待更新字段。
 * 2. 动态构建 updates 对象，始终刷新 updated_at。
 * 3. 按 id 执行 update；无匹配行返回 404。
 *
 * 【技术实现】
 * - 涉及方法：router.put、supabase.from().update().eq().single
 * - 涉及知识点：PATCH 式部分更新、动态 update 对象
 */
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

/**
 * 【功能描述】
 * 根据 ID 删除一篇日记。
 *
 * 【业务逻辑】
 * 1. 校验 id 非空及 Supabase 可用。
 * 2. 按 id 执行 delete 并 select 返回被删行。
 * 3. 无匹配记录返回 404，否则返回删除成功的数据。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.from().delete().select().single
 * - 涉及知识点：删除并返回行、404 判定
 */
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

/**
 * 【功能描述】
 * 从 Base64 编码的 Excel 文件批量导入日记（日报类型）。
 *
 * 【业务逻辑】
 * 1. 校验 fileData（Base64）存在。
 * 2. 用 XLSX 解析首个工作表，定位「日期」「工作内容」列（或默认第 0、1 列）。
 * 3. 过滤有效行，映射为 title（日期）、type=2、content 字段。
 * 4. 批量 insert 至 diaries 表并返回导入条数。
 *
 * 【技术实现】
 * - 涉及方法：router.post、XLSX.read、sheet_to_json、supabase.from().insert
 * - 涉及知识点：Base64 Excel 解析、列名自动识别、批量插入
 */
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
      type: "2", // 默认类型为日报
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
