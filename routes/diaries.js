const express = require('express');
const router = express.Router();

// 获取富文本内容列表
router.get('/diaries', async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get('supabase');
  } catch (err) {
    console.error('获取Supabase客户端错误:', err);
    return res.status(500).json({ 
      code: 500, 
      message: "服务器配置错误",
      data: null
    });
  }
  
  if (!supabase) {
    return res.status(500).json({ 
      code: 500, 
      message: "数据库连接未初始化",
      data: null
    });
  }

  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');

  const { page = 1, limit = 10, type } = req.query;
  const offset = (page - 1) * limit;

  try {
    // 检查diaries表是否存在
    const { error: tableError } = await supabase
      .from('diaries')
      .select('id')
      .limit(1);

    if (tableError) {
      console.error('Diaries表访问错误:', tableError);
      return res.status(500).json({ 
        code: 500, 
        message: "数据库表访问失败",
        data: null,
        error: tableError.message
      });
    }

    let query = supabase
      .from('diaries')
      .select(`
        id, title, type, content, created_at, updated_at
      `, { count: 'exact' })
      .range(offset, offset + parseInt(limit) - 1)
      .order('created_at', { ascending: false });

    // 根据类型筛选
    if (type) {
      query = query.eq('type', type);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error('获取日记列表错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取日记列表失败",
        data: null,
        error: error.message
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
          totalPages: Math.ceil((count || 0) / limit)
        }
      }
    });
  } catch (error) {
    console.error("获取日记列表异常:", error.message);
    console.error("错误堆栈:", error.stack);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null,
      error: error.message
    });
  }
});

// 获取统计信息
router.get('/diaries/stats', async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get('supabase');
  } catch (err) {
    console.error('获取Supabase客户端错误:', err);
    return res.status(500).json({ 
      code: 500, 
      message: "服务器配置错误",
      data: null
    });
  }
  
  if (!supabase) {
    return res.status(500).json({ 
      code: 500, 
      message: "数据库连接未初始化",
      data: null
    });
  }

  try {
    // 获取总记录数和总字数
    const { data: allDiaries, error: allDiariesError } = await supabase
      .from('diaries')
      .select('content, type');

    if (allDiariesError) {
      console.error('获取日记统计信息错误:', allDiariesError);
      return res.status(500).json({ 
        code: 500, 
        message: "获取日记统计信息失败",
        data: null,
        error: allDiariesError.message
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
    allDiaries.forEach(diary => {
      if (diary.type) {
        if (!typeStats[diary.type]) {
          typeStats[diary.type] = { count: 0, characters: 0 };
        }
        typeStats[diary.type].count += 1;
        typeStats[diary.type].characters += diary.content ? diary.content.length : 0;
      }
    });

    res.status(200).json({
      code: 200,
      message: "获取统计信息成功",
      data: {
        totalRecords,
        totalCharacters,
        typeStats
      }
    });
  } catch (error) {
    console.error("获取统计信息异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null,
      error: error.message
    });
  }
});

// 获取单篇富文本内容
router.get('/diaries/:id', async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get('supabase');
  } catch (err) {
    console.error('获取Supabase客户端错误:', err);
    return res.status(500).json({ 
      code: 500, 
      message: "服务器配置错误",
      data: null
    });
  }
  
  if (!supabase) {
    return res.status(500).json({ 
      code: 500, 
      message: "数据库连接未初始化",
      data: null
    });
  }

  const { id } = req.params;

  // 检查ID是否为空
  if (!id) {
    return res.status(400).json({
      code: 400,
      message: "无效的ID",
      data: null
    });
  }

  try {
    const { data, error } = await supabase
      .from('diaries')
      .select(`
        id, title, type, content, created_at, updated_at
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('获取日记详情错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取日记详情失败",
        data: null,
        error: error.message
      });
    }

    if (!data) {
      return res.status(404).json({
        code: 404,
        message: "未找到指定的日记",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取日记详情成功",
      data: data
    });
  } catch (error) {
    console.error("获取日记详情异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null,
      error: error.message
    });
  }
});

// 创建新的富文本内容
router.post('/diaries', async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get('supabase');
  } catch (err) {
    console.error('获取Supabase客户端错误:', err);
    return res.status(500).json({ 
      code: 500, 
      message: "服务器配置错误",
      data: null
    });
  }
  
  if (!supabase) {
    return res.status(500).json({ 
      code: 500, 
      message: "数据库连接未初始化",
      data: null
    });
  }

  const { title, type, content } = req.body;

  // 验证必填字段
  if (!title || !type || !content) {
    return res.status(400).json({
      code: 400,
      message: "标题、类型和内容不能为空",
      data: null
    });
  }

  try {
    const { data, error } = await supabase
      .from('diaries')
      .insert([
        {
          title,
          type,
          content,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('创建日记错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "创建日记失败",
        data: null,
        error: error.message
      });
    }

    res.status(201).json({
      code: 201,
      message: "日记创建成功",
      data: data
    });
  } catch (error) {
    console.error("创建日记异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null,
      error: error.message
    });
  }
});

// 更新富文本内容
router.put('/diaries/:id', async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get('supabase');
  } catch (err) {
    console.error('获取Supabase客户端错误:', err);
    return res.status(500).json({ 
      code: 500, 
      message: "服务器配置错误",
      data: null
    });
  }
  
  if (!supabase) {
    return res.status(500).json({ 
      code: 500, 
      message: "数据库连接未初始化",
      data: null
    });
  }

  const { id } = req.params;
  const { title, type, content } = req.body;

  // 检查ID是否为空
  if (!id) {
    return res.status(400).json({
      code: 400,
      message: "无效的ID",
      data: null
    });
  }

  // 验证至少有一个要更新的字段
  if (!title && !type && !content) {
    return res.status(400).json({
      code: 400,
      message: "至少提供一个要更新的字段（标题、类型或内容）",
      data: null
    });
  }

  try {
    const updates = {};
    if (title) updates.title = title;
    if (type) updates.type = type;
    if (content) updates.content = content;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('diaries')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('更新日记错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "更新日记失败",
        data: null,
        error: error.message
      });
    }

    if (!data) {
      return res.status(404).json({
        code: 404,
        message: "未找到指定的日记",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "日记更新成功",
      data: data
    });
  } catch (error) {
    console.error("更新日记异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null,
      error: error.message
    });
  }
});

// 删除富文本内容
router.delete('/diaries/:id', async (req, res) => {
  let supabase;
  try {
    supabase = req.app.get('supabase');
  } catch (err) {
    console.error('获取Supabase客户端错误:', err);
    return res.status(500).json({ 
      code: 500, 
      message: "服务器配置错误",
      data: null
    });
  }
  
  if (!supabase) {
    return res.status(500).json({ 
      code: 500, 
      message: "数据库连接未初始化",
      data: null
    });
  }

  const { id } = req.params;

  // 检查ID是否为空
  if (!id) {
    return res.status(400).json({
      code: 400,
      message: "无效的ID",
      data: null
    });
  }

  try {
    const { data, error } = await supabase
      .from('diaries')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('删除日记错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "删除日记失败",
        data: null,
        error: error.message
      });
    }

    if (!data) {
      return res.status(404).json({
        code: 404,
        message: "未找到指定的日记",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "日记删除成功",
      data: data
    });
  } catch (error) {
    console.error("删除日记异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null,
      error: error.message
    });
  }
});

module.exports = router;