const express = require('express');
const router = express.Router();
// Node.js 18+ 内置 fetch，无需额外导入

// 统一响应格式: { code, data, msg }
const sendResponse = (res, code = 200, data = null, msg = '操作成功') => {
  res.json({ code, data, msg });
};

/**
 * 1.1 获取题目列表
 * GET /api/questions
 * 参数：type、difficulty、page、limit
 */
router.get('/questions', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { type, difficulty, page = 1, limit = 10 } = req.query;

    // 构建查询
    let query = supabase.from('questions').select('*', { count: 'exact' });

    // 添加过滤条件
    if (type) {
      query = query.eq('type', type);
    }
    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    // 计算分页
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);
    query = query.order('created_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      console.error('获取题目列表错误:', error);
      if (error.message && error.message.includes('relation')) {
        return sendResponse(res, 500, null, '数据库表未创建，请先在 Supabase Dashboard 中执行 sql/create_questions_tables.sql');
      }
      return sendResponse(res, 500, null, '获取题目列表失败: ' + error.message);
    }

    sendResponse(res, 200, {
      list: data || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil((count || 0) / parseInt(limit))
    });
  } catch (error) {
    console.error('获取题目列表异常:', error);
    sendResponse(res, 500, null, '服务器内部错误');
  }
});

/**
 * 1.2 获取单题详情
 * GET /api/questions/:id
 */
router.get('/questions/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id } = req.params;

    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('获取题目详情错误:', error);
      return sendResponse(res, 404, null, '题目不存在');
    }

    sendResponse(res, 200, data);
  } catch (error) {
    console.error('获取题目详情异常:', error);
    sendResponse(res, 500, null, '服务器内部错误');
  }
});

/**
 * 1.3 AI 辅助生成题目并保存到数据库（前端调用，避免暴露 API Key）
 * POST /api/questions/generate
 * 参数：count（生成数量）、prompt（可选，自定义提示词）、excludeTitles（可选，要排除的题目标题列表）
 */
router.post('/questions/generate', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { prompt: customPrompt, count = 5, excludeTitles = [] } = req.body;

    // 限制生成数量范围
    const validCount = Math.min(Math.max(parseInt(count) || 5, 1), 30);

    // 获取数据库中已有的题目列表，用于提示 AI 避免重复
    let existingTitlesList = [];
    if (excludeTitles.length > 0) {
      existingTitlesList = excludeTitles;
    } else {
      // 如果没有传入排除列表，自动从数据库获取所有已有题目
      const { data: allQuestions } = await supabase
        .from('questions')
        .select('title');
      existingTitlesList = (allQuestions || []).map(q => q.title);
    }

    // 构造避免重复的提示
    let excludeHint = '';
    if (existingTitlesList.length > 0) {
      // 只取最近的 20 个题目作为参考，避免 prompt 过长
      const recentTitles = existingTitlesList.slice(-20);
      excludeHint = `\n\n重要：以下题目已经存在，请生成与这些题目完全不同的新题目：\n${recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n请确保新生成的题目在知识点、考察角度、难度上与上述题目有明显区别。`;
    }

    // 默认提示词 - 增加了随机性和多样性要求
    const defaultPrompt = `你是资深前端面试官，请生成${validCount}道**全新的**前端面试题，包含理论题和手写编程题。
严格返回JSON数组，不要任何多余文字、markdown、解释。
字段：
title、content、type(theory/coding)、difficulty(easy/medium/hard)、code_template

要求：
- type 只能是 "theory" 或 "coding"
- difficulty 只能是 "easy"、"medium" 或 "hard"
- coding 类型的题目需要提供 code_template（代码模板）
- theory 类型的题目 code_template 可以为空字符串
- **题目必须具有多样性和创新性，避免常见的基础题目**
- **每道题应从不同角度考察，避免重复考察同一知识点**
- 覆盖内容：JS 基础、原型链、闭包、异步编程、Promise、async/await、事件循环、防抖节流、深拷贝浅拷贝、数组扁平化、Vue3 响应式原理、Vue 生命周期、组合式 API、跨域解决方案、HTTP 缓存策略、性能优化技巧、并发控制、设计模式等${excludeHint}`;

    const prompt = customPrompt || defaultPrompt;

    console.log(`开始调用 DeepSeek API 生成 ${validCount} 道题目...`);
    if (existingTitlesList.length > 0) {
      console.log(`已存在 ${existingTitlesList.length} 道题目，将避免重复`);
    }

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.9,  // 提高温度参数增加随机性和多样性
        top_p: 0.95         // 使用 top_p 采样进一步增加多样性
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepSeek API 错误:', errorText);
      return sendResponse(res, 500, null, `AI 服务调用失败: ${response.statusText}`);
    }

    const aiData = await response.json();
    const aiContent = aiData.choices[0].message.content;

    // 解析 AI 返回的 JSON
    let questions;
    try {
      // 尝试清理可能的 markdown 代码块标记
      let cleanedContent = aiContent.trim();
      if (cleanedContent.startsWith('```json')) {
        cleanedContent = cleanedContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      questions = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error('解析 AI 返回数据失败:', parseError);
      console.error('AI 返回内容:', aiContent.substring(0, 500));
      return sendResponse(res, 500, null, 'AI 返回数据格式错误');
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return sendResponse(res, 500, null, 'AI 未返回有效题目数据');
    }

    console.log(`AI 生成了 ${questions.length} 道题目，开始检查并保存到数据库...`);

    // 批量插入数据库，使用 upsert 处理重复题目
    const insertData = questions.map(q => ({
      title: q.title,
      content: q.content,
      type: q.type,
      difficulty: q.difficulty,
      code_template: q.code_template || ''
    }));

    // 先查询已存在的题目标题，过滤掉重复的
    const existingTitles = insertData.map(q => q.title);
    const { data: existingData } = await supabase
      .from('questions')
      .select('title')
      .in('title', existingTitles);

    const existingTitleSet = new Set((existingData || []).map(item => item.title));
    
    // 过滤掉已存在的题目
    const newQuestions = insertData.filter(q => !existingTitleSet.has(q.title));
    const duplicateCount = insertData.length - newQuestions.length;

    if (duplicateCount > 0) {
      console.log(`跳过 ${duplicateCount} 道重复题目`);
    }

    if (newQuestions.length === 0) {
      return sendResponse(res, 200, { count: 0, questions: [], duplicateCount }, '所有题目均已存在，无需保存');
    }

    const { data, error } = await supabase
      .from('questions')
      .insert(newQuestions)
      .select();

    if (error) {
      console.error('插入题目数据错误:', error);
      // 如果是因为唯一约束冲突，尝试逐条插入并跳过重复的
      if (error.code === '23505' || error.message.includes('unique')) {
        const successInserted = [];
        const failedTitles = [];
        
        for (const question of newQuestions) {
          const { data, error } = await supabase
            .from('questions')
            .insert([question])
            .select()
            .single();
          
          if (!error) {
            successInserted.push(data);
          } else {
            failedTitles.push(question.title);
          }
        }
        
        if (failedTitles.length > 0) {
          console.log(`以下题目已存在，已跳过:`, failedTitles);
        }
        
        return sendResponse(res, 200, { 
          count: successInserted.length, 
          questions: successInserted,
          skippedCount: failedTitles.length,
          skippedTitles: failedTitles
        }, `成功保存 ${successInserted.length} 道题目，跳过 ${failedTitles.length} 道重复题目`);
      }
      
      return sendResponse(res, 500, null, '保存题目到数据库失败');
    }

    console.log(`成功保存 ${data.length} 道题目到数据库`);
    sendResponse(res, 200, { 
      count: data.length, 
      questions: data,
      duplicateCount 
    }, `题目生成并保存成功${duplicateCount > 0 ? `，跳过 ${duplicateCount} 道重复题目` : ''}`);
  } catch (error) {
    console.error('生成题目异常:', error);
    sendResponse(res, 500, null, '服务器内部错误');
  }
});

/**
 * 2.1 AI 自动生成 30 道前端面试题并保存到数据库（仅 weiqing 用户可操作）
 * GET /api/admin/generate-questions
 */
router.get('/admin/generate-questions', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');

    // 验证用户名（从请求头或查询参数获取）
    const username = req.headers['x-username'] || req.query.username;
    if (username !== 'weiqing') {
      return sendResponse(res, 403, null, '权限不足：仅 weiqing 用户可执行此操作');
    }

    console.log('开始生成 AI 题目...');

    // 构造 DeepSeek API 请求
    const prompt = `你是资深前端面试官，生成30道前端面试题，包含理论题和手写编程题。
严格返回JSON数组，不要任何多余文字、markdown、解释。
字段：
id、title、content、type(theory/coding)、difficulty(easy/medium/hard)、code_template

要求：
- id 为数字，从1到30
- type 只能是 "theory" 或 "coding"
- difficulty 只能是 "easy"、"medium" 或 "hard"
- coding 类型的题目需要提供 code_template（代码模板）
- theory 类型的题目 code_template 可以为空字符串
- 覆盖内容：JS 基础、原型、闭包、异步、Promise、事件循环、防抖节流、深拷贝、数组扁平化、Vue3 响应式、Vue 原理、跨域、HTTP 缓存、性能优化、并发控制`;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.9,  // 提高温度参数增加随机性和多样性
        top_p: 0.95         // 使用 top_p 采样进一步增加多样性
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepSeek API 错误:', errorText);
      return sendResponse(res, 500, null, `AI 服务调用失败: ${response.statusText}`);
    }

    const aiData = await response.json();
    const aiContent = aiData.choices[0].message.content;

    // 解析 AI 返回的 JSON
    let questions;
    try {
      // 尝试清理可能的 markdown 代码块标记
      let cleanedContent = aiContent.trim();
      if (cleanedContent.startsWith('```json')) {
        cleanedContent = cleanedContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      questions = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error('解析 AI 返回数据失败:', parseError);
      console.error('AI 返回内容:', aiContent.substring(0, 500));
      return sendResponse(res, 500, null, 'AI 返回数据格式错误');
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return sendResponse(res, 500, null, 'AI 未返回有效题目数据');
    }

    console.log(`AI 生成了 ${questions.length} 道题目，开始检查并插入数据库...`);

    // 批量插入数据库，处理重复题目
    const insertData = questions.map(q => ({
      title: q.title,
      content: q.content,
      type: q.type,
      difficulty: q.difficulty,
      code_template: q.code_template || ''
    }));

    // 先查询已存在的题目标题，过滤掉重复的
    const existingTitles = insertData.map(q => q.title);
    const { data: existingData } = await supabase
      .from('questions')
      .select('title')
      .in('title', existingTitles);

    const existingTitleSet = new Set((existingData || []).map(item => item.title));
    
    // 过滤掉已存在的题目
    const newQuestions = insertData.filter(q => !existingTitleSet.has(q.title));
    const duplicateCount = insertData.length - newQuestions.length;

    if (duplicateCount > 0) {
      console.log(`跳过 ${duplicateCount} 道重复题目`);
    }

    if (newQuestions.length === 0) {
      return sendResponse(res, 200, { count: 0, questions: [], duplicateCount }, '所有题目均已存在，无需保存');
    }

    const { data, error } = await supabase
      .from('questions')
      .insert(newQuestions)
      .select();

    if (error) {
      console.error('插入题目数据错误:', error);
      // 如果是因为唯一约束冲突，尝试逐条插入并跳过重复的
      if (error.code === '23505' || error.message.includes('unique')) {
        const successInserted = [];
        const failedTitles = [];
        
        for (const question of newQuestions) {
          const { data, error } = await supabase
            .from('questions')
            .insert([question])
            .select()
            .single();
          
          if (!error) {
            successInserted.push(data);
          } else {
            failedTitles.push(question.title);
          }
        }
        
        if (failedTitles.length > 0) {
          console.log(`以下题目已存在，已跳过:`, failedTitles);
        }
        
        return sendResponse(res, 200, { 
          count: successInserted.length, 
          questions: successInserted,
          skippedCount: failedTitles.length,
          skippedTitles: failedTitles
        }, `成功保存 ${successInserted.length} 道题目，跳过 ${failedTitles.length} 道重复题目`);
      }
      
      return sendResponse(res, 500, null, '保存题目到数据库失败');
    }

    console.log(`成功插入 ${data.length} 道题目`);
    sendResponse(res, 200, { 
      count: data.length, 
      questions: data,
      duplicateCount 
    }, `题目生成成功${duplicateCount > 0 ? `，跳过 ${duplicateCount} 道重复题目` : ''}`);
  } catch (error) {
    console.error('生成题目异常:', error);
    sendResponse(res, 500, null, '服务器内部错误');
  }
});

/**
 * 3.1 提交代码并 AI 判题
 * POST /api/judge
 */
router.post('/judge', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { question_id, title, content, user_code } = req.body;

    // 参数验证
    if (!question_id || !title || !content || !user_code) {
      return sendResponse(res, 400, null, '缺少必要参数');
    }

    console.log(`开始判题 - 题目ID: ${question_id}, 题目: ${title}`);

    // 构造判题 Prompt
    const judgePrompt = `你是资深前端面试官，严格判题。
题目：${title}
描述：${content}
用户代码：${user_code}

请按以下四点返回，不要多余内容：
1. 是否正确（正确/错误）
2. 错误原因（没有则写无同时需要给出写题的答案写的怎么样写出锐评、当然如果写的好也要锐评）
3. 标准答案代码
4. 详细解析（知识点、原理、考点）
覆盖内容：
JS 基础、原型、闭包、异步、Promise、事件循环、防抖节流、深拷贝、数组扁平化、Vue3 响应式、Vue 原理、跨域、HTTP 缓存、性能优化、并发控制。`;

    // 调用 DeepSeek API
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是资深前端面试官，负责评判前端面试者的代码质量和知识掌握程度。'
          },
          {
            role: 'user',
            content: judgePrompt
          }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepSeek API 错误:', errorText);
      return sendResponse(res, 500, null, `AI 判题服务调用失败: ${response.statusText}`);
    }

    const aiData = await response.json();
    const aiResult = aiData.choices[0].message.content;

    // 判断状态（简单判断是否包含"正确"）
    const status = aiResult.includes('正确') && !aiResult.includes('错误') ? '正确' : '错误';

    console.log(`AI 判题完成，结果: ${status}`);

    // 保存提交记录到数据库
    const { data: submissionData, error: submitError } = await supabase
      .from('submissions')
      .insert([
        {
          question_id,
          user_code,
          ai_result: aiResult,
          status
        }
      ])
      .select()
      .single();

    if (submitError) {
      console.error('保存提交记录错误:', submitError);
      // 即使保存失败也返回 AI 结果
      return sendResponse(res, 200, {
        ai_result: aiResult,
        status,
        warning: '提交记录保存失败'
      }, '判题完成但保存记录失败');
    }

    sendResponse(res, 200, {
      submission_id: submissionData.id,
      ai_result: aiResult,
      status,
      created_at: submissionData.created_at
    });
  } catch (error) {
    console.error('AI 判题异常:', error);
    sendResponse(res, 500, null, '服务器内部错误');
  }
});

/**
 * 4.1 获取所有提交记录
 * GET /api/submissions
 */
router.get('/submissions', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');

    // 关联查询题目信息
    const { data, error } = await supabase
      .from('submissions')
      .select(`
        id,
        question_id,
        user_code,
        ai_result,
        status,
        created_at,
        questions (
          title
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取提交记录错误:', error);
      return sendResponse(res, 500, null, '获取提交记录失败');
    }

    // 格式化返回数据
    const formattedData = (data || []).map(item => ({
      id: item.id,
      question_id: item.question_id,
      question_title: item.questions?.title || '未知题目',
      user_code: item.user_code,
      ai_result: item.ai_result,
      status: item.status,
      created_at: item.created_at
    }));

    sendResponse(res, 200, formattedData);
  } catch (error) {
    console.error('获取提交记录异常:', error);
    sendResponse(res, 500, null, '服务器内部错误');
  }
});

module.exports = router;
