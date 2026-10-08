const express = require('express');
const {
  callDeepSeekText,
  createQuestionEvaluationGuide,
  gradeGrowthPractice,
  parseJsonContent,
} = require('../services/deepseek');
const router = express.Router();
// Node.js 18+ 内置 fetch，无需额外导入

/**
 * 【功能描述】
 * 统一 API 响应格式封装。
 *
 * 【业务逻辑】
 * 1. 所有 questions 相关接口通过此函数返回 { code, data, msg } 结构。
 *
 * 【技术实现】
 * - 涉及方法：res.json()
 * - 涉及知识点：Express 响应封装、约定式 API 响应格式
 */
const sendResponse = (res, code = 200, data = null, msg = '操作成功') => {
  res.json({ code, data, msg });
};

/**
 * 【功能描述】
 * 分页获取题目列表，支持按类型和难度筛选。
 *
 * 【业务逻辑】
 * 1. 解析 type、difficulty、page、limit 查询参数。
 * 2. 构建 Supabase 查询并应用过滤与分页。
 * 3. 若表不存在，返回友好提示引导执行 SQL 脚本。
 *
 * 【技术实现】
 * - 涉及方法：supabase.from('questions').select().eq().range().order()
 * - 涉及知识点：Supabase 分页、PostgreSQL relation 错误识别
 */
router.get('/questions', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { type, difficulty, page = 1, limit = 10 } = req.query;

    // 构建查询
    let query = supabase
      .from('questions')
      .select('id,title,content,type,difficulty,code_template,topic,source,created_at', { count: 'exact' });

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
 * 【功能描述】
 * 根据 ID 获取单道题目详情。
 *
 * 【业务逻辑】
 * 1. 按路径参数 id 查询 questions 表。
 * 2. 未找到时返回 404。
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().eq().single()
 * - 涉及知识点：Express 参数路由、.single() 单行查询
 */
router.get('/questions/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id } = req.params;

    const { data, error } = await supabase
      .from('questions')
      .select('id,title,content,type,difficulty,code_template,topic,source,created_at')
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
 * 【功能描述】
 * 调用 DeepSeek AI 生成前端面试题并保存到数据库（前端调用，避免暴露 API Key）。
 *
 * 【业务逻辑】
 * 1. 解析 count（1–30）、topic、excludeTitles 参数。
 * 2. 收集已有题目标题，构造去重提示注入 Prompt。
 * 3. 调用 DeepSeek API 生成 JSON 数组格式的题目。
 * 4. 解析 AI 返回（清理 markdown 代码块），过滤重复标题后批量插入。
 * 5. 若批量插入触发唯一约束，降级为逐条插入并跳过重复项。
 *
 * 【技术实现】
 * - 涉及方法：fetch()、JSON.parse()、supabase.from().insert().select().in()
 * - 涉及知识点：DeepSeek Chat Completions API、temperature/top_p 采样、PostgreSQL 23505 唯一约束、Prompt Engineering
 */
router.post('/questions/generate', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { topic, count = 5, excludeTitles = [] } = req.body;

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

    // 构造主题相关的提示
    let topicHint = '';
    if (topic && topic.trim()) {
      topicHint = `\n\n**特别要求：${topic.trim()}**`;
    }

    // 默认提示词 - 增加了随机性和多样性要求
    const defaultPrompt = `你是资深前端面试官，请生成${validCount}道**全新的**前端面试题，包含理论题和手写编程题。${topicHint}
严格返回JSON数组，不要任何多余文字、markdown、解释。
字段：
title、content、type(theory/coding)、difficulty(easy/medium/hard)、code_template、reference_answer、scoring_rubric

要求：
- type 只能是 "theory" 或 "coding"
- difficulty 只能是 "easy"、"medium" 或 "hard"
- coding 类型的题目需要提供 code_template（代码模板）
- theory 类型的题目 code_template 可以为空字符串
- reference_answer 必须给出可用于判卷的参考答案
- scoring_rubric 必须给出 0-10 分的关键得分点
- **题目必须具有多样性和创新性，避免常见的基础题目**
- **每道题应从不同角度考察，避免重复考察同一知识点**
- 覆盖内容：JS 基础、原型链、闭包、异步编程、Promise、async/await、事件循环、防抖节流、深拷贝浅拷贝、数组扁平化、Vue3 响应式原理、Vue 生命周期、组合式 API、跨域解决方案、HTTP 缓存策略、性能优化技巧、并发控制、设计模式等${excludeHint}`;

    const prompt = defaultPrompt;

    console.log(`开始调用 DeepSeek API 生成 ${validCount} 道题目...`);
    if (existingTitlesList.length > 0) {
      console.log(`已存在 ${existingTitlesList.length} 道题目，将避免重复`);
    }

    const aiContent = await callDeepSeekText({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      topP: 0.95,
    });

    // 解析 AI 返回的 JSON
    let questions;
    try {
      questions = parseJsonContent(aiContent);
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
      code_template: q.code_template || '',
      topic: topic?.trim() || null,
      reference_answer: q.reference_answer || null,
      scoring_rubric: q.scoring_rubric || null,
      source: 'ai_generated'
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
 * 【功能描述】
 * 管理员批量生成 30 道前端面试题并保存（仅 weiqing 用户可操作）。
 *
 * 【业务逻辑】
 * 1. 校验 x-username 请求头或 username 查询参数为 weiqing。
 * 2. 调用 DeepSeek API 固定生成 30 道题。
 * 3. 解析 JSON、去重过滤、批量插入；唯一约束冲突时降级逐条插入。
 *
 * 【技术实现】
 * - 涉及方法：fetch()、supabase.from().insert()、req.headers / req.query 权限校验
 * - 涉及知识点：简易用户名鉴权、DeepSeek API、PostgreSQL 唯一约束降级处理
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
id、title、content、type(theory/coding)、difficulty(easy/medium/hard)、code_template、reference_answer、scoring_rubric

要求：
- id 为数字，从1到30
- type 只能是 "theory" 或 "coding"
- difficulty 只能是 "easy"、"medium" 或 "hard"
- coding 类型的题目需要提供 code_template（代码模板）
- theory 类型的题目 code_template 可以为空字符串
- reference_answer 必须给出可用于判卷的参考答案
- scoring_rubric 必须给出 0-10 分的关键得分点
- 覆盖内容：JS 基础、原型、闭包、异步、Promise、事件循环、防抖节流、深拷贝、数组扁平化、Vue3 响应式、Vue 原理、跨域、HTTP 缓存、性能优化、并发控制`;

    const aiContent = await callDeepSeekText({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      topP: 0.95,
    });

    // 解析 AI 返回的 JSON
    let questions;
    try {
      questions = parseJsonContent(aiContent);
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
      code_template: q.code_template || '',
      reference_answer: q.reference_answer || null,
      scoring_rubric: q.scoring_rubric || null,
      source: 'ai_generated'
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
 * 【功能描述】
 * 提交用户代码并由 DeepSeek AI 判题，结果写入 submissions 表。
 *
 * 【业务逻辑】
 * 1. 校验 question_id、title、content、user_code 必填。
 * 2. 构造判题 Prompt，调用 DeepSeek API（低 temperature 保证稳定性）。
 * 3. 简单解析 AI 回复是否包含"正确"判定 status。
 * 4. 保存提交记录；保存失败仍返回 AI 结果（带 warning）。
 *
 * 【技术实现】
 * - 涉及方法：fetch()、supabase.from('submissions').insert().select().single()
 * - 涉及知识点：DeepSeek system/user 双角色消息、temperature 控制、AI 结果持久化
 */
router.post('/judge', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { question_id, user_code } = req.body;

    // 参数验证
    if (!question_id || !user_code) {
      return sendResponse(res, 400, null, '缺少必要参数');
    }

    const { data: question, error: questionError } = await supabase
      .from('questions')
      .select('id,title,content,topic,reference_answer,scoring_rubric')
      .eq('id', question_id)
      .single();
    if (questionError || !question) return sendResponse(res, 404, null, '题目不存在');
    console.log(`开始判题 - 题目ID: ${question_id}, 题目: ${question.title}`);

    let referenceAnswer = question.reference_answer;
    let scoringRubric = question.scoring_rubric;
    if (!referenceAnswer || !scoringRubric) {
      const guide = await createQuestionEvaluationGuide({
        title: question.title,
        content: question.content,
        topic: question.topic || '',
      });
      referenceAnswer = guide.reference_answer;
      scoringRubric = guide.scoring_rubric;
      const { error: guideError } = await supabase.from('questions').update(guide).eq('id', question_id);
      if (guideError) return sendResponse(res, 500, null, '保存题目评分标准失败');
    }
    const grade = await gradeGrowthPractice({
      topic: question.topic || '',
      title: question.title,
      content: question.content,
      referenceAnswer,
      scoringRubric,
      userAnswer: user_code,
    });
    const status = grade.score >= 7 ? '正确' : '错误';
    const aiResult = JSON.stringify({ score: grade.score, feedback: grade.feedback });

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
        score: grade.score,
        feedback: grade.feedback,
        correct_answer: referenceAnswer,
        warning: '提交记录保存失败'
      }, '判题完成但保存记录失败');
    }

    sendResponse(res, 200, {
      submission_id: submissionData.id,
      ai_result: aiResult,
      status,
      score: grade.score,
      feedback: grade.feedback,
      correct_answer: referenceAnswer,
      created_at: submissionData.created_at
    });
  } catch (error) {
    console.error('AI 判题异常:', error);
    sendResponse(res, 500, null, '服务器内部错误');
  }
});

/**
 * 【功能描述】
 * 获取所有代码提交记录，关联题目标题。
 *
 * 【业务逻辑】
 * 1. 查询 submissions 表并 join questions 获取题目标题。
 * 2. 按 created_at 倒序排列。
 * 3. 格式化为扁平结构（question_title 替代嵌套 questions 对象）。
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select() 嵌套关联查询、.order()
 * - 涉及知识点：Supabase 外键关联 select、数据格式化映射
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
