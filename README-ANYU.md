# 安隅APP后端服务

## 项目简介

安隅APP是一个集财务管理、情感交流、餐饮计划于一体的综合性生活助手应用。提供账本记录、收支统计、情感日记、食谱管理等功能。

## 功能模块

### 1. 用户认证
- 用户注册/登录
- 密码修改
- 用户信息管理

### 2. 账单管理
- 创建/编辑/删除账单
- 按分类、日期、类型筛选账单
- 支持收入和支出记录

### 3. 分类管理
- 自定义收支分类
- 系统默认分类
- 分类图标和颜色设置

### 4. 统计分析
- 月度收支统计
- 年度财务分析
- 分类占比分析
- 日趋势图表

### 5. 情感交流
- 记录日常情感事件
- 添加观点和反思
- 情绪状态跟踪

### 6. 餐饮计划
- 食谱创建和管理
- 餐饮订单安排
- 食材和步骤记录

## 技术架构

- **后端框架**: Express.js v5.1.0
- **数据库**: Supabase (PostgreSQL)
- **认证**: bcrypt密码加密
- **部署**: 支持Vercel部署

## 快速开始

### 1. 环境准备
```bash
# 安装依赖
npm install

# 创建环境变量文件
cp .env.example .env
```

### 2. 配置环境变量
在 `.env` 文件中配置：
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
PORT=3001
```

### 3. 初始化数据库
```bash
# 方法1: 使用Node.js脚本
npm run db:create-tables

# 方法2: 使用SQL脚本
# 在Supabase控制台执行 create-anyu-tables.sql
```

### 4. 启动服务
```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

## API接口文档

### 认证相关
```
POST /api/auth/register        # 用户注册
POST /api/auth/login           # 用户登录
POST /api/auth/password/change # 修改密码
GET  /api/auth/profile/:userId # 获取用户信息
PUT  /api/auth/avatar          # 更新头像
```

### 账单管理
```
GET    /api/anyu/bills              # 获取账单列表
POST   /api/anyu/bills              # 创建账单
GET    /api/anyu/bills/:id          # 获取单个账单
PUT    /api/anyu/bills/:id          # 更新账单
DELETE /api/anyu/bills/:id          # 删除账单
```

### 分类管理
```
GET    /api/anyu/categories         # 获取分类列表
POST   /api/anyu/categories         # 创建分类
PUT    /api/anyu/categories/:id     # 更新分类
DELETE /api/anyu/categories/:id     # 删除分类
```

### 统计数据
```
GET /api/anyu/statistics/monthly    # 月度统计
GET /api/anyu/statistics/yearly     # 年度统计
```

### 情感交流
```
GET  /api/anyu/emotional/events              # 获取情感事件列表
POST /api/anyu/emotional/events              # 创建情感事件
POST /api/anyu/emotional/perspectives        # 添加观点反思
GET  /api/anyu/emotional/events/:id/perspectives # 获取事件观点
```

### 餐饮计划
```
GET  /api/anyu/meal-plans/recipes   # 获取食谱列表
POST /api/anyu/meal-plans/recipes   # 创建食谱
GET  /api/anyu/meal-plans/orders    # 获取订单列表
POST /api/anyu/meal-plans/orders    # 创建订单
PATCH /api/anyu/meal-plans/orders/:id/status # 更新订单状态
```

## 测试

```bash
# 运行功能测试
npm test

# 监听模式运行测试
npm run test:watch
```

## 数据库表结构

### 主要数据表
- `bills`: 账单记录表
- `categories`: 分类表
- `emotional_events`: 情感事件表
- `perspectives`: 观点反思表
- `recipes`: 食谱表
- `meal_orders`: 餐饮订单表

### 默认分类
系统预置了常用的收支分类：
- 收入：工资、奖金、投资收益、其他收入
- 支出：餐饮、交通、购物、娱乐、住房、医疗、教育、其他支出

## 部署说明

### Vercel部署
1. 连接GitHub仓库到Vercel
2. 配置环境变量
3. 部署完成后即可使用

### 本地部署
```bash
# 安装生产依赖
npm install --production

# 启动服务
npm start
```

## 错误处理

所有API接口都遵循统一的错误响应格式：
```json
{
  "code": 400,
  "message": "错误描述",
  "error": "详细错误信息"
}
```

## 开发规范

- 使用RESTful API设计
- 统一JSON响应格式
- 完善的日志记录
- 严格的输入验证
- 安全的密码处理

## 注意事项

1. 确保Supabase数据库连接正常
2. 生产环境请配置HTTPS
3. 定期备份重要数据
4. 监控API使用情况
5. 及时更新依赖包

## 技术支持

如有问题，请联系开发团队或查看相关文档。