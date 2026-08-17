const express = require("express");
const router = express.Router();

/**
 * 【功能描述】
 * 为 anyu 模块所有响应统一设置 UTF-8 字符集，避免中文乱码。
 *
 * 【业务逻辑】
 * 1. 拦截 anyu 子路由下的每个请求。
 * 2. 在继续后续处理前，将 Content-Type 设为 text/html; charset=utf-8。
 *
 * 【技术实现】
 * - 涉及方法：router.use、res.setHeader、next
 * - 涉及知识点：Express 中间件链、HTTP 响应头编码
 */
router.use((req, res, next) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  next();
});

// 导入子路由模块
const billRoutes = require('./anyu/bills');
const categoryRoutes = require('./anyu/categories');
const statisticRoutes = require('./anyu/statistics');
const emotionalRoutes = require('./anyu/emotional');
const mealPlanRoutes = require('./anyu/mealPlans');

// 挂载子路由
router.use('/bills', billRoutes);
router.use('/categories', categoryRoutes);
router.use('/statistics', statisticRoutes);
router.use('/emotional', emotionalRoutes);
router.use('/meal-plans', mealPlanRoutes);

module.exports = router;
