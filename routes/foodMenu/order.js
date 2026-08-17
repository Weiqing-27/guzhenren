/**
 * 情侣点餐 - 订单路由
 * 挂载路径：/api/order
 *
 * POST   /create   创建订单，成功后推送微信公众号通知
 * GET    /list     历史订单
 * GET    /:id      单条订单详情
 * DELETE /:id      删除订单
 *
 * 注意：静态路径 /list、/create 必须写在 /:id 之前，避免被当成 id。
 */
const express = require('express')
const { notifyFoodOrder } = require('../../utils/wechatMpNotify')
const { db, ok, fail, genOrderSn, formatChinaTime, hydrateFoodList } = require('./helpers')

const router = express.Router()

/**
 * 【功能描述】
 * 整理订单返回结构，并计算清单总价（仅响应层，不落库）。
 *
 * 【业务逻辑】
 * total_price = Σ price * quantity；food_list 保证为数组。
 *
 * 【技术实现】
 * - 涉及方法：Array.reduce、Number
 * - 涉及知识点：订单快照金额汇总
 */
function shapeOrder(row) {
  if (!row) return row
  const foodList = Array.isArray(row.food_list) ? row.food_list : []
  const totalPrice = foodList.reduce((sum, item) => {
    const price = Number(item && item.price != null ? item.price : 0)
    const qty = Number(item && (item.quantity || item.qty) ? item.quantity || item.qty : 1) || 1
    return sum + price * qty
  }, 0)

  return {
    id: row.id,
    order_sn: row.order_sn,
    food_list: foodList,
    remark: row.remark || '',
    create_time: row.create_time,
    total_price: Number(totalPrice.toFixed(2)),
  }
}

/**
 * 【功能描述】
 * 创建点餐订单：写入 food_order 后自动推送公众号通知。
 *
 * 【业务逻辑】
 * 1. 校验 food_list 为非空数组
 * 2. hydrateFoodList 补全菜品快照（名称/价格/份数）
 * 3. 生成 order_sn，插入订单
 * 4. 插入成功后调用 notifyFoodOrder；推送失败不影响下单成功
 *
 * 【技术实现】
 * - 涉及方法：from().insert().select().single()、notifyFoodOrder
 * - 涉及知识点：订单快照、副作用解耦、公众号客服/模板消息
 *
 * 调用示例：POST /api/order/create
 *   { "food_list": [{ "id": "uuid", "quantity": 1 }], "remark": "少辣" }
 */
router.post('/create', async (req, res) => {
  const supabase = db(req)
  const body = req.body || {}
  const rawList = body.food_list || body.foodList

  if (!Array.isArray(rawList) || rawList.length === 0) {
    return fail(res, '请至少勾选一道菜品（food_list 不能为空）', 400)
  }

  try {
    const foodList = await hydrateFoodList(supabase, rawList)
    const remark = String(body.remark || '').trim()
    const orderSn = genOrderSn()

    const { data, error } = await supabase
      .from('food_order')
      .insert([
        {
          order_sn: orderSn,
          food_list: foodList,
          remark,
        },
      ])
      .select()
      .single()

    if (error) throw error

    const order = shapeOrder(data)
    let notify = null
    try {
      notify = await notifyFoodOrder({
        createTime: formatChinaTime(order.create_time),
        foodList: order.food_list,
        remark: order.remark,
      })
    } catch (notifyError) {
      console.error('[food-order] 公众号推送异常:', notifyError.message)
      notify = { ok: false, msg: notifyError.message || '公众号推送失败' }
    }

    return ok(
      res,
      { ...order, notify },
      notify && notify.ok ? '下单成功，已推送公众号通知' : '下单成功'
    )
  } catch (error) {
    console.error('[food-order] 创建订单失败:', error.message)
    return fail(res, error.message || '创建订单失败', 500)
  }
})

/**
 * 【功能描述】
 * 获取历史订单列表，按下单时间倒序。
 *
 * 【业务逻辑】
 * 1. 可选 page / pageSize 分页，默认第 1 页、20 条，最大 100
 * 2. 同时返回 total 便于前端分页
 *
 * 【技术实现】
 * - 涉及方法：select('*', { count: 'exact' })、range()
 * - 涉及知识点：PostgREST 分页与总数
 *
 * 调用示例：GET /api/order/list?page=1&pageSize=20
 */
router.get('/list', async (req, res) => {
  const supabase = db(req)
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  try {
    const { data, error, count } = await supabase
      .from('food_order')
      .select('*', { count: 'exact' })
      .order('create_time', { ascending: false })
      .range(from, to)

    if (error) throw error

    return ok(
      res,
      {
        list: (data || []).map(shapeOrder),
        page,
        pageSize,
        total: count || 0,
      },
      '获取订单列表成功'
    )
  } catch (error) {
    console.error('[food-order] 获取订单列表失败:', error.message)
    return fail(res, error.message || '获取订单列表失败', 500)
  }
})

/**
 * 【功能描述】
 * 按主键获取单条订单详情。
 *
 * 【业务逻辑】
 * 1. 校验 id
 * 2. 查不到返回 404
 *
 * 【技术实现】
 * - 涉及方法：from().select().eq().maybeSingle()
 * - 涉及知识点：maybeSingle 避免 0 行时报 PGRST116
 *
 * 调用示例：GET /api/order/:id
 */
router.get('/:id', async (req, res) => {
  const supabase = db(req)
  const { id } = req.params

  if (!id) {
    return fail(res, '缺少订单 id', 400)
  }

  try {
    const { data, error } = await supabase.from('food_order').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return fail(res, '订单不存在', 404)

    return ok(res, shapeOrder(data), '获取订单详情成功')
  } catch (error) {
    console.error('[food-order] 获取订单详情失败:', error.message)
    return fail(res, error.message || '获取订单详情失败', 500)
  }
})

/**
 * 【功能描述】
 * 按主键删除一条订单。
 *
 * 【业务逻辑】
 * 删除后返回被删 id；不存在则 404。
 *
 * 【技术实现】
 * - 涉及方法：from().delete().eq().select()
 * - 涉及知识点：删除回表确认影响行
 *
 * 调用示例：DELETE /api/order/:id
 */
router.delete('/:id', async (req, res) => {
  const supabase = db(req)
  const { id } = req.params

  if (!id) {
    return fail(res, '缺少订单 id', 400)
  }

  try {
    const { data, error } = await supabase.from('food_order').delete().eq('id', id).select()
    if (error) throw error
    if (!data || data.length === 0) {
      return fail(res, '订单不存在', 404)
    }

    return ok(res, { id }, '删除订单成功')
  } catch (error) {
    console.error('[food-order] 删除订单失败:', error.message)
    return fail(res, error.message || '删除订单失败', 500)
  }
})

module.exports = router
