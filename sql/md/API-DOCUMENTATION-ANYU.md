# 安隅APP API接口文档

## 概述
安隅APP是一个集财务管理、情感交流、餐饮计划于一体的综合性生活助手应用。

## 基础配置
- **基础URL**: `http://localhost:3001` (开发环境)
- **生产环境**: 部署后的实际域名
- **统一响应格式**: 
```json
{
  "code": 200,
  "message": "操作成功描述",
  "data": {}
}
```

## 1. 用户认证接口

### 1.1 用户注册
```
POST /api/auth/register
Content-Type: application/json

请求参数:
{
  "username": "string",     // 用户名 (3-20字符)
  "password": "string"      // 密码 (至少6位)
}

成功响应 (201):
{
  "code": 201,
  "message": "注册成功",
  "data": {
    "userId": "uuid",
    "username": "user123",
    "avatar_url": "https://ui-avatars.com/api/?name=U&background=random",
    "role": "user"
  }
}

失败响应 (400):
{
  "code": 400,
  "message": "用户名已存在"
}
```

### 1.2 用户登录
```
POST /api/auth/login
Content-Type: application/json

请求参数:
{
  "username": "string",
  "password": "string"
}

成功响应 (200):
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "userId": "uuid",
    "username": "user123",
    "avatar_url": "avatar_url",
    "role": "user"
  }
}

失败响应 (401):
{
  "code": 401,
  "message": "用户名或密码错误"
}
```

### 1.3 修改密码
```
POST /api/auth/password/change
Content-Type: application/json

请求参数:
{
  "userId": "uuid",
  "old_password": "string",
  "new_password": "string",
  "confirm_password": "string"
}

成功响应 (200):
{
  "code": 200,
  "message": "密码修改成功"
}

失败响应 (400):
{
  "code": 400,
  "message": "当前密码错误"
}
```

### 1.4 获取用户信息
```
GET /api/auth/profile/{userId}

成功响应 (200):
{
  "code": 200,
  "message": "获取用户信息成功",
  "data": {
    "userId": "uuid",
    "username": "user123",
    "avatar_url": "avatar_url",
    "role": "user",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

### 1.5 更新用户头像
```
PUT /api/auth/avatar
Content-Type: application/json

请求参数:
{
  "userId": "uuid",
  "avatarUrl": "string"
}

成功响应 (200):
{
  "code": 200,
  "message": "头像更新成功",
  "data": {
    "userId": "uuid",
    "username": "user123",
    "avatar_url": "new_avatar_url",
    "role": "user"
  }
}
```

## 2. 账单管理接口

### 2.1 获取账单列表
```
GET /api/anyu/bills
查询参数:
- page: 页码 (默认1)
- page_size: 每页数量 (默认10)
- category: 分类ID (可选)
- date_from: 开始日期 (可选, YYYY-MM-DD)
- date_to: 结束日期 (可选, YYYY-MM-DD)
- type: 账单类型 (income/outcome, 可选)

成功响应 (200):
{
  "code": 200,
  "message": "获取账单列表成功",
  "data": {
    "count": 100,
    "next": "/api/anyu/bills/?page=2&page_size=10",
    "previous": null,
    "results": [
      {
        "id": 1,
        "amount": 100.50,
        "type": "outcome",
        "description": "午餐费用",
        "date": "2024-01-15",
        "created_at": "2024-01-15T12:30:00Z",
        "category": {
          "id": 1,
          "name": "餐饮",
          "icon": "food"
        }
      }
    ]
  }
}
```

### 2.2 创建账单
```
POST /api/anyu/bills
Content-Type: application/json

请求参数:
{
  "amount": 100.50,
  "type": "outcome",
  "category_id": 1,
  "description": "午餐费用",
  "date": "2024-01-15"
}

成功响应 (201):
{
  "code": 201,
  "message": "账单创建成功",
  "data": {
    "id": 1,
    "amount": 100.50,
    "type": "outcome",
    "description": "午餐费用",
    "date": "2024-01-15",
    "created_at": "2024-01-15T12:30:00Z",
    "category": {
      "id": 1,
      "name": "餐饮"
    }
  }
}
```

### 2.3 获取单个账单
```
GET /api/anyu/bills/{id}

成功响应 (200):
{
  "code": 200,
  "message": "获取账单详情成功",
  "data": {
    "id": 1,
    "amount": 100.50,
    "type": "outcome",
    "description": "午餐费用",
    "date": "2024-01-15",
    "created_at": "2024-01-15T12:30:00Z",
    "updated_at": "2024-01-15T12:30:00Z",
    "category": {
      "id": 1,
      "name": "餐饮",
      "icon": "food"
    }
  }
}
```

### 2.4 更新账单
```
PUT /api/anyu/bills/{id}
Content-Type: application/json

请求参数:
{
  "amount": 150.00,
  "type": "outcome",
  "category_id": 2,
  "description": "晚餐费用",
  "date": "2024-01-15"
}

成功响应 (200):
{
  "code": 200,
  "message": "账单更新成功",
  "data": {
    "id": 1,
    "amount": 150.00,
    "type": "outcome",
    "description": "晚餐费用",
    "date": "2024-01-15",
    "updated_at": "2024-01-15T14:30:00Z",
    "category": {
      "id": 2,
      "name": "娱乐"
    }
  }
}
```

### 2.5 删除账单
```
DELETE /api/anyu/bills/{id}

成功响应 (204):
{
  "code": 204,
  "message": "账单删除成功"
}
```

## 3. 分类管理接口

### 3.1 获取分类列表
```
GET /api/anyu/categories
查询参数:
- type: 类型 (income/outcome, 可选)

成功响应 (200):
{
  "code": 200,
  "message": "获取分类列表成功",
  "data": {
    "results": [
      {
        "id": 1,
        "name": "餐饮",
        "type": "outcome",
        "icon": "food",
        "color": "#FF6B6B",
        "is_default": true
      }
    ]
  }
}
```

### 3.2 创建分类
```
POST /api/anyu/categories
Content-Type: application/json

请求参数:
{
  "name": "新分类",
  "type": "outcome",
  "icon": "custom",
  "color": "#FF6B6B"
}

成功响应 (201):
{
  "code": 201,
  "message": "分类创建成功",
  "data": {
    "id": 10,
    "name": "新分类",
    "type": "outcome",
    "icon": "custom",
    "color": "#FF6B6B",
    "is_default": false
  }
}
```

### 3.3 更新分类
```
PUT /api/anyu/categories/{id}
Content-Type: application/json

请求参数:
{
  "name": "更新的分类名",
  "icon": "updated",
  "color": "#4ECDC4"
}

成功响应 (200):
{
  "code": 200,
  "message": "分类更新成功",
  "data": {
    "id": 10,
    "name": "更新的分类名",
    "type": "outcome",
    "icon": "updated",
    "color": "#4ECDC4",
    "is_default": false
  }
}
```

### 3.4 删除分类
```
DELETE /api/anyu/categories/{id}

成功响应 (204):
{
  "code": 204,
  "message": "分类删除成功"
}
```

## 4. 统计数据接口

### 4.1 月度统计
```
GET /api/anyu/statistics/monthly
查询参数:
- year: 年份 (默认当前年)
- month: 月份 (默认当前月)

成功响应 (200):
{
  "code": 200,
  "message": "获取月度统计成功",
  "data": {
    "year": 2024,
    "month": 1,
    "totalIncome": 5000.00,
    "totalOutcome": 3000.00,
    "netBalance": 2000.00,
    "categoryStats": [
      {
        "categoryId": 1,
        "categoryName": "餐饮",
        "amount": 800.00,
        "percentage": 26.67
      }
    ],
    "dailyStats": [
      {
        "date": "2024-01-01",
        "income": 0,
        "outcome": 150.00
      }
    ]
  }
}
```

### 4.2 年度统计
```
GET /api/anyu/statistics/yearly
查询参数:
- year: 年份 (默认当前年)

成功响应 (200):
{
  "code": 200,
  "message": "获取年度统计成功",
  "data": {
    "year": 2024,
    "monthlySummary": [
      {
        "month": 1,
        "income": 5000.00,
        "outcome": 3000.00,
        "balance": 2000.00
      }
    ],
    "topCategories": [
      {
        "categoryName": "餐饮",
        "amount": 9600.00,
        "percentage": 32.00
      }
    ]
  }
}
```

## 5. 情感交流接口

### 5.1 获取情感事件列表
```
GET /api/anyu/emotional/events
查询参数:
- page: 页码 (默认1)
- page_size: 每页数量 (默认10)

成功响应 (200):
{
  "code": 200,
  "message": "获取情感事件列表成功",
  "data": {
    "count": 50,
    "next": "/api/anyu/emotional/events?page=2&page_size=10",
    "previous": null,
    "results": [
      {
        "id": 1,
        "title": "今天的开心事",
        "content": "遇到了老朋友...",
        "mood": "happy",
        "date": "2024-01-15",
        "created_at": "2024-01-15T20:00:00Z"
      }
    ]
  }
}
```

### 5.2 创建情感事件
```
POST /api/anyu/emotional/events
Content-Type: application/json

请求参数:
{
  "title": "事件标题",
  "content": "事件详细内容",
  "mood": "happy",
  "date": "2024-01-15"
}

成功响应 (201):
{
  "code": 201,
  "message": "情感事件创建成功",
  "data": {
    "id": 1,
    "title": "事件标题",
    "content": "事件详细内容",
    "mood": "happy",
    "date": "2024-01-15",
    "created_at": "2024-01-15T20:00:00Z"
  }
}
```

### 5.3 添加观点/反思
```
POST /api/anyu/emotional/perspectives
Content-Type: application/json

请求参数:
{
  "event_id": 1,
  "content": "我的看法是...",
  "perspective_type": "reflection"
}

成功响应 (201):
{
  "code": 201,
  "message": "观点添加成功",
  "data": {
    "id": 1,
    "content": "我的看法是...",
    "perspective_type": "reflection",
    "created_at": "2024-01-15T21:00:00Z",
    "event": {
      "id": 1,
      "title": "今天的开心事"
    }
  }
}
```

### 5.4 获取事件的观点列表
```
GET /api/anyu/emotional/events/{id}/perspectives

成功响应 (200):
{
  "code": 200,
  "message": "获取观点列表成功",
  "data": {
    "results": [
      {
        "id": 1,
        "content": "我的看法是...",
        "perspective_type": "reflection",
        "created_at": "2024-01-15T21:00:00Z"
      }
    ]
  }
}
```

## 6. 餐饮计划接口

### 6.1 获取食谱列表
```
GET /api/anyu/meal-plans/recipes
查询参数:
- category: 分类筛选 (可选)
- difficulty: 难度筛选 (可选)

成功响应 (200):
{
  "code": 200,
  "message": "获取食谱列表成功",
  "data": {
    "results": [
      {
        "id": 1,
        "name": "番茄炒蛋",
        "description": "经典家常菜",
        "category": "主食",
        "difficulty": "easy",
        "cooking_time": 15,
        "ingredients": ["鸡蛋", "番茄"],
        "steps": ["步骤1", "步骤2"],
        "created_at": "2024-01-15T10:00:00Z"
      }
    ]
  }
}
```

### 6.2 创建食谱
```
POST /api/anyu/meal-plans/recipes
Content-Type: application/json

请求参数:
{
  "name": "新食谱",
  "description": "食谱描述",
  "category": "主食",
  "difficulty": "easy",
  "cooking_time": 30,
  "ingredients": ["食材1", "食材2"],
  "steps": ["步骤1", "步骤2"]
}

成功响应 (201):
{
  "code": 201,
  "message": "食谱创建成功",
  "data": {
    "id": 2,
    "name": "新食谱",
    "description": "食谱描述",
    "category": "主食",
    "difficulty": "easy",
    "cooking_time": 30,
    "ingredients": ["食材1", "食材2"],
    "steps": ["步骤1", "步骤2"],
    "created_at": "2024-01-15T11:00:00Z"
  }
}
```

### 6.3 获取订单列表
```
GET /api/anyu/meal-plans/orders
查询参数:
- status: 状态筛选 (可选)
- date_from: 开始日期 (可选)
- date_to: 结束日期 (可选)

成功响应 (200):
{
  "code": 200,
  "message": "获取订单列表成功",
  "data": {
    "results": [
      {
        "id": 1,
        "scheduled_date": "2024-01-20",
        "servings": 2,
        "notes": "少放盐",
        "status": "pending",
        "created_at": "2024-01-15T12:00:00Z",
        "recipe": {
          "id": 1,
          "name": "番茄炒蛋",
          "cooking_time": 15
        }
      }
    ]
  }
}
```

### 6.4 创建订单
```
POST /api/anyu/meal-plans/orders
Content-Type: application/json

请求参数:
{
  "recipe_id": 1,
  "scheduled_date": "2024-01-20",
  "servings": 2,
  "notes": "少放盐"
}

成功响应 (201):
{
  "code": 201,
  "message": "订单创建成功",
  "data": {
    "id": 2,
    "scheduled_date": "2024-01-20",
    "servings": 2,
    "notes": "少放盐",
    "status": "pending",
    "created_at": "2024-01-15T13:00:00Z",
    "recipe": {
      "id": 1,
      "name": "番茄炒蛋"
    }
  }
}
```

### 6.5 更新订单状态
```
PATCH /api/anyu/meal-plans/orders/{id}/status
Content-Type: application/json

请求参数:
{
  "status": "confirmed"
}

成功响应 (200):
{
  "code": 200,
  "message": "订单状态更新成功",
  "data": {
    "id": 2,
    "scheduled_date": "2024-01-20",
    "servings": 2,
    "notes": "少放盐",
    "status": "confirmed",
    "created_at": "2024-01-15T13:00:00Z",
    "recipe": {
      "id": 1,
      "name": "番茄炒蛋"
    }
  }
}
```

## 错误响应格式

所有接口的错误响应遵循统一格式:
```
HTTP状态码 400/401/403/404/500

{
  "code": 400,
  "message": "错误描述信息",
  "error": "详细错误信息"
}
```

## 数据格式要求

- **日期格式**: YYYY-MM-DD
- **时间格式**: YYYY-MM-DDTHH:MM:SSZ
- **金额格式**: 数字，最多两位小数
- **颜色格式**: #RRGGBB (十六进制)
- **情绪状态**: happy, sad, angry, neutral, excited, anxious
- **观点类型**: reflection, insight, action
- **难度等级**: easy, medium, hard
- **订单状态**: pending, confirmed, completed, cancelled

## 接口调用示例

### 使用fetch调用示例
```javascript
// 获取账单列表
const response = await fetch('http://localhost:3001/api/anyu/bills?page=1&page_size=10', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
console.log(data);
```

### 使用axios调用示例
```javascript
import axios from 'axios';

// 创建账单
const response = await axios.post('http://localhost:3001/api/anyu/bills', {
  amount: 100.50,
  type: 'outcome',
  category_id: 1,
  description: '午餐费用',
  date: '2024-01-15'
}, {
  headers: {
    'Content-Type': 'application/json'
  }
});

console.log(response.data);
```

## 注意事项

1. 所有接口均通过 `/api` 前缀访问
2. 请求体必须使用 JSON 格式
3. 响应数据统一包装在 `data` 字段中
4. 分页接口包含 `next` 和 `previous` 字段用于导航
5. 时间相关的字段使用 ISO 8601 格式
6. 建议在生产环境中使用 HTTPS