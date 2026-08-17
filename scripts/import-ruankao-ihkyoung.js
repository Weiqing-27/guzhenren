/**
 * 从 IHKYoung/RuanKao 公开仓库导入高项选择题到 Supabase
 *
 * 【功能描述】
 * 离线/半离线脚本：下载 GitHub 公开 JSON 题库，映射为本地表结构后批量 upsert
 *
 * 【业务逻辑】
 * 1. 解析 CLI 参数（--only、--limit）决定导入范围
 * 2. 按需下载 classic-100、three-hundred、case-bank 源文件
 * 3. 将选择题写入 ruankao_questions，案例写入 ruankao_knowledge
 * 4. 导入完成后输出库内总量
 *
 * 【技术实现】
 * - 涉及方法：fetch、fs、createClient、upsert/onConflict
 * - 涉及知识点：CLI 脚本、HTML 清洗、external_id 去重、批量写入降级
 *
 * 用法：
 *   node scripts/import-ruankao-ihkyoung.js
 *   node scripts/import-ruankao-ihkyoung.js --only=classic,three
 *   node scripts/import-ruankao-ihkyoung.js --only=knowledge --limit=800
 *   node scripts/import-ruankao-ihkyoung.js --only=cases
 *
 * 依赖：.env 中 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（或 ANON_KEY）
 * 前置：已执行 sql/create-ruankao-tables.sql 与 sql/alter-ruankao-external-id.sql
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SOURCE_DIR = path.join(__dirname, 'ruankao-sources');
const RAW_BASE = 'https://raw.githubusercontent.com/IHKYoung/RuanKao/baseline/src/data';
const FILES = {
  classic: 'classic-100.json',
  three: 'three-hundred.json',
  knowledge: 'case-bank.json',
  cases: 'case-bank.json',
};

/**
 * 【功能描述】
 * 解析命令行参数 only 与 limit
 *
 * 【业务逻辑】
 * 1. 读取 --only= 逗号分隔的导入类型，默认全部四类
 * 2. 读取 --limit= 数字限制 knowledge/cases 条数，0 表示不限制
 *
 * 【技术实现】
 * - 涉及方法：process.argv.slice()、String.split()、parseInt()
 * - 涉及知识点：CLI 参数约定、默认值策略
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const only = onlyArg
    ? onlyArg.replace('--only=', '').split(',').map((s) => s.trim()).filter(Boolean)
    : ['classic', 'three', 'knowledge', 'cases'];
  const limit = limitArg ? parseInt(limitArg.replace('--limit=', ''), 10) : 0;
  return { only, limit: Number.isFinite(limit) ? limit : 0 };
}

/**
 * 【功能描述】
 * 将 HTML 片段转为纯文本
 *
 * 【业务逻辑】
 * 1. 将 br/p 等块级标签转为换行
 * 2. 剥离其余 HTML 标签
 * 3. 解码常见 HTML 实体并压缩多余空行
 *
 * 【技术实现】
 * - 涉及方法：String.replace() 链式正则
 * - 涉及知识点：轻量 HTML 清洗、无 DOM 依赖
 */
function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 【功能描述】
 * 确保本地缓存目录存在并下载缺失的源 JSON
 *
 * 【业务逻辑】
 * 1. 创建 ruankao-sources 目录（若不存在）
 * 2. 根据 needKnowledge 决定是否下载 case-bank.json
 * 3. 跳过已存在且大于 1KB 的文件，否则从 GitHub raw 下载
 *
 * 【技术实现】
 * - 涉及方法：fs.mkdirSync、fs.existsSync、fetch、fs.writeFileSync
 * - 涉及知识点：增量下载、本地缓存避免重复请求
 */
async function ensureFiles(needKnowledge) {
  if (!fs.existsSync(SOURCE_DIR)) fs.mkdirSync(SOURCE_DIR, { recursive: true });
  const names = new Set(['classic-100.json', 'three-hundred.json']);
  if (needKnowledge) names.add('case-bank.json');
  for (const name of names) {
    const dest = path.join(SOURCE_DIR, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
    console.log(`下载 ${name} ...`);
    const res = await fetch(`${RAW_BASE}/${name}`);
    if (!res.ok) throw new Error(`下载失败 ${name}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log(`已保存 ${name} (${buf.length} bytes)`);
  }
}

/**
 * 【功能描述】
 * 将源 JSON 中的选择题映射为 ruankao_questions 行结构
 *
 * 【业务逻辑】
 * 1. 解析选项 label/text 并清洗 HTML
 * 2. 规范化正确答案为大写字母
 * 3. 缺题干/选项/答案则丢弃（返回 null）
 * 4. 合并 defaults 中的科目、章节、标签等元数据
 *
 * 【技术实现】
 * - 涉及方法：stripHtml()、Array.map/filter
 * - 涉及知识点：数据映射、单选/多选 qtype 推断、external_id
 */
function mapMcq(q, defaults = {}) {
  const options = (q.options || []).map((o) => ({
    key: String(o.label || '').toUpperCase(),
    text: stripHtml(o.text || o.html || ''),
  })).filter((o) => o.key && o.text);

  const answer = String(q.correctAnswer || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

  if (!q.stemText && !q.stemHtml) return null;
  if (!options.length || !answer) return null;

  return {
    external_id: String(q.id || '').slice(0, 120) || null,
    subject: defaults.subject || '综合知识',
    chapter: defaults.chapter || q.sourceCategory || q.sourceLabel || '综合',
    qtype: q.type === 'multiple' || q.type === 'multi' ? 'multi' : 'single',
    stem: stripHtml(q.stemText || q.stemHtml),
    options,
    answer,
    explanation: stripHtml(q.explanationHtml || q.explanation || ''),
    difficulty: defaults.difficulty || 'medium',
    tags: [
      'imported',
      'ihkyoung',
      defaults.tag || 'mcq',
      q.sourceLabel || q.sourceCategory || '',
    ].filter(Boolean),
  };
}

/**
 * 【功能描述】
 * 将案例题 JSON 映射为 ruankao_knowledge 知识卡片
 *
 * 【业务逻辑】
 * 1. 提取案例标题与题干
 * 2. 拼接各子问题的 prompt 与参考答案
 * 3. 生成 category=案例 的知识卡记录，content 截断至 8000 字符
 *
 * 【技术实现】
 * - 涉及方法：stripHtml()、Array.map/join
 * - 涉及知识点：案例题转知识卡片、external_id 前缀 case-
 */
function mapCaseToKnowledge(c) {
  const title = (c.title || c.id || '案例').slice(0, 200);
  const stem = stripHtml(c.stemText || c.stemHtml || '');
  const answers = (c.questions || [])
    .map((q, i) => {
      const prompt = stripHtml(q.promptHtml || q.label || `问题${i + 1}`);
      const ans = stripHtml(q.answerHtml || '');
      return `【${prompt}】\n${ans}`;
    })
    .join('\n\n');

  if (!stem && !answers) return null;
  return {
    external_id: `case-${String(c.id || title).slice(0, 100)}`,
    category: '案例',
    title,
    content: `${stem}\n\n—— 参考要点 ——\n${answers}`.slice(0, 8000),
    keywords: ['案例', 'imported', 'ihkyoung'],
    sort_order: 1000,
  };
}

/**
 * 【功能描述】
 * 批量 upsert 题目到 ruankao_questions
 *
 * 【业务逻辑】
 * 1. 按 50 条一批 upsert，冲突键 external_id
 * 2. 批量失败则降级逐条 insert，重复 external_id 计为 skipped
 * 3. 控制台输出进度条
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().upsert().select()、insert 降级
 * - 涉及知识点：批量写入、onConflict、唯一约束容错
 */
async function upsertQuestions(supabase, rows) {
  let inserted = 0;
  let skipped = 0;
  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).filter((r) => r && r.external_id && r.stem);
    if (!batch.length) continue;
    const { data, error } = await supabase
      .from('ruankao_questions')
      .upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id');

    if (error) {
      // 若 unique 索引尚未建立，退化为逐条跳过重复
      console.warn('批量 upsert 失败，改为逐条插入:', error.message || JSON.stringify(error));
      for (const row of batch) {
        const { error: e2 } = await supabase.from('ruankao_questions').insert([row]);
        if (e2) {
          const msg = e2.message || e2.code || JSON.stringify(e2);
          if (/duplicate|unique|external_id/i.test(msg)) skipped += 1;
          else console.error('插入失败:', msg, row.external_id);
        } else inserted += 1;
      }
    } else {
      inserted += (data || []).length;
    }
    process.stdout.write(`\r题目进度 ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
  return { inserted, skipped };
}

/**
 * 【功能描述】
 * 批量 upsert 知识卡片到 ruankao_knowledge
 *
 * 【业务逻辑】
 * 1. 按 40 条一批 upsert，冲突键 external_id
 * 2. 批量失败则逐条 insert 统计成功数
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().upsert()、insert 降级
 * - 涉及知识点：与 upsertQuestions 相同的批量策略
 */
async function upsertKnowledge(supabase, rows) {
  let inserted = 0;
  const batchSize = 40;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).filter((r) => r && r.external_id);
    if (!batch.length) continue;
    const { data, error } = await supabase
      .from('ruankao_knowledge')
      .upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id');
    if (error) {
      console.warn('知识卡片 upsert 失败，逐条插入:', error.message);
      for (const row of batch) {
        const { error: e2 } = await supabase.from('ruankao_knowledge').insert([row]);
        if (!e2) inserted += 1;
      }
    } else {
      inserted += (data || []).length;
    }
  }
  return { inserted };
}

/**
 * 【功能描述】
 * 导入脚本主流程：下载、映射、写入、汇总
 *
 * 【业务逻辑】
 * 1. 解析 CLI 参数并校验 Supabase 环境变量
 * 2. 按需下载源文件，探测 ruankao 表是否存在
 * 3. 按 only 选项分别映射 classic/three/knowledge/cases
 * 4. 调用 upsertQuestions/upsertKnowledge 写入
 * 5. 打印库内题目与知识卡总量
 *
 * 【技术实现】
 * - 涉及方法：parseArgs、ensureFiles、mapMcq、mapCaseToKnowledge、createClient
 * - 涉及知识点：ETL 流水线、表存在性探测、process.exit 错误码
 */
async function main() {
  const { only, limit } = parseArgs();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const needCaseBank = only.includes('knowledge') || only.includes('cases');
  await ensureFiles(needCaseBank);

  const supabase = createClient(url, key);

  // 快速探测表是否存在
  const probe = await supabase.from('ruankao_questions').select('id').limit(1);
  if (probe.error && /does not exist|42P01/i.test(probe.error.message || '')) {
    console.error('\n软考表尚未创建。请先在 Supabase SQL Editor 执行：');
    console.error('  1) sql/create-ruankao-tables.sql');
    console.error('  2) sql/alter-ruankao-external-id.sql（若建表已含 external_id 可跳过）');
    console.error('然后再运行：npm run db:ruankao-import\n');
    process.exit(1);
  }

  const questionRows = [];
  const knowledgeRows = [];

  if (only.includes('classic')) {
    const j = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, FILES.classic), 'utf8'));
    for (const q of j.questions || []) {
      const row = mapMcq(q, {
        subject: '综合知识',
        chapter: '经典100题',
        tag: 'classic-100',
        difficulty: 'medium',
      });
      if (row) questionRows.push(row);
    }
  }

  if (only.includes('three')) {
    const j = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, FILES.three), 'utf8'));
    for (const q of j.questions || []) {
      const row = mapMcq(q, {
        subject: '综合知识',
        chapter: '精炼300题',
        tag: 'three-hundred',
        difficulty: 'medium',
      });
      if (row) questionRows.push(row);
    }
  }

  if (only.includes('knowledge')) {
    const j = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, FILES.knowledge), 'utf8'));
    let list = j.knowledge?.questions || [];
    if (limit > 0) list = list.slice(0, limit);
    for (const q of list) {
      const row = mapMcq(q, {
        subject: '综合知识',
        chapter: q.sourceCategory || q.source?.category || '章节练习',
        tag: 'knowledge-bank',
        difficulty: 'medium',
      });
      if (row) questionRows.push(row);
    }
  }

  if (only.includes('cases')) {
    const j = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, FILES.cases), 'utf8'));
    let list = j.cases || [];
    if (limit > 0) list = list.slice(0, Math.min(limit, list.length));
    for (const c of list) {
      const row = mapCaseToKnowledge(c);
      if (row) knowledgeRows.push(row);
    }
  }

  console.log(`待导入题目 ${questionRows.length}，案例知识卡 ${knowledgeRows.length}`);

  if (questionRows.length) {
    const r = await upsertQuestions(supabase, questionRows);
    console.log('题目导入完成:', r);
  }
  if (knowledgeRows.length) {
    const r = await upsertKnowledge(supabase, knowledgeRows);
    console.log('案例知识卡导入完成:', r);
  }

  const { count: qCount } = await supabase
    .from('ruankao_questions')
    .select('*', { count: 'exact', head: true });
  const { count: kCount } = await supabase
    .from('ruankao_knowledge')
    .select('*', { count: 'exact', head: true });
  console.log(`当前库内：题目 ${qCount}，知识卡 ${kCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
