const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const growthRouter = require('../routes/growth');
const seedMonths = require('../routes/growth-seed');
const { buildStageTaskTemplates, splitKnowledgePoints } = require('../routes/growth-template');
const { calculateKnowledgeQualification, evaluateTaskMastery } = require('../routes/growth-mastery');
const {
  callDeepSeekText,
  normalizeGeneratedPractice,
  normalizeGrade,
  parseJsonContent,
} = require('../services/deepseek');
const {
  calculateMonthlyProgress,
  calculateScheduleProgress,
  calculateStreak,
  calculateTaskCompletion,
  createStageProgress,
  createReviewSnapshot,
  startOfWeek,
} = require('../routes/growth-logic');

const tests = [];
const test = (name, handler) => tests.push({ name, handler });

test('monthly progress uses task weights and ignores skipped tasks', () => {
  const progress = calculateMonthlyProgress([
    { status: 'done', weight: 2 },
    { status: 'doing', weight: 1 },
    { status: 'skipped', weight: 10 },
  ]);
  assert.equal(progress, 67);
});

test('task completion exposes an explainable weighted breakdown', () => {
  const progress = calculateTaskCompletion([
    { status: 'done', weight: 2 },
    { status: 'todo', weight: 3 },
    { status: 'skipped', weight: 8 },
  ]);
  assert.deepEqual(progress, {
    percentage: 40,
    completedWeight: 2,
    totalWeight: 5,
    completedCount: 1,
    totalCount: 2,
  });
});

test('schedule progress is clamped before, during, and after a stage', () => {
  assert.equal(calculateScheduleProgress('2026-09-15', '2026-10-14', '2026-09-14').percentage, 0);
  assert.deepEqual(calculateScheduleProgress('2026-09-15', '2026-10-14', '2026-09-15'), {
    percentage: 3,
    elapsedDays: 1,
    totalDays: 30,
    startsOn: '2026-09-15',
    endsOn: '2026-10-14',
  });
  assert.equal(calculateScheduleProgress('2026-09-15', '2026-10-14', '2026-10-14').percentage, 100);
  assert.equal(calculateScheduleProgress('2026-09-15', '2026-10-14', '2026-11-01').percentage, 100);
});

test('stage progress keeps knowledge qualification explicitly pending', () => {
  const progress = createStageProgress(
    { starts_on: '2026-09-15', ends_on: '2026-10-14' },
    [{ status: 'done', weight: 2 }, { status: 'todo', weight: 3 }],
    '2026-09-15',
  );
  assert.equal(progress.schedule.percentage, 3);
  assert.equal(progress.tasks.percentage, 40);
  assert.equal(progress.knowledge.percentage, 0);
  assert.equal(progress.knowledge.state, 'pending');
});

test('stage template expands core learning into required knowledge tasks and a deliverable', () => {
  const points = splitKnowledgePoints(seedMonths[0].coreLearning);
  const templates = buildStageTaskTemplates(seedMonths[0]);
  assert.ok(points.includes('闭包'));
  assert.ok(points.includes('Event Loop'));
  assert.equal(templates.length, points.length + 1);
  assert.equal(new Set(templates.map((item) => item.seed_key)).size, templates.length);
  assert.ok(templates.every((item) => item.description && item.acceptance_criteria));
  assert.equal(templates.at(-1).task_type, 'project');
  assert.equal(templates.at(-1).seed_key, 'project-deliverable');
});

test('phase 2 migration links evidence to an owned roadmap task', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../sql/20260915-growth-v2-links.sql'), 'utf8');
  for (const table of ['growth_learning_logs', 'growth_knowledge_items', 'growth_practices', 'growth_projects']) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS roadmap_task_id uuid`));
  }
  assert.match(migration, /FOREIGN KEY \(roadmap_task_id, user_id\)/);
  assert.match(migration, /source IN \('system', 'ai_generated', 'external', 'user_created'\)/);
});

test('phase 3 migration reuses the question bank and stores objective grading evidence', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../sql/20260915-growth-v3-ai-practice.sql'), 'utf8');
  assert.match(migration, /ALTER TABLE questions/);
  assert.match(migration, /question_id bigint REFERENCES questions\(id\)/);
  assert.match(migration, /system_score numeric\(4,2\)/);
  assert.match(migration, /self_assessment IN \('mastered', 'partial', 'not_mastered'\)/);
});

test('phase 4 migration stores automatic mastery and review recommendations', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../sql/20260922-growth-v4-mastery-review.sql'), 'utf8');
  assert.match(migration, /required_mastery_level integer/);
  assert.match(migration, /recommendation_priority integer/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS growth_mastery_assessments/);
  assert.match(migration, /CHECK \(level BETWEEN 0 AND 5\)/);
});

test('mastery reaches L5 only through the complete evidence chain', () => {
  const task = { id: 'task-1', required_mastery_level: 3 };
  const result = evaluateTaskMastery({
    task,
    logs: [{ id: 'log-1', roadmap_task_id: task.id, duration_minutes: 30 }],
    knowledgeItems: [{ id: 'card-1', roadmap_task_id: task.id, what_text: 'what', why_text: 'why', how_text: 'how' }],
    practices: [
      { id: 'p-concept', roadmap_task_id: task.id, practice_type: 'concept', source: 'ai_generated' },
      { id: 'p-code-1', roadmap_task_id: task.id, practice_type: 'coding', source: 'system' },
      { id: 'p-code-2', roadmap_task_id: task.id, practice_type: 'coding', source: 'external' },
    ],
    attempts: [
      { id: 'a-concept', practice_id: 'p-concept', system_score: 8, submitted_at: '2026-09-01T08:00:00Z' },
      { id: 'a-code-1', practice_id: 'p-code-1', system_score: 7, submitted_at: '2026-09-02T08:00:00Z' },
      { id: 'a-code-2', practice_id: 'p-code-2', system_score: 9, submitted_at: '2026-09-09T08:00:00Z' },
    ],
    projects: [{ id: 'project-1', roadmap_task_id: task.id, status: 'active', repository_url: 'https://example.com/repo' }],
  });
  assert.equal(result.level, 5);
  assert.equal(result.qualified, true);
  assert.equal(result.evidence.delayedAttemptId, 'a-code-2');
  assert.equal(result.evidence.projectId, 'project-1');
});

test('mastery is sequential and ignores user-created practice evidence', () => {
  const task = { id: 'task-1', required_mastery_level: 3 };
  const withoutLog = evaluateTaskMastery({
    task,
    knowledgeItems: [{ id: 'card-1', roadmap_task_id: task.id, what_text: 'what', why_text: 'why', how_text: 'how' }],
    practices: [{ id: 'p-1', roadmap_task_id: task.id, practice_type: 'concept', source: 'ai_generated' }],
    attempts: [{ id: 'a-1', practice_id: 'p-1', system_score: 10, submitted_at: '2026-09-01T08:00:00Z' }],
  });
  assert.equal(withoutLog.level, 0);

  const userCreated = evaluateTaskMastery({
    task,
    logs: [{ id: 'log-1', roadmap_task_id: task.id, duration_minutes: 20 }],
    knowledgeItems: [{ id: 'card-1', roadmap_task_id: task.id, what_text: 'what', why_text: 'why', how_text: 'how' }],
    practices: [{ id: 'p-1', roadmap_task_id: task.id, practice_type: 'concept', source: 'user_created' }],
    attempts: [{ id: 'a-1', practice_id: 'p-1', system_score: 10, submitted_at: '2026-09-01T08:00:00Z' }],
  });
  assert.equal(userCreated.level, 1);
});

test('knowledge qualification uses required task weights and mastery thresholds', () => {
  const result = calculateKnowledgeQualification([
    { id: 'a', task_type: 'knowledge', is_required: true, weight: 2, required_mastery_level: 3 },
    { id: 'b', task_type: 'knowledge', is_required: true, weight: 3, required_mastery_level: 4 },
    { id: 'c', task_type: 'project', is_required: true, weight: 10 },
  ], [
    { roadmap_task_id: 'a', level: 3 },
    { roadmap_task_id: 'b', level: 3 },
  ]);
  assert.equal(result.percentage, 40);
  assert.equal(result.qualifiedCount, 1);
  assert.equal(result.totalCount, 2);
  assert.equal(result.state, 'active');
});

test('DeepSeek JSON helpers tolerate fenced output and validate grades', () => {
  assert.deepEqual(parseJsonContent('```json\n{"score":8,"feedback":"正确"}\n```'), { score: 8, feedback: '正确' });
  assert.deepEqual(normalizeGrade({ score: 12, feedback: '超过上限' }), { score: 10, feedback: '超过上限' });
  assert.deepEqual(normalizeGeneratedPractice({
    title: '闭包练习',
    type: 'concept',
    difficulty: 'hard',
    content: '解释输出',
    reference_answer: '参考',
    scoring_rubric: '量规',
  }), {
    title: '闭包练习',
    practice_type: 'concept',
    difficulty: 'hard',
    content: '解释输出',
    reference_answer: '参考',
    scoring_rubric: '量规',
  });
});

test('shared DeepSeek client sends server-side credentials and returns model content', async () => {
  let captured;
  const content = await callDeepSeekText({
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'test' }],
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    },
  });
  assert.equal(content, '{"ok":true}');
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer test-key');
});

test('streak starts yesterday when today has no learning log', () => {
  const streak = calculateStreak(['2026-09-10', '2026-09-11', '2026-09-12'], '2026-09-13');
  assert.equal(streak, 3);
});

test('streak stops on the first missing calendar day', () => {
  const streak = calculateStreak(['2026-09-10', '2026-09-12', '2026-09-13'], '2026-09-13');
  assert.equal(streak, 2);
});

test('week starts on Monday by default', () => {
  assert.equal(startOfWeek('2026-09-13'), '2026-09-07');
});

test('review snapshot is stable and explainable', () => {
  const snapshot = createReviewSnapshot({
    logs: [
      { log_date: '2026-09-10', duration_minutes: 40 },
      { log_date: '2026-09-10', duration_minutes: 20 },
      { log_date: '2026-09-11', duration_minutes: 0 },
    ],
    tasks: [{ status: 'done' }, { status: 'doing' }],
    practices: [{ result: 'passed' }, { result: 'failed' }],
    milestones: [{ status: 'done' }],
  });
  assert.deepEqual(snapshot, {
    learningMinutes: 60,
    activeDays: 1,
    taskTotal: 2,
    taskCompleted: 1,
    practiceAttempts: 2,
    practicePassed: 1,
    milestoneTotal: 1,
    milestoneCompleted: 1,
  });
});

test('health is public while dashboard requires authentication', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/growth', growthRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const address = server.address();
    const health = await fetch(`http://127.0.0.1:${address.port}/api/v1/growth/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).data.module, 'growth-v1');

    const dashboard = await fetch(`http://127.0.0.1:${address.port}/api/v1/growth/dashboard`);
    assert.equal(dashboard.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function run() {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.handler();
      console.log(`✓ ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${item.name}`);
      console.error(error);
    }
  }

  if (failed) process.exitCode = 1;
  else console.log(`\n${tests.length} growth tests passed.`);
}

run();
