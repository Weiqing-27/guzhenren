/**
 * 【功能描述】
 * 记账（铢墨记）模块根路由，聚合各子模块 API 并挂载到统一前缀下。
 *
 * 【业务逻辑】
 * 1. 按功能域拆分 auth、账本、分类、流水、统计、预算、账户、资产、设置等子路由。
 * 2. 客户端通过 /jizhang/* 访问各业务能力，无需关心内部文件结构。
 *
 * 【技术实现】
 * - 涉及方法：express.Router、router.use
 * - 涉及知识点：Express 子路由挂载、模块化路由组织
 */
const express = require('express');
const router = express.Router();

const authRoutes = require('./jizhang/auth');
const ledgerRoutes = require('./jizhang/ledgers');
const categoryRoutes = require('./jizhang/categories');
const transactionRoutes = require('./jizhang/transactions');
const statisticsRoutes = require('./jizhang/statistics');
const budgetRoutes = require('./jizhang/budgets');
const accountRoutes = require('./jizhang/accounts');
const assetsRoutes = require('./jizhang/assets');
const settingsRoutes = require('./jizhang/settings');

router.use('/auth', authRoutes);
router.use('/ledgers', ledgerRoutes);
router.use('/categories', categoryRoutes);
router.use('/transactions', transactionRoutes);
router.use('/statistics', statisticsRoutes);
router.use('/budgets', budgetRoutes);
router.use('/accounts', accountRoutes);
router.use('/assets', assetsRoutes);
router.use('/settings', settingsRoutes);

module.exports = router;
