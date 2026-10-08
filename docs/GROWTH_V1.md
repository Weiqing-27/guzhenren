# 前端工程师成长系统 V1

## 范围

V1 提供一条可独立使用的学习闭环：12 个月 Roadmap、知识卡片、学习日志、练习与作答、项目与里程碑、周/月复盘、Dashboard 和基础统计。

新模块不会修改现有 `tasks`、`diaries`、`questions` 或 `submissions` 数据。所有新表都使用 `growth_` 前缀，便于独立验证和回滚。

## 发布前准备

1. 在 Supabase SQL Editor 中执行 `sql/20260914-growth-v1.sql`。
2. 后端环境必须配置 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 和 `JWT_SECRET`。
3. 部署后端，并验证 `GET /api/v1/growth/health` 返回 `growth-v1`。
4. 部署前端后，使用已有账号登录并进入 `/growth`。
5. 首次进入时点击“启用 12 个月路线”，种子数据会按当前用户创建且不会覆盖旧业务表。

不要在 Serverless 冷启动时自动执行数据库迁移，也不要把 `SUPABASE_SERVICE_ROLE_KEY` 或 `JWT_SECRET` 配置为 `VITE_` 前缀变量。

## 安全模型

- 页面继续使用现有自定义 JWT 登录，后端 `authenticate` 中间件负责解析可信 `userId`。
- 新 API 不接受请求体中的 `user_id`，每次查询和写入都使用 `req.user.userId`。
- `growth_*` 表启用 RLS，且没有 anon/authenticated 直连策略；只有后端 service role 可以访问。
- 练习列表和未作答的详情不会返回 `reference_answer`，首次提交后才返回参考内容。
- 知识和项目使用归档，学习日志才执行硬删除。

## API 根路径

`/api/v1/growth`

主要资源：

- `GET /health`：模块探活，无需登录。
- `GET /me`：当前用户的成长设置。
- `GET /dashboard`：当前路线、月任务、日志、项目、连续学习和周/月统计。
- `GET /roadmaps`、`POST /roadmaps/initialize`、`GET /roadmaps/:id`。
- `PATCH /roadmap-tasks/:id`。
- `GET/POST /knowledge`、`PATCH/DELETE /knowledge/:id`。
- `GET/POST /learning-logs`、`PATCH/DELETE /learning-logs/:id`。
- `GET/POST /practices`、`GET /practices/:id`、`POST /practices/:id/attempts`。
- `GET/POST /projects`、`GET/PATCH/DELETE /projects/:id`。
- `POST /projects/:id/milestones`、`PATCH /project-milestones/:id`。
- `GET/POST /reviews`、`GET /reviews/preview`。
- `GET /statistics/overview`。

## 固定统计口径

- 月进度：当前月非 skipped 任务中，done 任务权重之和除以总权重。
- 有效学习日：当天学习日志的 `duration_minutes` 大于 0。
- 连续学习：按本地学习日期向前计算；今天没有记录时允许从昨天开始。
- 复盘快照：创建复盘时由服务端生成并保存，之后不重算。

## 回滚

应用回滚只需回退前后端版本或隐藏“成长系统”导航。数据库表继续保留，不需要立即删除。若确认不再使用，另行备份后再安排删除 `growth_*` 表，不应把删表加入普通应用回滚。
