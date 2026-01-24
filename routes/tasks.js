const express = require('express');
const router = express.Router();

// 获取Supabase客户端
const getSupabaseClient = (req) => req.app.get('supabase');

// 获取任务列表
router.get('/', async (req, res) => {
  try {
    const { category, status, priority, plan_type, page = 1, size = 10 } = req.query;
    const supabase = getSupabaseClient(req);

    let query = supabase.from('tasks').select('*', { count: 'exact' });

    // 根据参数过滤
    if (category) query = query.eq('category', category);
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);

    // 分页
    const offset = (page - 1) * size;
    query = query.range(offset, offset + parseInt(size) - 1).order('created_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      code: 200,
      message: 'success',
      data: {
        records: data.map(item => ({
          id: item.id,
          title: item.title,
          description: item.description,
          category: item.category,
          priority: item.priority,
          progress: item.progress,
          startDate: item.start_date,
          endDate: item.end_date,
          status: item.status,
          createTime: item.created_at
        })),
        total: count || 0,
        current: parseInt(page),
        size: parseInt(size)
      }
    });
  } catch (error) {
    console.error('获取任务列表错误:', error);
    res.status(500).json({
      code: 500,
      message: error.message || '获取任务列表失败',
      data: null
    });
  }
});

// 获取任务统计信息 (具体路由必须在参数路由之前定义)
router.get('/stats', async (req, res) => {
  try {
    const { category } = req.query;
    const supabase = getSupabaseClient(req);

    // 基础统计查询
    let baseQuery = supabase.from('tasks').select('*', { count: 'exact' });
    
    if (category) {
      baseQuery = baseQuery.eq('category', category);
    }

    const { error: countError, count: totalCount } = await baseQuery;
    if (countError) throw countError;

    // 各状态统计
    const getStatusCount = async (status) => {
      let query = supabase.from('tasks').select('*', { count: 'exact' }).eq('status', status);
      if (category) query = query.eq('category', category);
      const { count, error } = await query;
      if (error) throw error;
      return count;
    };

    // 各分类统计
    const getCategoryCount = async (cat) => {
      let query = supabase.from('tasks').select('*', { count: 'exact' }).eq('category', cat);
      if (category && category !== cat) return 0;
      const { count, error } = await query;
      if (error) throw error;
      return count;
    };

    const completedCount = await getStatusCount('completed');
    const inProgressCount = await getStatusCount('in-progress');
    
    const workTasks = await getCategoryCount('work');
    const studyTasks = await getCategoryCount('study');
    const projectTasks = await getCategoryCount('project');

    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    res.json({
      code: 200,
      message: 'success',
      data: {
        total: totalCount,
        completed: completedCount,
        inProgress: inProgressCount,
        workTasks,
        studyTasks,
        projectTasks,
        completionRate
      }
    });
  } catch (error) {
    console.error('获取任务统计错误:', error);
    res.status(500).json({
      code: 500,
      message: error.message || '获取任务统计失败',
      data: null
    });
  }
});

// 获取周/月/年任务统计 (具体路由必须在参数路由之前定义)
router.get('/plans/stats', async (req, res) => {
  try {
    const { plan_type } = req.query;
    const supabase = getSupabaseClient(req);

    // 检查task_plans表是否存在
    try {
      let query = supabase.from('task_plans').select('*', { count: 'exact' });
      if (plan_type) {
        query = query.eq('plan_type', plan_type);
      }
      
      const { count: totalPlans, error } = await query;
      
      if (error) {
        // 如果task_plans表不存在或其他错误，返回默认值
        if (error.code === '42P01' || error.message.includes('does not exist')) {
          // 表不存在，返回默认值
          return res.json({
            code: 200,
            message: 'success',
            data: {
              totalPlans: 0,
              completedPlans: 0,
              inProgressPlans: 0
            }
          });
        }
        throw error;
      }

      const getPlanStatusCount = async (status) => {
        let statusQuery = supabase.from('task_plans').select('*', { count: 'exact' }).eq('status', status);
        if (plan_type) statusQuery = statusQuery.eq('plan_type', plan_type);
        const { count, error } = await statusQuery;
        if (error) throw error;
        return count;
      };

      const completedPlans = await getPlanStatusCount('completed');
      const inProgressPlans = totalPlans - completedPlans; // 简化计算
      
      res.json({
        code: 200,
        message: 'success',
        data: {
          totalPlans,
          completedPlans,
          inProgressPlans
        }
      });
    } catch (tableError) {
      // 如果task_plans表不存在，返回默认值
      if (tableError.code === '42P01' || tableError.message.includes('does not exist')) {
        return res.json({
          code: 200,
          message: 'success',
          data: {
            totalPlans: 0,
            completedPlans: 0,
            inProgressPlans: 0
          }
        });
      }
      throw tableError;
    }
  } catch (error) {
    console.error('获取计划统计错误:', error);
    res.status(500).json({
      code: 500,
      message: error.message || '获取计划统计失败',
      data: null
    });
  }
});

// 获取指定时间段的任务 (具体路由必须在参数路由之前定义)
router.get('/time-range', async (req, res) => {
  try {
    const { startTime, endTime, category } = req.query;
    const supabase = getSupabaseClient(req);

    if (!startTime || !endTime) {
      return res.status(400).json({
        code: 400,
        message: '开始时间和结束时间不能为空',
        data: null
      });
    }

    let query = supabase
      .from('tasks')
      .select('id, title, description, category, priority, progress, start_date, end_date, status');

    // 时间范围过滤：任务的开始日期或结束日期在指定范围内
    query = query.lte('start_date', endTime).gte('end_date', startTime);

    // 分类过滤
    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      code: 200,
      message: 'success',
      data: data.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        category: item.category,
        priority: item.priority,
        progress: item.progress,
        startDate: item.start_date,
        endDate: item.end_date,
        status: item.status
      }))
    });
  } catch (error) {
    console.error('获取时间范围内任务错误:', error);
    res.status(500).json({
      code: 500,
      message: error.message || '获取时间范围内任务失败',
      data: null
    });
  }
});

// 获取任务详情 (参数路由必须放在具体路由之后)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient(req);

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    res.json({
      code: 200,
      message: 'success',
      data: {
        id: data.id,
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
        progress: data.progress,
        startDate: data.start_date,
        endDate: data.end_date,
        status: data.status,
        createTime: data.created_at,
        updateTime: data.updated_at
      }
    });
  } catch (error) {
    console.error('获取任务详情错误:', error);
    res.status(500).json({
      code: 500,
      message: error.message || '获取任务详情失败',
      data: null
    });
  }
});

// 创建任务
router.post('/', async (req, res) => {
  try {
    const { title, description, category, priority, progress, startDate, endDate } = req.body;
    const supabase = getSupabaseClient(req);

    // 验证必要参数
    if (!title) {
      return res.status(400).json({
        code: 400,
        message: '任务标题不能为空',
        data: null
      });
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert([
        {
          title,
          description: description || '',
          category: category || 'work',
          priority: priority || 'medium',
          progress: progress !== undefined ? progress : 0,
          start_date: startDate,
          end_date: endDate,
          status: 'todo'
        }
      ])
      .select();

    if (error) throw error;

    res.json({
      code: 200,
      message: '任务创建成功',
      data: {
        id: data[0].id
      }
    });
  } catch (error) {
    console.error('创建任务错误:', error);
    res.status(500).json({
      code: 500,
      message: error.message || '任务创建失败',
      data: null
    });
  }
});

// 更新任务
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, priority, progress, startDate, endDate, status } = req.body;
    const supabase = getSupabaseClient(req);

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (priority !== undefined) updateData.priority = priority;
    if (progress !== undefined) updateData.progress = progress;
    if (startDate !== undefined) updateData.start_date = startDate;
    if (endDate !== undefined) updateData.end_date = endDate;
    if (status !== undefined) updateData.status = status;

    // 更新updated_at时间戳
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', id)
      .select();

    if (error) throw error;

    res.json({
      code: 200,
      message: '任务更新成功',
      data: {}
    });
  } catch (error) {
    console.error('更新任务错误:', error);
    res.status(500).json({
      code: 500,
      message: error.message || '任务更新失败',
      data: null
    });
  }
});

// 删除任务
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient(req);

    // 删除相关的计划记录
    await supabase
      .from('task_plans')
      .delete()
      .eq('task_id', id);

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({
      code: 200,
      message: '任务删除成功',
      data: {}
    });
  } catch (error) {
    console.error('删除任务错误:', error);
    res.status(500).json({
      code: 500,
      message: error.message || '任务删除失败',
      data: null
    });
  }
});

// 更新任务状态
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { progress, status } = req.body;
    const supabase = getSupabaseClient(req);

    const updateData = {};
    if (progress !== undefined) updateData.progress = progress;
    if (status !== undefined) updateData.status = status;

    // 更新updated_at时间戳
    updateData.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;

    res.json({
      code: 200,
      message: '任务状态更新成功',
      data: {}
    });
  } catch (error) {
    console.error('更新任务状态错误:', error);
    res.status(500).json({
      code: 500,
      message: error.message || '任务状态更新失败',
      data: null
    });
  }
});

module.exports = router;