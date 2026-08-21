/*
 * 【功能描述】
 * 个人日记 journal 模块说明：独立账号、AES 传输/存储、公开与内层双空间。
 *
 * 【业务逻辑】
 * 1. 执行 sql/create-journal-tables.sql
 * 2. 配置 DIARY_* 与 SUPABASE_SERVICE_ROLE_KEY
 * 3. 前端墨笺项目请求 /api/journal/*
 *
 * 【技术实现】
 * - 涉及接口：/api/journal/auth、/gate、/profile、/entries
 * - 涉及知识点：HMAC 防篡改、space_type 强制过滤、短期 X-Scope-Token
 */

# 个人日记模块（journal）

与旧版公开 `diaries` 接口相互独立，不要混用。

## 1. 执行 SQL

在 Supabase SQL Editor 执行：

`sql/create-journal-tables.sql`

表已开启 RLS 且未对 anon 授权，后端必须使用 `SUPABASE_SERVICE_ROLE_KEY`。

## 2. 环境变量（与前端保持 AES/HMAC 一致）

```
DIARY_AES_KEY=diary-dev-aes-key-change-me
DIARY_HMAC_KEY=diary-dev-hmac-key-change-me
DIARY_STORAGE_KEY=diary-dev-storage-key-change-me
DIARY_VAULT_STORAGE_KEY=diary-dev-vault-storage-key-change-me
```

生产环境请全部改成足够长的随机串。`DIARY_VAULT_STORAGE_KEY` 仅用于内层日记存储加密，不要下发到前端。

## 3. 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/journal/auth/register | 注册 |
| POST | /api/journal/auth/login | 登录 |
| POST | /api/journal/auth/refresh | 刷新 token |
| POST | /api/journal/gate | 设置/校验内层口令，返回 10 分钟短期令牌 |
| GET | /api/journal/profile | 当前空间统计 |
| PUT | /api/journal/profile/password | 修改登录密码 |
| PUT | /api/journal/profile/settings | 自动保存等 |
| * | /api/journal/entries | 日记 CRUD，默认 public；带头 X-Scope-Token 才读写 secret |

所有请求需带 `X-Timestamp`、`X-Nonce`、`X-Sign`；写操作 body 为 `{ payload: 密文 }`。
