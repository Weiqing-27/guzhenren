const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { uploadAvatarFromBase64, validateNickname } = require('../../utils/jizhangAvatar');

const router = express.Router();

function mapProfileResponse(profile, stats = {}) {
  return {
    id: profile.id,
    email: profile.email,
    nickname: profile.nickname,
    avatar_url: profile.avatar_url,
    profile_completed: !!profile.profile_completed,
    recordCount: stats.recordCount || 0,
    recordDays: stats.recordDays || 0,
  };
}

async function getProfileStats(supabase, userId) {
  const { count } = await supabase
    .from('jz_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { data: days } = await supabase
    .from('jz_transactions')
    .select('date')
    .eq('user_id', userId);

  const uniqueDays = new Set((days || []).map((d) => d.date)).size;
  return { recordCount: count || 0, recordDays: uniqueDays };
}

router.get('/', authenticate, async (req, res) => {
  const supabase = req.app.get('supabase');
  const { data, error } = await supabase
    .from('jz_user_settings')
    .select('*')
    .eq('user_id', req.user.userId)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ code: 500, message: '获取失败', error: error.message });
  }

  return res.json({ code: 200, message: '获取成功', data });
});

router.put('/', authenticate, async (req, res) => {
  const supabase = req.app.get('supabase');
  const allowed = [
    'current_ledger_id',
    'monthly_budget_total',
    'currency',
    'currency_symbol',
    'notification',
    'salary_day',
  ];
  const payload = { user_id: req.user.userId, updated_at: new Date().toISOString() };
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) payload[key] = req.body[key];
  });

  if (payload.salary_day !== undefined) {
    const day = parseInt(payload.salary_day, 10);
    if (!Number.isFinite(day) || day < 1 || day > 28) {
      return res.status(400).json({ code: 400, message: '发薪日需为 1-28 的整数' });
    }
    payload.salary_day = day;
  }

  const { data, error } = await supabase
    .from('jz_user_settings')
    .upsert(payload)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ code: 500, message: '更新失败', error: error.message });
  }

  return res.json({ code: 200, message: '更新成功', data });
});

router.get('/profile', authenticate, async (req, res) => {
  const supabase = req.app.get('supabase');
  const { data, error } = await supabase
    .from('jz_user_profiles')
    .select('*')
    .eq('id', req.user.userId)
    .single();

  if (error) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  const stats = await getProfileStats(supabase, req.user.userId);
  return res.json({
    code: 200,
    message: '获取成功',
    data: mapProfileResponse(data, stats),
  });
});

router.put('/profile', authenticate, async (req, res) => {
  const supabase = req.app.get('supabase');
  const { nickname, avatar_base64, avatar_url } = req.body;

  const nickCheck = validateNickname(nickname);
  if (!nickCheck.ok) {
    return res.status(400).json({ code: 400, message: nickCheck.message });
  }

  let finalAvatarUrl = avatar_url;
  if (avatar_base64) {
    try {
      finalAvatarUrl = await uploadAvatarFromBase64(req.user.userId, avatar_base64);
    } catch (e) {
      return res.status(400).json({ code: 400, message: e.message });
    }
  }

  const updatePayload = {
    nickname: nickCheck.value,
    profile_completed: true,
    updated_at: new Date().toISOString(),
  };
  if (finalAvatarUrl !== undefined) {
    updatePayload.avatar_url = finalAvatarUrl;
  }

  const { data, error } = await supabase
    .from('jz_user_profiles')
    .update(updatePayload)
    .eq('id', req.user.userId)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ code: 500, message: '更新失败', error: error.message });
  }

  const stats = await getProfileStats(supabase, req.user.userId);
  return res.json({
    code: 200,
    message: '资料已保存',
    data: mapProfileResponse(data, stats),
  });
});

module.exports = router;
