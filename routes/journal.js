/**
 * 【功能描述】
 * 个人日记 journal 模块根路由：独立账号、加密传输、公开/内层双空间。
 *
 * 【业务逻辑】
 * 1. /auth/register|login 仅校验请求信封，不要求登录；
 * 2. 其余接口必须 journal JWT；
 * 3. 内层读写依赖短期 X-Scope-Token，默认全部走 public。
 *
 * 【技术实现】
 * - 涉及方法：express.Router、journalAuth
 * - 涉及知识点：模块前缀 /api/journal、受众隔离
 */
const express = require('express');
const router = express.Router();

const { journalAuth } = require('./journal/authMiddleware');
const authRoutes = require('./journal/auth');
const gateRoutes = require('./journal/gate');
const profileRoutes = require('./journal/profile');
const entriesRoutes = require('./journal/entries');

router.use('/auth', authRoutes);
router.use('/gate', journalAuth, gateRoutes);
router.use('/profile', journalAuth, profileRoutes);
router.use('/entries', journalAuth, entriesRoutes);

module.exports = router;
