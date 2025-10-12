const express = require('express');
const router = express.Router();

// 内容相关路由
// GET /api/blog/posts - 获取记录列表（支持分页、筛选）
router.get('/posts', async (req, res) => {
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

  const { page = 1, limit = 10, type, status, is_private } = req.query;
  const offset = (page - 1) * limit;

  try {
    // 先检查posts表是否存在
    const { error: tableError } = await supabase
      .from('posts')
      .select('id')
      .limit(1);

    if (tableError) {
      console.error('Posts表访问错误:', tableError);
      return res.status(500).json({ 
        code: 500, 
        message: "数据库表访问失败",
        data: null,
        error: tableError.message
      });
    }

    let query = supabase
      .from('posts')
      .select(`
        id, title, excerpt, type, status, is_private, 
        created_at, updated_at
      `, { count: 'exact' })
      .range(offset, offset + parseInt(limit) - 1)
      .order('created_at', { ascending: false });

    // 应用筛选条件
    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);
    if (is_private !== undefined) query = query.eq('is_private', is_private === 'true');

    const { data, count, error } = await query;

    if (error) {
      console.error('获取文章列表错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取文章列表失败",
        data: null,
        error: error.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取文章列表成功",
      data: {
        posts: data || [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      }
    });
  } catch (error) {
    console.error("获取文章列表异常:", error.message);
    console.error("错误堆栈:", error.stack);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null,
      error: error.message
    });
  }
});

// GET /api/blog/posts/:id - 获取单条记录
router.get('/posts/:id', async (req, res) => {
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

  try {
    // 验证ID格式
    if (!id) {
      return res.status(400).json({ 
        code: 400, 
        message: "文章ID不能为空",
        data: null
      });
    }

    const { data: post, error } = await supabase
      .from('posts')
      .select(`
        id, title, content, excerpt, type, status, is_private, 
        created_at, updated_at
      `)
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116表示没有找到记录
      console.error('获取文章详情错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取文章详情失败",
        data: null,
        error: error.message
      });
    }

    if (!post) {
      return res.status(404).json({ 
        code: 404, 
        message: "文章不存在",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取文章详情成功",
      data: post
    });
  } catch (error) {
    console.error("获取文章详情异常:", error.message);
    console.error("错误堆栈:", error.stack);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null,
      error: error.message
    });
  }
});

// POST /api/blog/posts - 创建记录
router.post('/posts', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { title, content, excerpt, type, status, is_private } = req.body;

  // 使用默认的 user_id，因为表结构要求此字段且有外键约束
  const defaultUserId = '00000000-0000-0000-0000-000000000000';

  try {
    const { data: post, error } = await supabase
      .from('posts')
      .insert([
        {
          user_id: defaultUserId, // 添加默认user_id以满足外键约束
          title,
          content,
          excerpt: excerpt || '',
          type: type || 'technical',
          status: status || 'draft',
          is_private: is_private !== undefined ? is_private : true
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('创建文章错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "创建文章失败",
        data: null
      });
    }

    res.status(201).json({
      code: 201,
      message: "创建文章成功",
      data: post
    });
  } catch (error) {
    console.error("创建文章异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// PUT /api/blog/posts/:id - 更新记录
router.put('/posts/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;
  const { title, content, excerpt, type, status, is_private } = req.body;

  try {
    // 检查文章是否存在
    const { data: existingPost, error: checkError } = await supabase
      .from('posts')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existingPost) {
      return res.status(404).json({ 
        code: 404, 
        message: "文章不存在",
        data: null
      });
    }

    // 更新文章
    const { data: post, error } = await supabase
      .from('posts')
      .update({
        title,
        content,
        excerpt: excerpt || '',
        type,
        status,
        is_private,
        updated_at: new Date()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('更新文章错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "更新文章失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "更新文章成功",
      data: post
    });
  } catch (error) {
    console.error("更新文章异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// DELETE /api/blog/posts/:id - 删除记录
router.delete('/posts/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;

  try {
    // 检查文章是否存在
    const { data: existingPost, error: checkError } = await supabase
      .from('posts')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existingPost) {
      return res.status(404).json({ 
        code: 404, 
        message: "文章不存在",
        data: null
      });
    }

    // 删除文章
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('删除文章错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "删除文章失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "删除文章成功",
      data: null
    });
  } catch (error) {
    console.error("删除文章异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// 分类与标签相关路由
// GET /api/blog/categories - 获取分类列表
router.get('/categories', async (req, res) => {
  const supabase = req.app.get('supabase');

  try {
    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取分类列表错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取分类列表失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取分类列表成功",
      data: categories
    });
  } catch (error) {
    console.error("获取分类列表异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// POST /api/blog/categories - 创建分类
router.post('/categories', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { name, description, parent_id } = req.body;
  
  // 使用默认的 user_id，因为表结构要求此字段
  const defaultUserId = '00000000-0000-0000-0000-000000000000';

  try {
    const { data: category, error } = await supabase
      .from('categories')
      .insert([
        {
          user_id: defaultUserId, // 添加默认user_id以满足约束
          name,
          description: description || '',
          parent_id: parent_id || null
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('创建分类错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "创建分类失败",
        data: null
      });
    }

    res.status(201).json({
      code: 201,
      message: "创建分类成功",
      data: category
    });
  } catch (error) {
    console.error("创建分类异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// PUT /api/blog/categories/:id - 更新分类
router.put('/categories/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;
  const { name, description, parent_id } = req.body;

  try {
    // 检查分类是否存在
    const { data: existingCategory, error: checkError } = await supabase
      .from('categories')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existingCategory) {
      return res.status(404).json({ 
        code: 404, 
        message: "分类不存在",
        data: null
      });
    }

    // 更新分类
    const { data: category, error } = await supabase
      .from('categories')
      .update({
        name,
        description: description || '',
        parent_id: parent_id || null
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('更新分类错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "更新分类失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "更新分类成功",
      data: category
    });
  } catch (error) {
    console.error("更新分类异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// DELETE /api/blog/categories/:id - 删除分类
router.delete('/categories/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;

  try {
    // 检查分类是否存在
    const { data: existingCategory, error: checkError } = await supabase
      .from('categories')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existingCategory) {
      return res.status(404).json({ 
        code: 404, 
        message: "分类不存在",
        data: null
      });
    }

    // 删除分类
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('删除分类错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "删除分类失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "删除分类成功",
      data: null
    });
  } catch (error) {
    console.error("删除分类异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// GET /api/blog/tags - 获取标签列表
router.get('/tags', async (req, res) => {
  const supabase = req.app.get('supabase');

  try {
    const { data: tags, error } = await supabase
      .from('tags')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取标签列表错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取标签列表失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取标签列表成功",
      data: tags
    });
  } catch (error) {
    console.error("获取标签列表异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// POST /api/blog/tags - 创建标签
router.post('/tags', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { name } = req.body;
  
  // 使用默认的 user_id，因为表结构要求此字段
  const defaultUserId = '00000000-0000-0000-0000-000000000000';

  try {
    const { data: tag, error } = await supabase
      .from('tags')
      .insert([
        {
          user_id: defaultUserId, // 添加默认user_id以满足约束
          name
        }
      ])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // 唯一约束违反
        return res.status(400).json({ 
          code: 400, 
          message: "标签已存在",
          data: null
        });
      }
      
      console.error('创建标签错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "创建标签失败",
        data: null
      });
    }

    res.status(201).json({
      code: 201,
      message: "创建标签成功",
      data: tag
    });
  } catch (error) {
    console.error("创建标签异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// DELETE /api/blog/tags/:id - 删除标签
router.delete('/tags/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;

  try {
    // 检查标签是否存在
    const { data: existingTag, error: checkError } = await supabase
      .from('tags')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existingTag) {
      return res.status(404).json({ 
        code: 404, 
        message: "标签不存在",
        data: null
      });
    }

    // 删除标签
    const { error } = await supabase
      .from('tags')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('删除标签错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "删除标签失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "删除标签成功",
      data: null
    });
  } catch (error) {
    console.error("删除标签异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// 技能相关路由
// GET /api/blog/skills - 获取技能列表
router.get('/skills', async (req, res) => {
  const supabase = req.app.get('supabase');

  try {
    const { data: skills, error } = await supabase
      .from('skills')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取技能列表错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取技能列表失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取技能列表成功",
      data: skills
    });
  } catch (error) {
    console.error("获取技能列表异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// POST /api/blog/skills - 创建技能
router.post('/skills', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { name, description, level } = req.body;

  // 使用默认的 user_id，因为表结构要求此字段
  const defaultUserId = '00000000-0000-0000-0000-000000000000';

  try {
    const { data: skill, error } = await supabase
      .from('skills')
      .insert([
        {
          user_id: defaultUserId, // 添加默认user_id以满足约束
          name,
          description: description || '',
          level: level || 1
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('创建技能错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "创建技能失败",
        data: null
      });
    }

    res.status(201).json({
      code: 201,
      message: "创建技能成功",
      data: skill
    });
  } catch (error) {
    console.error("创建技能异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// PUT /api/blog/skills/:id - 更新技能
router.put('/skills/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;
  const { name, description, level } = req.body;

  try {
    // 检查技能是否存在
    const { data: existingSkill, error: checkError } = await supabase
      .from('skills')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existingSkill) {
      return res.status(404).json({ 
        code: 404, 
        message: "技能不存在",
        data: null
      });
    }

    // 更新技能
    const { data: skill, error } = await supabase
      .from('skills')
      .update({
        name,
        description: description || '',
        level: level || 1,
        updated_at: new Date()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('更新技能错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "更新技能失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "更新技能成功",
      data: skill
    });
  } catch (error) {
    console.error("更新技能异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// DELETE /api/blog/skills/:id - 删除技能
router.delete('/skills/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;

  try {
    // 检查技能是否存在
    const { data: existingSkill, error: checkError } = await supabase
      .from('skills')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existingSkill) {
      return res.status(404).json({ 
        code: 404, 
        message: "技能不存在",
        data: null
      });
    }

    // 删除技能
    const { error } = await supabase
      .from('skills')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('删除技能错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "删除技能失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "删除技能成功",
      data: null
    });
  } catch (error) {
    console.error("删除技能异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// GET /api/blog/skills/:id/records - 获取技能学习记录
router.get('/skills/:id/records', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;

  try {
    // 检查技能是否存在
    const { data: existingSkill, error: checkError } = await supabase
      .from('skills')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (checkError || !existingSkill) {
      return res.status(404).json({ 
        code: 404, 
        message: "技能不存在",
        data: null
      });
    }

    const { data: records, error } = await supabase
      .from('skill_records')
      .select('*')
      .eq('skill_id', id)
      .order('learning_date', { ascending: false });

    if (error) {
      console.error('获取技能记录错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取技能记录失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取技能记录成功",
      data: records
    });
  } catch (error) {
    console.error("获取技能记录异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// POST /api/blog/skills/:id/records - 添加技能学习记录
router.post('/skills/:id/records', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;
  const { content, learning_date, duration_minutes } = req.body;

  try {
    // 检查技能是否存在
    const { data: existingSkill, error: checkError } = await supabase
      .from('skills')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existingSkill) {
      return res.status(404).json({ 
        code: 404, 
        message: "技能不存在",
        data: null
      });
    }

    const { data: record, error } = await supabase
      .from('skill_records')
      .insert([
        {
          skill_id: id,
          content,
          learning_date,
          duration_minutes: duration_minutes || 0
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('创建技能记录错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "创建技能记录失败",
        data: null
      });
    }

    res.status(201).json({
      code: 201,
      message: "创建技能记录成功",
      data: record
    });
  } catch (error) {
    console.error("创建技能记录异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// 目标与里程碑相关路由
// GET /api/blog/goals - 获取目标列表
router.get('/goals', async (req, res) => {
  const supabase = req.app.get('supabase');

  try {
    const { data: goals, error } = await supabase
      .from('goals')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取目标列表错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取目标列表失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取目标列表成功",
      data: goals
    });
  } catch (error) {
    console.error("获取目标列表异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// POST /api/blog/goals - 创建目标
router.post('/goals', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { title, description, target_date, progress } = req.body;

  try {
    const { data: goal, error } = await supabase
      .from('goals')
      .insert([
        {
          title,
          description: description || '',
          target_date: target_date || null,
          progress: progress || 0,
          status: 'pending'
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('创建目标错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "创建目标失败",
        data: null
      });
    }

    res.status(201).json({
      code: 201,
      message: "创建目标成功",
      data: goal
    });
  } catch (error) {
    console.error("创建目标异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// PUT /api/blog/goals/:id - 更新目标
router.put('/goals/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;
  const { title, description, target_date, progress, status } = req.body;

  try {
    // 检查目标是否存在
    const { data: existingGoal, error: checkError } = await supabase
      .from('goals')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (checkError || !existingGoal) {
      return res.status(404).json({ 
        code: 404, 
        message: "目标不存在",
        data: null
      });
    }

    // 更新目标
    const { data: goal, error } = await supabase
      .from('goals')
      .update({
        title,
        description: description || '',
        target_date: target_date || null,
        progress: progress !== undefined ? progress : undefined,
        status: status || undefined,
        updated_at: new Date()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('更新目标错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "更新目标失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "更新目标成功",
      data: goal
    });
  } catch (error) {
    console.error("更新目标异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// DELETE /api/blog/goals/:id - 删除目标
router.delete('/goals/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;

  try {
    // 检查目标是否存在
    const { data: existingGoal, error: checkError } = await supabase
      .from('goals')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (checkError || !existingGoal) {
      return res.status(404).json({ 
        code: 404, 
        message: "目标不存在",
        data: null
      });
    }

    // 删除目标
    const { error } = await supabase
      .from('goals')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('删除目标错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "删除目标失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "删除目标成功",
      data: null
    });
  } catch (error) {
    console.error("删除目标异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// GET /api/blog/milestones - 获取里程碑列表
router.get('/milestones', async (req, res) => {
  const supabase = req.app.get('supabase');

  try {
    const { data: milestones, error } = await supabase
      .from('milestones')
      .select('*')
      .order('achieved_date', { ascending: false });

    if (error) {
      console.error('获取里程碑列表错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取里程碑列表失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取里程碑列表成功",
      data: milestones
    });
  } catch (error) {
    console.error("获取里程碑列表异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// POST /api/blog/milestones - 创建里程碑
router.post('/milestones', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { title, description, achieved_date, related_skill_id } = req.body;

  try {
    const { data: milestone, error } = await supabase
      .from('milestones')
      .insert([
        {
          title,
          description: description || '',
          achieved_date,
          related_skill_id: related_skill_id || null
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('创建里程碑错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "创建里程碑失败",
        data: null
      });
    }

    res.status(201).json({
      code: 201,
      message: "创建里程碑成功",
      data: milestone
    });
  } catch (error) {
    console.error("创建里程碑异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// DELETE /api/blog/milestones/:id - 删除里程碑
router.delete('/milestones/:id', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { id } = req.params;

  try {
    // 检查里程碑是否存在
    const { data: existingMilestone, error: checkError } = await supabase
      .from('milestones')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (checkError || !existingMilestone) {
      return res.status(404).json({ 
        code: 404, 
        message: "里程碑不存在",
        data: null
      });
    }

    // 删除里程碑
    const { error } = await supabase
      .from('milestones')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('删除里程碑错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "删除里程碑失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "删除里程碑成功",
      data: null
    });
  } catch (error) {
    console.error("删除里程碑异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// 统计相关路由
// GET /api/blog/stats/posts - 记录统计数据
router.get('/stats/posts', async (req, res) => {
  const supabase = req.app.get('supabase');

  try {
    // 获取文章统计信息
    const { data: stats, error } = await supabase
      .from('posts')
      .select('type, status, COUNT(*) as count')
      .group('type, status');

    if (error) {
      console.error('获取文章统计错误:', error);
      return res.status(500).json({ 
        code: 500, 
        message: "获取文章统计失败",
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: "获取文章统计成功",
      data: stats
    });
  } catch (error) {
    console.error("获取文章统计异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// GET /api/blog/stats/skills - 技能成长数据
router.get('/stats/skills', async (req, res) => {
  const supabase = req.app.get('supabase');

  try {
    // 获取技能统计信息
    const { data: skills, error: skillsError } = await supabase
      .from('skills')
      .select('name, level')
      .order('level', { ascending: false });

    if (skillsError) {
      console.error('获取技能统计错误:', skillsError);
      return res.status(500).json({ 
        code: 500, 
        message: "获取技能统计失败",
        data: null
      });
    }

    // 获取技能学习记录统计（如果函数不存在则返回空数组）
    let records = [];
    const { data: recordsData, error: recordsError } = await supabase.rpc('skill_records_stats');
    
    if (!recordsError && recordsData) {
      records = recordsData;
    }

    res.status(200).json({
      code: 200,
      message: "获取技能统计成功",
      data: {
        skills,
        records
      }
    });
  } catch (error) {
    console.error("获取技能统计异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

// GET /api/blog/stats/learning - 学习时间统计
router.get('/stats/learning', async (req, res) => {
  const supabase = req.app.get('supabase');

  try {
    // 获取学习时间统计（如果函数不存在则返回空数组）
    let stats = [];
    const { data: statsData, error } = await supabase.rpc('learning_time_stats');
    
    if (!error && statsData) {
      stats = statsData;
    }

    res.status(200).json({
      code: 200,
      message: "获取学习时间统计成功",
      data: stats
    });
  } catch (error) {
    console.error("获取学习时间统计异常:", error.message);
    res.status(500).json({ 
      code: 500, 
      message: "服务器错误",
      data: null
    });
  }
});

module.exports = router;