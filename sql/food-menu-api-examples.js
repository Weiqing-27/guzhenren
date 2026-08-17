/**
 * 【功能描述】
 * 情侣点餐模块 uniapp / 浏览器调用示例（仅示例，不参与服务端运行）。
 *
 * 【业务逻辑】
 * 1. 封装 uni.request / uni.uploadFile
 * 2. 演示菜品 CRUD、图片上传、下单与订单查询
 *
 * 【技术实现】
 * - 涉及方法：uni.request、uni.uploadFile、JSON.parse
 * - 涉及知识点：统一响应 { code, data, msg }、multipart 字段名 file
 *
 * 用法：复制到 uniapp 项目 utils/foodMenuApi.js，改 BASE_URL 即可
 */

const BASE_URL = 'http://localhost:3001/api'

/**
 * 【功能描述】
 * 通用 JSON 请求，解析 { code, data, msg }。
 *
 * 【业务逻辑】
 * code === 200 视为成功并 resolve data，否则 reject msg。
 *
 * 【技术实现】
 * - 涉及方法：uni.request
 * - 涉及知识点：Promise 封装、Content-Type application/json
 */
function request(path, method, data) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${BASE_URL}${path}`,
      method,
      data: data || {},
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        const body = res.data || {}
        if (body.code === 200) {
          resolve(body.data)
        } else {
          reject(new Error(body.msg || '请求失败'))
        }
      },
      fail: (err) => reject(err),
    })
  })
}

/** GET /api/food/list  获取上架菜品；管理端传 is_active=all 看全部 */
function getFoodList(params = {}) {
  return request('/food/list', 'GET', params)
}

/** POST /api/food/add  新增菜品 */
function addFood(payload) {
  return request('/food/add', 'POST', payload)
}

/** PUT /api/food/edit  修改菜品，必须带 id */
function editFood(payload) {
  return request('/food/edit', 'PUT', payload)
}

/** DELETE /api/food/remove  删除菜品 */
function removeFood(id) {
  return request(`/food/remove?id=${encodeURIComponent(id)}`, 'DELETE')
}

/**
 * 【功能描述】
 * 上传菜品图片：uni.chooseImage 得到临时路径后调用。
 *
 * 【业务逻辑】
 * 1. 字段名必须为 file，与后端 multer.single('file') 对应
 * 2. 成功返回 data.image_url，写入菜品的 image_url 字段
 *
 * 【技术实现】
 * - 涉及方法：uni.uploadFile、JSON.parse
 * - 涉及知识点：multipart/form-data，不要手动设 Content-Type
 */
function uploadFoodImage(filePath) {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${BASE_URL}/food/upload`,
      filePath,
      name: 'file',
      success: (res) => {
        try {
          const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
          if (body.code === 200) {
            resolve(body.data)
          } else {
            reject(new Error(body.msg || '上传失败'))
          }
        } catch (error) {
          reject(error)
        }
      },
      fail: (err) => reject(err),
    })
  })
}

/** POST /api/order/create  勾选菜品下单，成功后后端推送公众号 */
function createOrder(payload) {
  return request('/order/create', 'POST', payload)
}

/** GET /api/order/list  历史订单 */
function getOrderList(page = 1, pageSize = 20) {
  return request('/order/list', 'GET', { page, pageSize })
}

/** GET /api/order/:id  订单详情 */
function getOrderDetail(id) {
  return request(`/order/${id}`, 'GET')
}

/** DELETE /api/order/:id  删除订单 */
function deleteOrder(id) {
  return request(`/order/${id}`, 'DELETE')
}

/**
 * 典型页面流程示例（不要在生产直接执行，仅作对照）
 *
 * 1) 选图并新增菜品
 *    const [temp] = (await uni.chooseImage({ count: 1 })).tempFilePaths
 *    const { image_url } = await uploadFoodImage(temp)
 *    await addFood({ name: '番茄炒蛋', category: '热菜', price: 12, image_url, desc: '家常' })
 *
 * 2) 点餐页拉取上架菜品
 *    const list = await getFoodList({ category: '热菜' })
 *
 * 3) 提交订单（food_list 可只传 id + quantity，后端会补名称价格）
 *    const order = await createOrder({
 *      food_list: [{ id: list[0].id, quantity: 2 }, { id: list[1].id, quantity: 1 }],
 *      remark: '少辣，不要香菜'
 *    })
 *    // order.notify 可查看公众号是否推送成功
 *
 * 4) 历史订单
 *    const { list: orders, total } = await getOrderList(1, 20)
 */

module.exports = {
  getFoodList,
  addFood,
  editFood,
  removeFood,
  uploadFoodImage,
  createOrder,
  getOrderList,
  getOrderDetail,
  deleteOrder,
}
