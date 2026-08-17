/**
 * 【功能描述】
 * 情侣点餐菜单 & 订单模块根路由，聚合菜品与订单子路由。
 *
 * 【业务逻辑】
 * 1. /food → 菜品 CRUD + 图片上传
 * 2. /order → 下单、历史订单、详情、删除；下单成功后推送公众号
 *
 * 【技术实现】
 * - 涉及方法：express.Router、router.use
 * - 涉及知识点：Express 子路由挂载、模块化拆分
 *
 * 挂载：在 index.js 中 app.use('/api', foodMenuRoutes)
 * 最终路径：
 *   GET    /api/food/list
 *   POST   /api/food/add
 *   PUT    /api/food/edit
 *   DELETE /api/food/remove
 *   POST   /api/food/upload
 *   POST   /api/order/create
 *   GET    /api/order/list
 *   GET    /api/order/:id
 *   DELETE /api/order/:id
 */
const express = require('express')
const router = express.Router()

const foodRoutes = require('./foodMenu/food')
const orderRoutes = require('./foodMenu/order')

router.use('/food', foodRoutes)
router.use('/order', orderRoutes)

module.exports = router
