# 前端面试题系统 - 数据库设置指南

## 步骤 1: 在 Supabase Dashboard 中创建表

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)
2. 选择你的项目
3. 进入 **SQL Editor**
4. 复制并执行 `sql/create_questions_tables.sql` 文件中的全部内容

## 步骤 2: 验证表是否创建成功

执行以下 SQL 查询验证：

```sql
-- 检查 questions 表
SELECT count(*) FROM questions;

-- 检查 submissions 表
SELECT count(*) FROM submissions;
```

## 步骤 3: 测试 API

启动服务器后，访问以下端点进行测试：

### 获取题目列表
```bash
curl http://localhost:3001/api/questions
```

### 获取单题详情
```bash
curl http://localhost:3001/api/questions/1
```

### AI 生成题目（仅 weiqing 用户）
```bash
curl "http://localhost:3001/api/admin/generate-questions?username=weiqing"
```

### 提交代码判题
```bash
curl -X POST http://localhost:3001/api/judge \
  -H "Content-Type: application/json" \
  -d '{
    "question_id": 1,
    "title": "测试题目",
    "content": "请实现一个防抖函数",
    "user_code": "function debounce(fn, delay) { return fn; }"
  }'
```

### 获取提交记录
```bash
curl http://localhost:3001/api/submissions
```

## API 响应格式

所有接口统一返回格式：
```json
{
  "success": true/false,
  "data": {...},
  "msg": "错误信息（可选）"
}
```
