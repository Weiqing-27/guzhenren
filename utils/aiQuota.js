const { serverClient } = require('./webAccess');
// Enforced atomically in PostgreSQL, shared by all Vercel/server instances. Fail closed if not migrated.
async function consumeAiQuota(req, action, units = 1) {
  const limits = { judge: [100, 10], generate: [100, 10], ruankao_generate: [100, 10] };
  const [dailyLimit, minuteLimit] = limits[action] || [50, 5];
  const { data, error } = await serverClient(req).rpc('consume_web_ai_quota', {
    p_user_id: req.user.userId, p_action: action, p_units: units,
    p_daily_limit: dailyLimit, p_minute_limit: minuteLimit,
  });
  if (error) throw Object.assign(new Error('AI额度服务未就绪，请联系管理员执行迁移'), { status: 503 });
  if (!data) throw Object.assign(new Error('请求过于频繁或今日AI额度已用完，请稍后再试'), { status: 429 });
}
module.exports = { consumeAiQuota };
