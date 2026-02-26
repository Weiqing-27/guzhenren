# 安隅APP API 认证与数据隔离文档

## 🛡️ 认证机制

### JWT Token 认证
所有受保护的API端点都需要通过JWT (JSON Web Token) 进行认证。

### 认证流程

1. **用户注册/登录**
   ```
   POST /api/auth/register
   POST /api/auth/login
   ```

2. **获取Token**
   成功登录后，响应中会包含JWT token：
   ```json
   {
     "code": 200,
     "message": "登录成功",
     "data": {
       "userId": "用户ID",
       "username": "用户名",
       "avatar_url": "头像链接",
       "role": "用户角色",
       "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
     }
   }
   ```

3. **使用Token访问API**
   在后续请求的Authorization头中携带token：
   ```
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

## 🔐 受保护的API端点

以下anyu模块的所有端点都需要认证：

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
GET    /api/anyu/meal-plans                 # 获取餐饮计划列表
POST   /api/anyu/meal-plans                 # 创建餐饮计划
GET    /api/anyu/meal-plans/:id             # 获取单个餐饮计划
PUT    /api/anyu/meal-plans/:id             # 更新餐饮计划
PUT    /api/anyu/meal-plans/:id/status      # 更新餐饮计划状态
DELETE /api/anyu/meal-plans/:id             # 删除餐饮计划
```

## 🚫 错误响应

### 未认证访问
```json
{
  "code": 401,
  "message": "缺少认证信息",
  "error": "Authorization header is required"
}
```

### 无效Token
```json
{
  "code": 401,
  "message": "无效的token",
  "error": "Invalid or expired token"
}
```

### 权限不足
```json
{
  "code": 403,
  "message": "权限不足",
  "error": "Insufficient permissions"
}
```

## 🛡️ 数据隔离机制

### 用户数据隔离
- 每个用户的请求只能访问自己创建的数据
- 系统通过JWT token中的userId自动过滤数据
- 无法访问其他用户的数据

### 数据归属验证
- 创建数据时自动关联当前用户ID
- 查询时自动添加用户ID过滤条件
- 更新/删除操作会验证数据所有权

## 💡 前端集成示例

### JavaScript/TypeScript 示例
```javascript
class AuthenticatedApiClient {
  constructor() {
    this.token = localStorage.getItem('authToken') || null;
    this.baseURL = 'http://localhost:3001';
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('authToken', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('authToken');
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    // 添加认证头
    if (this.token) {
      config.headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(url, config);
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        // Token过期或无效，清除本地存储
        this.clearToken();
        // 可以触发重新登录流程
        window.location.href = '/login';
      }
      throw new Error(data.message || '请求失败');
    }

    return data;
  }

  // 账单相关方法
  async getBills(params = {}) {
    const queryParams = new URLSearchParams(params).toString();
    return this.request(`/api/anyu/bills${queryParams ? '?' + queryParams : ''}`);
  }

  async createBill(billData) {
    return this.request('/api/anyu/bills', {
      method: 'POST',
      body: JSON.stringify(billData)
    });
  }
}

// 使用示例
const apiClient = new AuthenticatedApiClient();

// 登录并保存token
async function login(username, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  
  const result = await response.json();
  if (result.code === 200) {
    apiClient.setToken(result.data.token);
  }
  return result;
}

// 获取账单列表
async function loadBills() {
  try {
    const bills = await apiClient.getBills({ page: 1, page_size: 10 });
    console.log('账单列表:', bills.data.bills);
  } catch (error) {
    console.error('获取账单失败:', error);
  }
}
```

### Vue.js 示例
```vue
<script>
import { ref } from 'vue'

export default {
  setup() {
    const bills = ref([])
    const loading = ref(false)
    const error = ref(null)
    
    const loadBills = async () => {
      loading.value = true
      error.value = null
      
      try {
        const token = localStorage.getItem('authToken')
        const response = await fetch('/api/anyu/bills', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        })
        
        const result = await response.json()
        if (result.code === 200) {
          bills.value = result.data.bills
        } else {
          throw new Error(result.message)
        }
      } catch (err) {
        error.value = err.message
        // 处理认证失败
        if (err.message.includes('认证')) {
          localStorage.removeItem('authToken')
          // 跳转到登录页
          window.location.href = '/login'
        }
      } finally {
        loading.value = false
      }
    }
    
    return {
      bills,
      loading,
      error,
      loadBills
    }
  }
}
</script>
```

## ⚠️ 安全注意事项

1. **Token存储**: 建议将token存储在localStorage或sessionStorage中
2. **Token过期**: 实现token刷新机制或重新登录流程
3. **HTTPS**: 生产环境务必使用HTTPS传输
4. **敏感操作**: 重要操作建议二次验证
5. **日志记录**: 记录认证失败的尝试，防范暴力破解

## 🔄 Token刷新机制（建议实现）

```javascript
// 检查token是否即将过期
function isTokenExpiringSoon(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp;
    const now = Math.floor(Date.now() / 1000);
    // 如果距离过期还有5分钟以内
    return (exp - now) < 300;
  } catch (error) {
    return true; // 解析失败认为需要刷新
  }
}

// 刷新token的方法（需要后端支持）
async function refreshToken() {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;
  
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    
    const result = await response.json();
    if (result.code === 200) {
      localStorage.setItem('authToken', result.data.token);
      return result.data.token;
    }
  } catch (error) {
    console.error('刷新token失败:', error);
  }
  return null;
}
```

---
*文档版本: v1.0 | 最后更新: 2024*