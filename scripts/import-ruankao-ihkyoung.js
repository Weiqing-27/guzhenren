/**
 * 从 IHKYoung/RuanKao 公开仓库导入高项选择题到 Supabase
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
