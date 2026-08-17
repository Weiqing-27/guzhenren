/**
 * 【功能描述】
 * Vercel Serverless 入口：将 /api/scores 请求转发至 Express 应用
 *
 * 【业务逻辑】
 * 1. 复用项目根 index.js 中已配置的 Express 实例
 * 2. 在 Serverless 环境中以同一套路由与中间件处理 HTTP 请求
 *
 * 【技术实现】
 * - 涉及方法：require('../../index.js')、app(req, res)
 * - 涉及知识点：Vercel Serverless Functions、Express 适配器模式
 */
const app = require('../../index.js');

/**
 * 【功能描述】
 * Serverless 处理函数，透传 req/res 给 Express
 *
 * 【业务逻辑】
 * 1. 接收 Vercel 平台传入的 req、res 对象
 * 2. 交给 Express app 统一完成路由匹配与响应
 *
 * 【技术实现】
 * - 涉及方法：module.exports 默认导出、app(req, res)
 * - 涉及知识点：无状态 Serverless 与单体 Express 复用
 */
module.exports = (req, res) => {
  return app(req, res);
};
