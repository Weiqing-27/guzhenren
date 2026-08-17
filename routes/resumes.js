const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * 【功能描述】
 * 从 Express 应用实例中获取 Supabase 客户端。
 *
 * 【业务逻辑】
 * 1. 简历路由通过 req.app 共享 Supabase 连接。
 *
 * 【技术实现】
 * - 涉及方法：req.app.get('supabase')
 * - 涉及知识点：Express 应用级变量
 */
const getSupabase = (req) => req.app.get('supabase');

const EMPTY_RESUME = {
  basic: {
    name: '',
    gender: '男',
    phone: '',
    email: '',
    birthday: '',
    city: '',
    jobIntention: '',
    summary: '',
  },
  workList: [],
  educationList: [],
  projectList: [],
  skills: [],
  skillDetail: '',
};

/**
 * 【功能描述】
 * 将任意 content 对象规范化为标准简历结构。
 *
 * 【业务逻辑】
 * 1. 若 content 无效，返回 EMPTY_RESUME 副本。
 * 2. basic 字段与默认值合并；数组字段校验类型；skillDetail 校验为字符串。
 *
 * 【技术实现】
 * - 涉及方法：对象展开（...）、Array.isArray()、typeof 类型守卫
 * - 涉及知识点：防御性编程、数据结构规范化
 */
function normalizeContent(content) {
  if (!content || typeof content !== 'object') {
    return { ...EMPTY_RESUME };
  }

  return {
    basic: { ...EMPTY_RESUME.basic, ...(content.basic || {}) },
    workList: Array.isArray(content.workList) ? content.workList : [],
    educationList: Array.isArray(content.educationList) ? content.educationList : [],
    projectList: Array.isArray(content.projectList) ? content.projectList : [],
    skills: Array.isArray(content.skills) ? content.skills : [],
    skillDetail: typeof content.skillDetail === 'string' ? content.skillDetail : '',
  };
}

/**
 * 【功能描述】
 * 获取当前登录用户的简历内容。
 *
 * 【业务逻辑】
 * 1. authenticate 中间件校验 JWT，注入 req.user.userId。
 * 2. 按 user_id 查询 resumes 表（maybeSingle，允许无记录）。
 * 3. 无记录时返回 EMPTY_RESUME 模板；有记录时 normalizeContent 后返回。
 *
 * 【技术实现】
 * - 涉及方法：authenticate 中间件、supabase.from().select().eq().maybeSingle()
 * - 涉及知识点：JWT 鉴权、maybeSingle 零/一行查询、简历 JSON 存储
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { data, error } = await supabase
      .from('resumes')
      .select('id, user_id, content, created_at, updated_at')
      .eq('user_id', req.user.userId)
      .maybeSingle();

    if (error) {
      console.error('获取简历失败:', error);
      return res.status(500).json({
        code: 500,
        message: '获取简历失败',
        data: null,
        error: error.message,
      });
    }

    if (!data) {
      return res.status(200).json({
        code: 200,
        message: '暂无简历数据',
        data: {
          content: { ...EMPTY_RESUME },
          updatedAt: null,
        },
      });
    }

    return res.status(200).json({
      code: 200,
      message: '获取简历成功',
      data: {
        id: data.id,
        content: normalizeContent(data.content),
        updatedAt: data.updated_at,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    console.error('获取简历异常:', error);
    return res.status(500).json({
      code: 500,
      message: '服务器错误',
      data: null,
      error: error.message,
    });
  }
});

/**
 * 【功能描述】
 * 保存（新建或更新）当前登录用户的简历。
 *
 * 【业务逻辑】
 * 1. 校验 content 为非空对象。
 * 2. normalizeContent 规范化后，查询是否已有记录。
 * 3. 已有则 update；无则 insert（upsert 逻辑）。
 * 4. 返回 id、规范化后的 content 及 updatedAt。
 *
 * 【技术实现】
 * - 涉及方法：authenticate 中间件、supabase.from().select().update().insert().maybeSingle()
 * - 涉及知识点：应用层 upsert、JSONB content 字段、ISO 8601 时间戳
 */
router.put('/me', authenticate, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || typeof content !== 'object') {
      return res.status(400).json({
        code: 400,
        message: '简历内容不能为空',
        data: null,
      });
    }

    const supabase = getSupabase(req);
    const normalizedContent = normalizeContent(content);
    const now = new Date().toISOString();

    const { data: existing, error: selectError } = await supabase
      .from('resumes')
      .select('id')
      .eq('user_id', req.user.userId)
      .maybeSingle();

    if (selectError) {
      console.error('查询简历失败:', selectError);
      return res.status(500).json({
        code: 500,
        message: '保存简历失败',
        data: null,
        error: selectError.message,
      });
    }

    let result;

    if (existing) {
      const { data, error } = await supabase
        .from('resumes')
        .update({
          content: normalizedContent,
          updated_at: now,
        })
        .eq('user_id', req.user.userId)
        .select('id, updated_at')
        .single();

      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('resumes')
        .insert([
          {
            user_id: req.user.userId,
            content: normalizedContent,
            created_at: now,
            updated_at: now,
          },
        ])
        .select('id, updated_at')
        .single();

      if (error) throw error;
      result = data;
    }

    return res.status(200).json({
      code: 200,
      message: '保存简历成功',
      data: {
        id: result.id,
        content: normalizedContent,
        updatedAt: result.updated_at,
      },
    });
  } catch (error) {
    console.error('保存简历异常:', error);
    return res.status(500).json({
      code: 500,
      message: '保存简历失败',
      data: null,
      error: error.message,
    });
  }
});

module.exports = router;
