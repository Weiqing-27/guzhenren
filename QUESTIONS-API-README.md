# 前端面试题系统 - API 文档

## 概述

这是一个基于 Express + Supabase + DeepSeek AI 的前端面试题系统，提供题目管理、AI 自动生成题目、AI 判题等功能。

## 技术栈

- **后端框架**: Express.js
- **数据库**: Supabase (PostgreSQL)
- **AI 服务**: DeepSeek API (deepseek-chat)
- **认证**: 基于用户名的简单权限控制

## 环境变量配置

在 `.env` 文件中配置以下变量：

```env
SUPABASE_URL='your_supabase_url'
SUPABASE_ANON_KEY='your_anon_key'
SUPABASE_SERVICE_ROLE_KEY='your_service_role_key'
DEEPSEEK_API_KEY='sk-33aeca1763414dbcbf74571a1d52a9ad'
```

## 数据库表结构

### questions 表（题目表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGSERIAL | 主键 |
| title | VARCHAR(255) | 题目名称 |
| content | TEXT | 题目描述 |
| type | VARCHAR(50) | 类型: theory/coding |
| difficulty | VARCHAR(50) | 难度: easy/medium/hard |
| code_template | TEXT | 代码模板（编程题需要） |
| created_at | TIMESTAMP | 创建时间 |

### submissions 表（提交记录表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGSERIAL | 主键 |
| question_id | BIGINT | 关联题目ID |
| user_code | TEXT | 用户代码 |
| ai_result | TEXT | AI 判题原文 |
| status | VARCHAR(50) | 状态: 正确/错误 |
| created_at | TIMESTAMP | 创建时间 |

## 初始化数据库

**重要**: 首次使用前，需要在 Supabase Dashboard 中创建数据库表。

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)
2. 进入 SQL Editor
3. 复制并执行 `sql/create_questions_tables.sql` 文件的全部内容

或者运行以下命令检查表状态：
```bash
node init-questions-db.js
```

## API 接口

### 1. 获取题目列表

**接口**: `GET /api/questions`

**参数**:
- `type` (可选): 题目类型 `theory` 或 `coding`
- `difficulty` (可选): 难度 `easy`、`medium` 或 `hard`
- `page` (可选): 页码，默认 1
- `limit` (可选): 每页数量，默认 10

**返回示例**:
```json
{
  "code": 200,
  "data": {
    "list": [...],
    "total": 30,
    "page": 1,
    "limit": 10,
    "totalPages": 3
  },
  "msg": "操作成功"
}
```

### 2. 获取单题详情

**接口**: `GET /api/questions/:id`

**返回示例**:
```json
{
  "code": 200,
  "data": {
    "id": 1,
    "title": "实现防抖函数",
    "content": "请实现一个防抖函数...",
    "type": "coding",
    "difficulty": "medium",
    "code_template": "function debounce(fn, delay) {\n  // 你的代码\n}",
    "created_at": "2026-04-16T03:00:00.000Z"
  },
  "msg": "操作成功"
}
```

### 3. AI 辅助生成题目并保存到数据库（前端调用，不暴露 API Key）

**接口**: `POST /api/questions/generate`

**说明**: 此接口用于前端调用 DeepSeek API 生成题目，API Key 保存在后端，避免在前端暴露。生成的题目会自动保存到数据库。

**请求体**:
```json
{
  "count": 5,
  "prompt": "可选的自定义提示词"
}
```

**参数**:
- `count` (可选): 生成题目数量，范围 1-30，默认 5
- `prompt` (可选): 自定义提示词，不传则使用默认提示词

**功能**:
- 调用 DeepSeek API 生成指定数量的前端面试题
- 自动批量插入到 questions 表
- 返回生成的题目详情

**返回示例**:
```json
{
  "code": 200,
  "data": {
    "count": 5,
    "questions": [
      {
        "id": 1,
        "title": "什么是闭包？",
        "content": "请解释闭包的概念并举例说明",
        "type": "theory",
        "difficulty": "medium",
        "code_template": "",
        "created_at": "2026-04-16T03:00:00.000Z"
      }
    ]
  },
  "msg": "题目生成并保存成功"
}
```

**返回示例（有重复题目时）**:
```json
{
  "code": 200,
  "data": {
    "count": 3,
    "questions": [...],
    "duplicateCount": 2,
    "skippedCount": 2,
    "skippedTitles": ["什么是闭包？", "Promise 是什么？"]
  },
  "msg": "成功保存 3 道题目，跳过 2 道重复题目"
}
```

**防重复策略**:

1. **AI 生成层面**:
   - Prompt 中明确告知 AI 已存在的题目，要求生成不同的新题目
   - 提高 temperature (0.9) 和 top_p (0.95) 参数增加随机性
   - 自动从数据库获取已有题目列表作为参考

2. **数据库层面**:
   - 后端会在插入前检查题目标题是否已存在
   - 使用数据库唯一约束 `uk_questions_title` 防止重复
   - 自动跳过重复题目，只保存新题目
   - 返回结果中包含跳过的题目数量和标题列表

3. **前端可选参数**:
```json
{
  "count": 5,
  "excludeTitles": ["什么是闭包？", "Promise 是什么？"]  // 可选：指定要排除的题目
}
```

**使用示例**:
```bash
curl -X POST http://localhost:3001/api/questions/generate \
  -H "Content-Type: application/json" \
  -d '{
    "count": 5
  }'
```

**前端使用示例**:
```javascript
// 前端调用，API Key 不会暴露
const response = await fetch('/api/questions/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ count: 5 })
});
const result = await response.json();
console.log(result.data.questions); // 获取生成并保存的题目
```

### 4. AI 批量生成 30 道题目并保存到数据库（管理员专用）

**接口**: `GET /api/admin/generate-questions`

**权限**: 仅 `weiqing` 用户可操作

**参数**:
- `username` (查询参数或请求头 `x-username`): 必须为 `weiqing`

**功能**:
- 调用 DeepSeek API 生成 30 道前端面试题
- 包含理论题和编程题
- 自动批量插入数据库

**返回示例**:
```json
{
  "code": 200,
  "data": {
    "count": 30,
    "questions": [...]
  },
  "msg": "题目生成成功"
}
```

**使用示例**:
```bash
curl "http://localhost:3001/api/admin/generate-questions?username=weiqing"
```

### 5. 提交代码并 AI 判题

**接口**: `POST /api/judge`

**请求体**:
```json
{
  "question_id": 1,
  "title": "实现防抖函数",
  "content": "请实现一个防抖函数...",
  "user_code": "function debounce(fn, delay) { ... }"
}
```

**功能**:
- 接收用户提交的代码
- 调用 DeepSeek API 进行判题
- AI 扮演资深前端面试官
- 返回判题结果并保存提交记录

**返回示例**:
```json
{
  "code": 200,
  "data": {
    "submission_id": 1,
    "ai_result": "1. 是否正确：正确\n2. 错误原因：无...\n3. 标准答案代码：...\n4. 详细解析：...",
    "status": "正确",
    "created_at": "2026-04-16T03:00:00.000Z"
  },
  "msg": "操作成功"
}
```

**使用示例**:
```bash
curl -X POST http://localhost:3001/api/judge \
  -H "Content-Type: application/json" \
  -d '{
    "question_id": 1,
    "title": "实现防抖函数",
    "content": "请实现一个防抖函数",
    "user_code": "function debounce(fn, delay) { let timer; return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); }; }"
  }'
```

### 6. 获取提交记录

**接口**: `GET /api/submissions`

**返回示例**:
```json
{
  "code": 200,
  "data": [
    {
      "id": 1,
      "question_id": 1,
      "question_title": "实现防抖函数",
      "user_code": "function debounce(fn, delay) { ... }",
      "ai_result": "1. 是否正确：正确\n...",
      "status": "正确",
      "created_at": "2026-04-16T03:00:00.000Z"
    }
  ],
  "msg": "操作成功"
}
```

## 统一响应格式

所有接口均使用统一的响应格式，使用 `code` 状态码表示请求结果：

```json
{
  "code": 200,
  "data": {...} or null,
  "msg": "操作成功"
}
```

**状态码说明**:
- `200`: 请求成功
- `400`: 请求参数错误
- `403`: 权限不足
- `404`: 资源不存在
- `500`: 服务器内部错误

## AI Prompt 设计

### 题目生成 Prompt

```
你是资深前端面试官，生成30道前端面试题，包含理论题和手写编程题。
严格返回JSON数组，不要任何多余文字、markdown、解释。
字段：id、title、content、type(theory/coding)、difficulty(easy/medium/hard)、code_template

要求覆盖内容：
JS 基础、原型、闭包、异步、Promise、事件循环、防抖节流、深拷贝、数组扁平化、Vue3 响应式、Vue 原理、跨域、HTTP 缓存、性能优化、并发控制。
```

### 判题 Prompt

```
你是资深前端面试官，严格判题。
题目：{{title}}
描述：{{content}}
用户代码：{{userCode}}

请按以下四点返回，不要多余内容：
1. 是否正确（正确/错误）
2. 错误原因（没有则写无同时需要给出写题的答案写的怎么样写出锐评、当然如果写的好也要锐评）
3. 标准答案代码
4. 详细解析（知识点、原理、考点）
```

## 启动服务器

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

默认端口: 3001（可通过 `PORT` 环境变量修改）

## 测试流程

1. 首先在 Supabase Dashboard 中创建数据库表
2. 启动服务器
3. 调用 AI 生成题目接口创建初始题库
4. 获取题目列表查看生成的题目
5. 提交代码进行 AI 判题
6. 查看提交记录

## 文件结构

```
guzhenren/
├── routes/
│   └── questions.js          # 题目相关路由
├── sql/
│   └── create_questions_tables.sql  # 数据库建表脚本
├── .env                       # 环境变量
├── index.js                   # 主应用入口
├── init-questions-db.js       # 数据库初始化检查脚本
└── QUESTIONS-API-README.md    # 本文档
```

## 注意事项

1. **DeepSeek API Key**: 已配置在 `.env` 文件中，请勿泄露
2. **权限控制**: AI 生成题目接口仅限 `weiqing` 用户操作
3. **数据库表**: 首次使用前必须在 Supabase Dashboard 中执行建表 SQL
4. **错误处理**: 所有接口均有完善的错误捕获和统一响应格式
