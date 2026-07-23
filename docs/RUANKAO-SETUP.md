# 软考复习模块 · 数据库与题库导入

## 1. 建表（Supabase SQL Editor）

依次执行：

1. `sql/create-ruankao-tables.sql`
2. `sql/alter-ruankao-external-id.sql`（若建表脚本已含 `external_id` 可跳过）
3. `sql/alter-ruankao-disable-rls.sql`（关闭 RLS，避免前端接口读不到数据）

## 2. 从 GitHub 导入结构化题库

可用来源：[IHKYoung/RuanKao](https://github.com/IHKYoung/RuanKao)（`classic-100` / `three-hundred` / `case-bank`）

```bash
# 经典100 + 精炼300 + 章节知识选择题 + 案例知识卡
npm run db:ruankao-import

# 仅导入经典与300题
node scripts/import-ruankao-ihkyoung.js --only=classic,three

# 章节题库限量
node scripts/import-ruankao-ihkyoung.js --only=knowledge --limit=800
```

脚本会自动从 GitHub raw 下载 JSON 到 `scripts/ruankao-sources/`（已 gitignore）。

## 3. AI 出题

配置 `.env`：

```
DEEPSEEK_API_KEY=你的密钥
```

接口：`POST /api/ruankao/generate`  
前端软考页「刷题练习」有「AI 生成练习题」按钮。

## 4. 不建议导入的来源

- `ruankaodaren/ruankao`：多为**官方教材 PDF**，版权归属官方/出版社，勿批量入库转卖或公开分发
- `leig0098/pm-knowledge-fill-in-quiz-v1.1`：是「出题 Skill 模板」，不是现成题库；其规则已融入 AI 出题提示词思路

## API 前缀

`/api/ruankao/*`（需登录 Bearer Token）
