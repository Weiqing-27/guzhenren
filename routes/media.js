const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const getSupabase = (req) => req.app.get('supabaseAdmin');
const canAccessUser = (req, userId) => req.user.userId === userId || req.user.role === 'admin';

router.post('/media', authenticate, async (req, res) => {
  const { title, description, media_type, media_url, thumbnail_url } = req.body || {};
  if (!media_url) {
    return res.status(400).json({ code: 400, msg: '媒体地址不能为空' });
  }

  try {
    const { data, error } = await getSupabase(req)
      .from('couple_media')
      .insert([{
        title: title || '',
        description: description || '',
        media_type: media_type || 'image',
        media_url,
        thumbnail_url: thumbnail_url || null,
        user_id: req.user.userId,
      }])
      .select()
      .single();

    if (error) {
      console.error('添加媒体记录错误:', error);
      return res.status(500).json({
        code: 500,
        msg: error.code === '23503'
          ? '媒体表用户外键尚未迁移，请先执行媒体用户迁移 SQL'
          : '添加媒体记录失败',
        details: error.message,
      });
    }

    return res.status(201).json({ code: 201, message: '媒体记录添加成功', data });
  } catch (error) {
    console.error('添加媒体记录异常:', error);
    return res.status(500).json({ code: 500, msg: '服务器错误', details: error.message });
  }
});

router.get('/media/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  if (!canAccessUser(req, userId)) {
    return res.status(403).json({ code: 403, msg: '无权查看其他用户的媒体记录' });
  }

  try {
    const { data, error } = await getSupabase(req)
      .from('couple_media')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取媒体记录错误:', error);
      return res.status(500).json({ code: 500, msg: '获取媒体记录失败', details: error.message });
    }

    return res.json({ code: 200, message: '获取媒体记录成功', data: data || [] });
  } catch (error) {
    console.error('获取媒体记录异常:', error);
    return res.status(500).json({ code: 500, msg: '服务器错误', details: error.message });
  }
});

router.get('/media/detail/:id', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { data, error } = await supabase
      .from('couple_media')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) return res.status(500).json({ code: 500, msg: '获取媒体详情失败', details: error.message });
    if (!data) return res.status(404).json({ code: 404, msg: '媒体记录不存在' });
    if (!canAccessUser(req, data.user_id)) {
      return res.status(403).json({ code: 403, msg: '无权查看该媒体记录' });
    }

    const { data: owner } = await supabase
      .from('users')
      .select('username, avatar_url')
      .eq('user_id', data.user_id)
      .maybeSingle();

    return res.json({
      code: 200,
      message: '获取媒体详情成功',
      data: { ...data, user: owner || null, custom_user: owner || null },
    });
  } catch (error) {
    console.error('获取媒体详情异常:', error);
    return res.status(500).json({ code: 500, msg: '服务器错误', details: error.message });
  }
});

router.delete('/media/:id', authenticate, async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { data: media, error: findError } = await supabase
      .from('couple_media')
      .select('id, user_id')
      .eq('id', req.params.id)
      .maybeSingle();

    if (findError) return res.status(500).json({ code: 500, msg: '查询媒体记录失败', details: findError.message });
    if (!media) return res.status(404).json({ code: 404, msg: '媒体记录不存在' });
    if (!canAccessUser(req, media.user_id)) {
      return res.status(403).json({ code: 403, msg: '无权删除该媒体记录' });
    }

    const { error } = await supabase.from('couple_media').delete().eq('id', media.id);
    if (error) return res.status(500).json({ code: 500, msg: '删除媒体记录失败', details: error.message });

    return res.json({ code: 200, message: '删除成功', data: null });
  } catch (error) {
    console.error('删除媒体记录异常:', error);
    return res.status(500).json({ code: 500, msg: '服务器错误', details: error.message });
  }
});

module.exports = router;
