/**
 * 安隅APP前端集成示例
 * 展示如何调用各种API接口
 */

// API基础配置
const API_BASE_URL = 'http://localhost:3001';
const API_CONFIG = {
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
};

// API客户端封装
class AnyuAPIClient {
  constructor() {
    this.baseURL = API_CONFIG.baseURL;
    this.token = localStorage.getItem('authToken') || null;
  }

  // 设置认证token
  setToken(token) {
    this.token = token;
    localStorage.setItem('authToken', token);
  }

  // 清除认证token
  clearToken() {
    this.token = null;
    localStorage.removeItem('authToken');
  }

  // 通用请求方法
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

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || '请求失败');
      }

      return data;
    } catch (error) {
      console.error('API请求错误:', error);
      throw error;
    }
  }

  // 用户认证相关接口
  auth = {
    // 用户注册
    register: async (userData) => {
      return this.request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(userData)
      });
    },

    // 用户登录
    login: async (credentials) => {
      const response = await this.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
      });
      
      // 登录成功后保存token
      if (response.code === 200 && response.data) {
        this.setToken(response.data.userId);
      }
      
      return response;
    },

    // 修改密码
    changePassword: async (passwordData) => {
      return this.request('/api/auth/password/change', {
        method: 'POST',
        body: JSON.stringify(passwordData)
      });
    },

    // 获取用户信息
    getProfile: async (userId) => {
      return this.request(`/api/auth/profile/${userId}`);
    },

    // 更新头像
    updateAvatar: async (avatarData) => {
      return this.request('/api/auth/avatar', {
        method: 'PUT',
        body: JSON.stringify(avatarData)
      });
    }
  };

  // 账单管理相关接口
  bills = {
    // 获取账单列表
    getList: async (params = {}) => {
      const queryParams = new URLSearchParams(params).toString();
      const endpoint = `/api/anyu/bills${queryParams ? '?' + queryParams : ''}`;
      return this.request(endpoint);
    },

    // 创建账单
    create: async (billData) => {
      return this.request('/api/anyu/bills', {
        method: 'POST',
        body: JSON.stringify(billData)
      });
    },

    // 获取单个账单
    getById: async (id) => {
      return this.request(`/api/anyu/bills/${id}`);
    },

    // 更新账单
    update: async (id, billData) => {
      return this.request(`/api/anyu/bills/${id}`, {
        method: 'PUT',
        body: JSON.stringify(billData)
      });
    },

    // 删除账单
    delete: async (id) => {
      return this.request(`/api/anyu/bills/${id}`, {
        method: 'DELETE'
      });
    }
  };

  // 分类管理相关接口
  categories = {
    // 获取分类列表
    getList: async (params = {}) => {
      const queryParams = new URLSearchParams(params).toString();
      const endpoint = `/api/anyu/categories${queryParams ? '?' + queryParams : ''}`;
      return this.request(endpoint);
    },

    // 创建分类
    create: async (categoryData) => {
      return this.request('/api/anyu/categories', {
        method: 'POST',
        body: JSON.stringify(categoryData)
      });
    },

    // 更新分类
    update: async (id, categoryData) => {
      return this.request(`/api/anyu/categories/${id}`, {
        method: 'PUT',
        body: JSON.stringify(categoryData)
      });
    },

    // 删除分类
    delete: async (id) => {
      return this.request(`/api/anyu/categories/${id}`, {
        method: 'DELETE'
      });
    }
  };

  // 统计数据相关接口
  statistics = {
    // 月度统计
    getMonthly: async (year, month) => {
      const params = new URLSearchParams();
      if (year) params.append('year', year);
      if (month) params.append('month', month);
      
      const endpoint = `/api/anyu/statistics/monthly?${params.toString()}`;
      return this.request(endpoint);
    },

    // 年度统计
    getYearly: async (year) => {
      const params = new URLSearchParams();
      if (year) params.append('year', year);
      
      const endpoint = `/api/anyu/statistics/yearly?${params.toString()}`;
      return this.request(endpoint);
    }
  };

  // 情感交流相关接口
  emotional = {
    // 获取情感事件列表
    getEvents: async (params = {}) => {
      const queryParams = new URLSearchParams(params).toString();
      const endpoint = `/api/anyu/emotional/events${queryParams ? '?' + queryParams : ''}`;
      return this.request(endpoint);
    },

    // 创建情感事件
    createEvent: async (eventData) => {
      return this.request('/api/anyu/emotional/events', {
        method: 'POST',
        body: JSON.stringify(eventData)
      });
    },

    // 添加观点/反思
    addPerspective: async (perspectiveData) => {
      return this.request('/api/anyu/emotional/perspectives', {
        method: 'POST',
        body: JSON.stringify(perspectiveData)
      });
    },

    // 获取事件的观点列表
    getEventPerspectives: async (eventId) => {
      return this.request(`/api/anyu/emotional/events/${eventId}/perspectives`);
    }
  };

  // 餐饮计划相关接口
  mealPlans = {
    // 获取食谱列表
    getRecipes: async (params = {}) => {
      const queryParams = new URLSearchParams(params).toString();
      const endpoint = `/api/anyu/meal-plans/recipes${queryParams ? '?' + queryParams : ''}`;
      return this.request(endpoint);
    },

    // 创建食谱
    createRecipe: async (recipeData) => {
      return this.request('/api/anyu/meal-plans/recipes', {
        method: 'POST',
        body: JSON.stringify(recipeData)
      });
    },

    // 获取订单列表
    getOrders: async (params = {}) => {
      const queryParams = new URLSearchParams(params).toString();
      const endpoint = `/api/anyu/meal-plans/orders${queryParams ? '?' + queryParams : ''}`;
      return this.request(endpoint);
    },

    // 创建订单
    createOrder: async (orderData) => {
      return this.request('/api/anyu/meal-plans/orders', {
        method: 'POST',
        body: JSON.stringify(orderData)
      });
    },

    // 更新订单状态
    updateOrderStatus: async (orderId, status) => {
      return this.request(`/api/anyu/meal-plans/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
    }
  };
}

// 使用示例
const apiClient = new AnyuAPIClient();

// 1. 用户注册示例
async function registerUser() {
  try {
    const response = await apiClient.auth.register({
      username: 'newuser',
      password: 'password123'
    });
    console.log('注册成功:', response);
  } catch (error) {
    console.error('注册失败:', error);
  }
}

// 2. 用户登录示例
async function loginUser() {
  try {
    const response = await apiClient.auth.login({
      username: 'newuser',
      password: 'password123'
    });
    console.log('登录成功:', response);
  } catch (error) {
    console.error('登录失败:', error);
  }
}

// 3. 创建账单示例
async function createBill() {
  try {
    const response = await apiClient.bills.create({
      amount: 100.50,
      type: 'outcome',
      category_id: 1,
      description: '午餐费用',
      date: '2024-01-15'
    });
    console.log('账单创建成功:', response);
  } catch (error) {
    console.error('账单创建失败:', error);
  }
}

// 4. 获取账单列表示例
async function getBills() {
  try {
    const response = await apiClient.bills.getList({
      page: 1,
      page_size: 10,
      type: 'outcome'
    });
    console.log('账单列表:', response);
  } catch (error) {
    console.error('获取账单列表失败:', error);
  }
}

// 5. 获取月度统计示例
async function getMonthlyStats() {
  try {
    const response = await apiClient.statistics.getMonthly(2024, 1);
    console.log('月度统计:', response);
  } catch (error) {
    console.error('获取月度统计失败:', error);
  }
}

// 6. 创建情感事件示例
async function createEmotionalEvent() {
  try {
    const response = await apiClient.emotional.createEvent({
      title: '今天的开心事',
      content: '遇到了老朋友，聊得很开心',
      mood: 'happy',
      date: '2024-01-15'
    });
    console.log('情感事件创建成功:', response);
  } catch (error) {
    console.error('情感事件创建失败:', error);
  }
}

// 7. 创建食谱示例
async function createRecipe() {
  try {
    const response = await apiClient.mealPlans.createRecipe({
      name: '番茄炒蛋',
      description: '经典家常菜',
      category: '主食',
      difficulty: 'easy',
      cooking_time: 15,
      ingredients: ['鸡蛋2个', '番茄1个'],
      steps: ['步骤1: 准备食材', '步骤2: 开火炒制']
    });
    console.log('食谱创建成功:', response);
  } catch (error) {
    console.error('食谱创建失败:', error);
  }
}

// 导出API客户端供其他模块使用
export default AnyuAPIClient;
export { apiClient };

// Vue.js组合式API示例
/*
import { ref, reactive } from 'vue';
import AnyuAPIClient from './frontend-integration-example.js';

const api = new AnyuAPIClient();

export function useBills() {
  const bills = ref([]);
  const loading = ref(false);
  const error = ref(null);

  const loadBills = async (params) => {
    loading.value = true;
    error.value = null;
    
    try {
      const response = await api.bills.getList(params);
      bills.value = response.data.results;
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  };

  return {
    bills,
    loading,
    error,
    loadBills
  };
}
*/