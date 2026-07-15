# 铢墨记 API 接口文档

Base URL: `https://www.weiqing23.cn/api/jizhang`

## 认证（邮箱 / 手机验证码）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/auth/methods` | 可用登录方式 `{ email, phone, emailDelivery }` |
| POST | `/auth/send-code` | 发送验证码 `{ email }` 或 `{ phone }` |
| POST | `/auth/verify-code` | 登录 `{ email, code }` 或 `{ phone, code }` |

登录后请求头：`Authorization: Bearer <token>`

---

## 验证码收不到？（生产环境必读）

### 原因说明

后端有两种发码模式（`JIZHANG_OTP_MODE`）：

| 模式 | 行为 |
|------|------|
| `local`（**推荐生产**） | 验证码存数据库，由 **你自己的 SMTP / Resend / 阿里云短信** 发出 |
| `supabase` | 由 Supabase Auth 发邮件（国内常进垃圾箱或只发 Magic Link） |

**以前的问题**：`local` 模式只把验证码打在服务器日志里，**没有真正发邮件**，所以用户点「获取验证码」看似成功，但邮箱里什么都没有。

### 方案 A：SMTP 发邮件（国内推荐，阿里云邮件推送 / QQ 企业邮）

在 **Vercel 后端** 环境变量添加：

```env
JIZHANG_OTP_MODE=local

# 任选其一：SMTP（推荐国内）
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的发信地址
SMTP_PASS=SMTP密码
SMTP_FROM=铢墨记 <noreply@你的域名.com>

SUPABASE_SERVICE_ROLE_KEY=...   # 本地验证码登录必需
```

阿里云邮件推送：控制台 → 邮件推送 → 发信域名 → 创建 SMTP 密码。

### 方案 B：Resend 发邮件（海外邮箱较稳）

```env
JIZHANG_OTP_MODE=local
RESEND_API_KEY=re_xxxx
RESEND_FROM=铢墨记 <onboarding@resend.dev>
```

### 方案 C：继续用 Supabase 邮件

```env
JIZHANG_OTP_MODE=supabase
```

并在 Supabase 控制台：

1. **Authentication → Providers → Email** → 开启
2. **Authentication → Email Templates → Magic Link** 模板中加入 `{{ .Token }}`（6 位验证码）
3. **Project Settings → Auth → SMTP Settings** 配置自定义 SMTP（不要用 Supabase 默认发信，限额低且国内难收）

### 方案 D：手机短信（国内用户推荐）

1. 在 Supabase 执行 `sql/alter-jizhang-phone-otp.sql`
2. 开通阿里云短信，创建签名 + 模板（变量名 `code`）
3. Vercel 环境变量：

```env
ALIYUN_SMS_ACCESS_KEY_ID=
ALIYUN_SMS_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=你的签名
ALIYUN_SMS_TEMPLATE_CODE=SMS_xxxx
```

4. 后端安装（部署时 package.json 已含 nodemailer，短信需额外）：

```bash
npm install @alicloud/pop-core
```

配置完成后，登录页会自动显示「手机号」选项。

---

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
| PUT | `/transactions/:id` | 更新 |
| DELETE | `/transactions/:id` | 删除 |

## 统计

| 方法 | 路径 | 参数 |
|------|------|------|
| GET | `/statistics/overview` | `year, month, ledger_id?`（省略则全账号汇总） |
| GET | `/statistics/last7days` | `type=expense\|income, period?, ledger_id?` |
| GET | `/statistics/category` | `year, month, type, period?, ledger_id?` |
| GET | `/statistics/yearly` | `year, ledger_id?` |
| GET | `/statistics/budget` | `month=YYYY-MM, ledger_id?` |

默认按**用户账号**跨账本统计；仅当显式传 `ledger_id` 时按单账本过滤。  
「本月」区间由设置中的 `salary_day`（发薪日，1–28）决定，默认 1（自然月）。

## 分类 / 预算 / 资产 / 设置

- `GET/POST /categories`
- `GET/POST /budgets`（GET 省略 `ledger_id` 时返回账号下全部预算）
- `GET/POST /accounts`、`PUT/DELETE /accounts/:id`
- `GET /assets/overview`：净资产 = 账户资产 − 账户负债（不叠流水）；收支默认跨账本
- `GET/PUT /settings`（含 `salary_day`）、`GET/PUT /settings/profile`（昵称允许特殊符号）

交易 `type` 支持 `income | expense | transfer`（还款/转账：`account_id` 转出，`to_account_id` 转入）。

## 数据库

- 建表：`sql/create-jizhang-tables.sql`
- 发薪日与转账字段：`sql/alter-jizhang-salary-transfer.sql`
- 手机 OTP：`sql/alter-jizhang-phone-otp.sql`

## 环境变量汇总

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
JIZHANG_OTP_MODE=local

# 邮件（SMTP 或 Resend 二选一）
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
# RESEND_API_KEY=
# RESEND_FROM=

# 手机短信（可选）
# ALIYUN_SMS_ACCESS_KEY_ID=
# ALIYUN_SMS_ACCESS_KEY_SECRET=
# ALIYUN_SMS_SIGN_NAME=
# ALIYUN_SMS_TEMPLATE_CODE=
```
