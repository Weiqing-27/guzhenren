# 记账本验证码登录 — 邮箱 + 手机双通道配置指南

在 **Vercel → guzhenren 项目 → Settings → Environment Variables** 中配置以下变量，然后重新部署。

---

## 一、公共配置（两种登录都需要）

```env
JIZHANG_OTP_MODE=local
SUPABASE_URL=你的supabase地址
SUPABASE_ANON_KEY=你的anon_key
SUPABASE_SERVICE_ROLE_KEY=你的service_role_key
JWT_SECRET=你的jwt密钥
```

`local` 模式：验证码由后端生成，通过 **SMTP 邮件** 或 **阿里云短信** 发出（不依赖 Supabase 默认邮件）。

---

## 二、邮箱验证码（阿里云邮件推送 SMTP）

### 1. 阿里云控制台操作

1. 登录 [阿里云邮件推送](https://dm.console.aliyun.com/)
2. **发信域名** → 添加域名（如 `weiqing23.cn`）→ 按提示在 DNS 添加验证记录
3. 域名验证通过后 → **SMTP 服务** → 创建 SMTP 密码
4. 记录 SMTP 地址（一般为 `smtpdm.aliyun.com`）

### 2. Vercel 环境变量

```env
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@mail.weiqing23.cn
SMTP_PASS=你的SMTP密码
SMTP_FROM=记账本 <noreply@mail.weiqing23.cn>
```

### 3. 验证

部署后调用：

```bash
curl -X POST https://www.weiqing23.cn/api/jizhang/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"你的测试邮箱@example.com"}'
```

成功应返回 `channel: smtp`，邮箱收到 6 位验证码。

---

## 三、手机验证码（阿里云短信）

### 1. 数据库

在 Supabase SQL Editor 执行 `sql/alter-jizhang-phone-otp.sql`（新建库可直接执行 `sql/create-jizhang-tables.sql`）。

### 2. 阿里云控制台操作

1. 登录 [短信服务控制台](https://dysms.console.aliyun.com/)
2. **国内消息** → **签名管理** → 申请签名（如「记账本」）
3. **模板管理** → 申请验证码模板，内容示例：

   ```
   您的验证码为${code}，10分钟内有效，请勿泄露。
   ```

   模板变量名必须是 **`code`**（与后端一致）
4. **AccessKey** → 创建 RAM 用户，授予 `AliyunDysmsFullAccess`，获取 AccessKey ID / Secret

### 3. Vercel 环境变量

```env
ALIYUN_SMS_ACCESS_KEY_ID=你的AccessKeyId
ALIYUN_SMS_ACCESS_KEY_SECRET=你的AccessKeySecret
ALIYUN_SMS_SIGN_NAME=记账本
ALIYUN_SMS_TEMPLATE_CODE=SMS_xxxxxxxx
```

### 4. 验证

```bash
curl -X POST https://www.weiqing23.cn/api/jizhang/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000"}'
```

成功应返回 `channel: aliyun_sms`，手机收到短信。

---

## 四、完整环境变量清单（复制到 Vercel）

```env
# 公共
JIZHANG_OTP_MODE=local
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=

# 邮箱 SMTP（阿里云邮件推送）
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM=记账本 <noreply@mail.你的域名.com>

# 手机短信（阿里云短信）
ALIYUN_SMS_ACCESS_KEY_ID=
ALIYUN_SMS_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=
```

---

## 五、前端

登录页已固定展示 **邮箱登录** / **手机登录** 两个入口。重新发行 H5 并部署前端即可。

---

## 六、常见问题

| 现象 | 处理 |
|------|------|
| 接口 200 但收不到邮件 | 检查 SMTP 变量是否配全；看 Vercel 日志 `[jizhang]` |
| 邮件进垃圾箱 | 正常，提醒用户查看垃圾箱；完善发信域名 SPF/DKIM |
| 短信发送失败 | 看返回错误；确认签名/模板已审核通过 |
| 验证码错误 | 10 分钟过期；勿混用邮箱/手机通道的码 |
| 本地开发 | `NODE_ENV` 非 production 时未配置通道会在控制台打印验证码 |
