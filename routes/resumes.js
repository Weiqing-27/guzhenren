const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

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

// 获取当前用户简历
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

// 保存当前用户简历（upsert）
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
