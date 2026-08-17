const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { uploadAvatarFromBase64, validateNickname } = require('../../utils/jizhangAvatar');

const router = express.Router();

/**
 * 【功能描述】
 * 将 profile 行映射为 API 响应结构（含记账统计）。
 *
 * 【业务逻辑】
 * 1. 统一 nickname、avatar、profile_completed 等字段命名。
 * 2. 附加 recordCount、recordDays 供个人中心展示。
 *
 * 【技术实现】
 * - 涉及方法：mapProfileResponse
 * - 涉及知识点：DTO 映射
 */
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

/**
 * 【功能描述】
 * 统计用户记账笔数与记账天数（去重 date）。
 *
 * 【业务逻辑】
 * 1. recordCount 为 jz_transactions 总行数。
 * 2. recordDays 为不同 date 的数量。
 *
 * 【技术实现】
 * - 涉及方法：getProfileStats
 * - 涉及知识点：Supabase count、Set 去重
 */
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

/**
 * 【功能描述】
 * GET / — 获取用户记账设置（当前账本、预算、货币等）。
 *
 * 【业务逻辑】
 * 1. 从 jz_user_settings 按 user_id 读取单行配置。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/')
 * - 涉及知识点：maybeSingle、authenticate 路由级挂载
 */
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

/**
 * 【功能描述】
 * PUT / — 更新用户记账设置（白名单字段）。
 *
 * 【业务逻辑】
 * 1. 仅允许更新 current_ledger_id、monthly_budget_total、currency 等指定键。
 * 2. salary_day 须为 1–28 整数。
 *
 * 【技术实现】
 * - 涉及方法：router.put('/')
 * - 涉及知识点：upsert、字段白名单
 */
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

/**
 * 【功能描述】
 * GET /profile — 获取用户资料与记账统计。
 *
 * 【业务逻辑】
 * 1. 读取 jz_user_profiles 并附加 recordCount/recordDays。
 *
 * 【技术实现】
 * - 涉及方法：router.get('/profile')
 * - 涉及知识点：mapProfileResponse、getProfileStats
 */
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

/**
 * 【功能描述】
 * PUT /profile — 更新昵称与头像，标记资料已完善。
 *
 * 【业务逻辑】
 * 1. nickname 经 validateNickname 校验。
 * 2. avatar_base64 优先上传 Storage；也可直接传 avatar_url。
 * 3. 成功后 profile_completed 置 true。
 *
 * 【技术实现】
 * - 涉及方法：router.put('/profile')
 * - 涉及知识点：uploadAvatarFromBase64、update jz_user_profiles
 */
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
