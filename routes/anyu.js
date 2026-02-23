const express = require("express");
const router = express.Router();

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