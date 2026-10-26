// These routes use custom JWTs, not Supabase Auth tokens. Never expose the service client to browsers.
function serverClient(req) {
  if (!req.user?.userId) throw Object.assign(new Error('需要登录'), { status: 401 });
  const client = req.app.get('supabaseAdmin');
  if (!client || req.app.get('hasSupabaseServiceRole') !== true) throw Object.assign(new Error('服务端数据库未配置'), { status: 503 });
  return client;
}
function pagination(query, fallback = 10, max = 100) {
  const positive = (value, defaultValue) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : defaultValue;
  const page = Math.min(positive(query.page, 1), 1000000);
  const limit = Math.min(positive(query.limit ?? query.pageSize ?? query.size, fallback), max);
  return { page, limit, offset: (page - 1) * limit };
}
function replyError(res, error, message = '操作失败，请稍后重试') {
  const status = error.status || 500;
  if (status >= 500) console.error(message, error.code || error.message);
  const publicMessage = status < 500 || status === 503 ? error.message : message;
  return res.status(status).json({ code: status, message: publicMessage, msg: publicMessage, data: null });
}
function badRequest(message) { throw Object.assign(new Error(message), { status: 400 }); }
function notFound() { throw Object.assign(new Error('记录不存在'), { status: 404 }); }
module.exports = { serverClient, pagination, replyError, badRequest, notFound };
