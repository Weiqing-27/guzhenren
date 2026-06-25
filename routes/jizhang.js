const express = require('express');
const router = express.Router();

const authRoutes = require('./jizhang/auth');
const ledgerRoutes = require('./jizhang/ledgers');
const categoryRoutes = require('./jizhang/categories');
const transactionRoutes = require('./jizhang/transactions');
const statisticsRoutes = require('./jizhang/statistics');
const budgetRoutes = require('./jizhang/budgets');
const accountRoutes = require('./jizhang/accounts');
const settingsRoutes = require('./jizhang/settings');

router.use('/auth', authRoutes);
router.use('/ledgers', ledgerRoutes);
router.use('/categories', categoryRoutes);
router.use('/transactions', transactionRoutes);
router.use('/statistics', statisticsRoutes);
router.use('/budgets', budgetRoutes);
router.use('/accounts', accountRoutes);
router.use('/settings', settingsRoutes);

module.exports = router;
