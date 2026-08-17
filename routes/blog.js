const express = require('express');
const router = express.Router();

/**
 * 【功能描述】
 * 分页获取博客文章列表，支持按 type、status、is_private 筛选。
 *
 * 【业务逻辑】
 * 1. 获取并校验 Supabase 客户端。
 * 2. 解析 page、limit 及筛选参数，计算 offset。
 * 3. 探测 posts 表可访问性，构建分页查询并按 created_at 倒序。
 * 4. 返回 posts 列表及 pagination 元数据。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().range().order、count exact
 * - 涉及知识点：Supabase 分页、动态 eq 筛选链式查询
 */
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

/**
 * 【功能描述】
 * 根据 ID 获取单篇博客文章详情（含完整 content）。
 *
 * 【业务逻辑】
 * 1. 校验 Supabase 客户端及路径 id 非空。
 * 2. 按 id 查询 posts 表单条记录。
 * 3. PGRST116（无记录）视为 404，其他错误返回 500。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().eq().single
 * - 涉及知识点：PostgREST PGRST116 错误码、single 查询
 */
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

/**
 * 【功能描述】
 * 创建一篇新博客文章。
 *
 * 【业务逻辑】
 * 1. 从请求体读取 title、content、excerpt、type、status、is_private。
 * 2. 使用默认 user_id 满足外键约束。
 * 3. 插入 posts 表并返回新记录。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().single
 * - 涉及知识点：默认值填充、外键占位 user_id
 */
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

/**
 * 【功能描述】
 * 更新指定 ID 的博客文章。
 *
 * 【业务逻辑】
 * 1. 先查询 posts 表确认文章存在，否则 404。
 * 2. 更新 title、content、excerpt、type、status、is_private 及 updated_at。
 * 3. 返回更新后的完整记录。
 *
 * 【技术实现】
 * - 涉及方法：router.put、supabase.from().update().eq().single
 * - 涉及知识点：存在性预检、update + select 返回行
 */
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

/**
 * 【功能描述】
 * 删除指定 ID 的博客文章。
 *
 * 【业务逻辑】
 * 1. 先查询 posts 表确认文章存在，否则 404。
 * 2. 按 id 执行 delete。
 * 3. 返回删除成功响应。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.from().delete().eq
 * - 涉及知识点：删除前存在性校验
 */
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

/**
 * 【功能描述】
 * 获取博客分类列表，按 created_at 倒序。
 *
 * 【业务逻辑】
 * 1. 查询 categories 表全部字段。
 * 2. 按 created_at 降序返回。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().order
 * - 涉及知识点：Supabase 全表列表查询
 */
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

/**
 * 【功能描述】
 * 创建一个新的博客分类。
 *
 * 【业务逻辑】
 * 1. 从请求体读取 name、description、parent_id。
 * 2. 使用默认 user_id 插入 categories 表。
 * 3. 返回新创建的分类记录。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().single
 * - 涉及知识点：树形分类 parent_id、默认 user_id
 */
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

/**
 * 【功能描述】
 * 更新指定 ID 的博客分类。
 *
 * 【业务逻辑】
 * 1. 先查询 categories 表确认分类存在，否则 404。
 * 2. 更新 name、description、parent_id。
 * 3. 返回更新后的分类记录。
 *
 * 【技术实现】
 * - 涉及方法：router.put、supabase.from().update().eq().single
 * - 涉及知识点：存在性预检、分类树 parent_id 更新
 */
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

/**
 * 【功能描述】
 * 删除指定 ID 的博客分类。
 *
 * 【业务逻辑】
 * 1. 先查询 categories 表确认分类存在，否则 404。
 * 2. 按 id 执行 delete。
 * 3. 返回删除成功响应。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.from().delete().eq
 * - 涉及知识点：删除前存在性校验
 */
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

/**
 * 【功能描述】
 * 获取博客标签列表，按 created_at 倒序。
 *
 * 【业务逻辑】
 * 1. 查询 tags 表全部字段。
 * 2. 按 created_at 降序返回。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().order
 * - 涉及知识点：Supabase 全表列表查询
 */
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

/**
 * 【功能描述】
 * 创建一个新博客标签。
 *
 * 【业务逻辑】
 * 1. 从请求体读取 name。
 * 2. 使用默认 user_id 插入 tags 表。
 * 3. 唯一约束冲突（23505）返回 400「标签已存在」。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().single
 * - 涉及知识点：PostgreSQL 23505 唯一约束错误码
 */
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

/**
 * 【功能描述】
 * 删除指定 ID 的博客标签。
 *
 * 【业务逻辑】
 * 1. 先查询 tags 表确认标签存在，否则 404。
 * 2. 按 id 执行 delete。
 * 3. 返回删除成功响应。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.from().delete().eq
 * - 涉及知识点：删除前存在性校验
 */
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

/**
 * 【功能描述】
 * 获取技能列表，按 created_at 倒序。
 *
 * 【业务逻辑】
 * 1. 查询 skills 表全部字段。
 * 2. 按 created_at 降序返回。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().order
 * - 涉及知识点：Supabase 全表列表查询
 */
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

/**
 * 【功能描述】
 * 创建一项新技能记录。
 *
 * 【业务逻辑】
 * 1. 从请求体读取 name、description、level。
 * 2. 使用默认 user_id 插入 skills 表，level 默认 1。
 * 3. 返回新创建的技能记录。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().single
 * - 涉及知识点：默认值填充、外键占位 user_id
 */
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

/**
 * 【功能描述】
 * 更新指定 ID 的技能信息。
 *
 * 【业务逻辑】
 * 1. 先查询 skills 表确认技能存在，否则 404。
 * 2. 更新 name、description、level 及 updated_at。
 * 3. 返回更新后的技能记录。
 *
 * 【技术实现】
 * - 涉及方法：router.put、supabase.from().update().eq().single
 * - 涉及知识点：存在性预检、update + select 返回行
 */
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

/**
 * 【功能描述】
 * 删除指定 ID 的技能记录。
 *
 * 【业务逻辑】
 * 1. 先查询 skills 表确认技能存在，否则 404。
 * 2. 按 id 执行 delete。
 * 3. 返回删除成功响应。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.from().delete().eq
 * - 涉及知识点：删除前存在性校验
 */
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

/**
 * 【功能描述】
 * 获取指定技能的全部学习记录，按 learning_date 倒序。
 *
 * 【业务逻辑】
 * 1. 先查询 skills 表确认技能存在，否则 404。
 * 2. 查询 skill_records 表中 skill_id 匹配的记录。
 * 3. 按 learning_date 降序返回。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().eq().order
 * - 涉及知识点：父子表关联查询、skill_records 表
 */
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

/**
 * 【功能描述】
 * 为指定技能添加一条学习记录。
 *
 * 【业务逻辑】
 * 1. 先查询 skills 表确认技能存在，否则 404。
 * 2. 从请求体读取 content、learning_date、duration_minutes。
 * 3. 插入 skill_records 表并返回新记录。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().single
 * - 涉及知识点：嵌套资源路由、skill_id 外键关联
 */
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

/**
 * 【功能描述】
 * 获取目标（goals）列表，按 created_at 倒序。
 *
 * 【业务逻辑】
 * 1. 查询 goals 表全部字段。
 * 2. 按 created_at 降序返回。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().order
 * - 涉及知识点：Supabase 全表列表查询
 */
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

/**
 * 【功能描述】
 * 创建一个新目标（goal）。
 *
 * 【业务逻辑】
 * 1. 从请求体读取 title、description、target_date、progress。
 * 2. 插入 goals 表，status 默认为 pending，progress 默认 0。
 * 3. 返回新创建的目标记录。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().single
 * - 涉及知识点：默认值填充、目标状态机 pending
 */
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

/**
 * 【功能描述】
 * 更新指定 ID 的目标信息。
 *
 * 【业务逻辑】
 * 1. 先查询 goals 表确认目标存在，否则 404。
 * 2. 更新 title、description、target_date、progress、status 及 updated_at。
 * 3. progress、status 仅在请求体提供时才更新（undefined 跳过）。
 *
 * 【技术实现】
 * - 涉及方法：router.put、supabase.from().update().eq().single
 * - 涉及知识点：部分字段 undefined 跳过更新
 */
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

/**
 * 【功能描述】
 * 删除指定 ID 的目标记录。
 *
 * 【业务逻辑】
 * 1. 先查询 goals 表确认目标存在，否则 404。
 * 2. 按 id 执行 delete。
 * 3. 返回删除成功响应。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.from().delete().eq
 * - 涉及知识点：删除前存在性校验
 */
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

/**
 * 【功能描述】
 * 获取里程碑（milestones）列表，按 achieved_date 倒序。
 *
 * 【业务逻辑】
 * 1. 查询 milestones 表全部字段。
 * 2. 按 achieved_date 降序返回。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().order
 * - 涉及知识点：Supabase 全表列表查询
 */
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

/**
 * 【功能描述】
 * 创建一个新里程碑记录。
 *
 * 【业务逻辑】
 * 1. 从请求体读取 title、description、achieved_date、related_skill_id。
 * 2. 插入 milestones 表，related_skill_id 可为 null。
 * 3. 返回新创建的里程碑记录。
 *
 * 【技术实现】
 * - 涉及方法：router.post、supabase.from().insert().single
 * - 涉及知识点：可选外键 related_skill_id
 */
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

/**
 * 【功能描述】
 * 删除指定 ID 的里程碑记录。
 *
 * 【业务逻辑】
 * 1. 先查询 milestones 表确认记录存在，否则 404。
 * 2. 按 id 执行 delete。
 * 3. 返回删除成功响应。
 *
 * 【技术实现】
 * - 涉及方法：router.delete、supabase.from().delete().eq
 * - 涉及知识点：删除前存在性校验
 */
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

/**
 * 【功能描述】
 * 获取文章按 type、status 分组的统计数据。
 *
 * 【业务逻辑】
 * 1. 对 posts 表按 type、status 分组并 COUNT。
 * 2. 返回聚合统计结果。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.from().select().group
 * - 涉及知识点：PostgREST group 聚合、COUNT
 */
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

/**
 * 【功能描述】
 * 获取技能成长统计数据（技能等级 + RPC 学习记录统计）。
 *
 * 【业务逻辑】
 * 1. 查询 skills 表 name、level，按 level 降序。
 * 2. 调用 RPC skill_records_stats（不存在或失败则 records 为空数组）。
 * 3. 合并返回 skills 与 records。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.rpc、supabase.from().select().order
 * - 涉及知识点：Supabase RPC 存储过程、优雅降级空数组
 */
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

/**
 * 【功能描述】
 * 获取学习时间统计数据（RPC learning_time_stats）。
 *
 * 【业务逻辑】
 * 1. 调用 RPC learning_time_stats。
 * 2. RPC 不存在或失败则返回空数组 stats。
 * 3. 返回学习时间统计结果。
 *
 * 【技术实现】
 * - 涉及方法：router.get、supabase.rpc
 * - 涉及知识点：Supabase RPC、优雅降级空数组
 */
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