# 记账本 API 接口文档

Base URL: `http://localhost:3001/api/jizhang`

## 认证（邮箱验证码）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/send-code` | 发送验证码 `{ email }` |
| POST | `/auth/verify-code` | 登录 `{ email, code }` → `{ token, userInfo }` |

登录后请求头：`Authorization: Bearer <token>`

## 账本

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/ledgers` | 账本列表 |
| POST | `/ledgers` | 创建 `{ name, icon?, color? }` |
| PUT | `/ledgers/:id` | 更新 |
| POST | `/ledgers/switch/:id` | 切换当前账本 |
| DELETE | `/ledgers/:id` | 删除 |

## 交易

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/transactions` | 列表 `ledger_id, date, year, month` |
| GET | `/transactions/grouped` | 按日期分组 |
| POST | `/transactions` | 记账 |
| DELETE | `/transactions/:id` | 删除 |

## 统计（前端统计页使用）

| 方法 | 路径 | 参数 |
|------|------|------|
| GET | `/statistics/overview` | `year, month, ledger_id?` |
| GET | `/statistics/last7days` | `type=expense\|income, ledger_id?` |
| GET | `/statistics/category` | `year, month, type, ledger_id?` |
| GET | `/statistics/yearly` | `year, ledger_id?` |
| GET | `/statistics/budget` | `month=YYYY-MM, ledger_id?` |

## 分类 / 预算 / 资产 / 设置

- `GET/POST /categories`
- `GET/POST /budgets`
- `GET/POST /accounts`
- `GET/PUT /settings`、`GET /settings/profile`

## 数据库

在 Supabase SQL Editor 执行：`sql/create-jizhang-tables.sql`

## 环境变量 (.env)

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # 本地验证码回退登录需要
JWT_SECRET=
PORT=3001
```

## Supabase 邮箱 OTP 配置

1. Authentication → Providers → Email → Enable
2. Email OTP 开启 6 位验证码
3. 开发环境若邮件发不出去，后端会在控制台打印 `devCode`
