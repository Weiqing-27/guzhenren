const OBJECTIVE_SOURCES = new Set(['system', 'ai_generated', 'external']);
const CLOSED_BOOK_SOURCES = new Set(['system', 'ai_generated']);

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const dayNumber = (value) => Math.floor(Date.parse(value) / 86400000);

function evaluateTaskMastery({ task, logs = [], knowledgeItems = [], practices = [], attempts = [], projects = [] }) {
  const validLogs = logs.filter((item) => item.roadmap_task_id === task.id && Number(item.duration_minutes) > 0);
  const completeCards = knowledgeItems.filter((item) => (
    item.roadmap_task_id === task.id
    && !item.archived_at
    && hasText(item.what_text)
    && hasText(item.why_text)
    && hasText(item.how_text)
  ));
  const taskPractices = practices.filter((item) => item.roadmap_task_id === task.id);
  const practiceById = new Map(taskPractices.map((item) => [item.id, item]));
  const passingAttempts = attempts
    .filter((item) => Number(item.system_score) >= 7 && practiceById.has(item.practice_id))
    .map((attempt) => ({ ...attempt, practice: practiceById.get(attempt.practice_id) }))
    .filter((item) => OBJECTIVE_SOURCES.has(item.practice.source))
    .sort((left, right) => Date.parse(left.submitted_at) - Date.parse(right.submitted_at));
  const closedBookPasses = passingAttempts.filter((item) => (
    item.practice.practice_type === 'concept' && CLOSED_BOOK_SOURCES.has(item.practice.source)
  ));
  const applicationPasses = passingAttempts.filter((item) => item.practice.practice_type !== 'concept');
  const firstApplication = applicationPasses[0] || null;
  const delayedPass = firstApplication
    ? passingAttempts.find((item) => (
      item.practice_id !== firstApplication.practice_id
      && dayNumber(item.submitted_at) - dayNumber(firstApplication.submitted_at) >= 7
    )) || null
    : null;
  const projectEvidence = projects.find((item) => (
    item.roadmap_task_id === task.id
    && item.status !== 'archived'
    && (hasText(item.repository_url) || hasText(item.demo_url))
  )) || null;

  let level = 0;
  if (validLogs.length) level = 1;
  if (level >= 1 && completeCards.length && closedBookPasses.length) level = 2;
  if (level >= 2 && firstApplication) level = 3;
  if (level >= 3 && delayedPass) level = 4;
  if (level >= 4 && projectEvidence) level = 5;

  const nextRequirements = [
    '完成一次有效学习日志（时长大于 0）',
    '补全 What / Why / How 知识卡片，并通过一次系统或 AI 闭卷复述',
    '通过一道非概念型陌生练习，系统评分达到 7 分',
    '至少间隔 7 天后再次通过另一道陌生练习',
    '在关联项目中提交代码仓库或演示地址',
    '已达到最高等级，可继续用不同场景巩固迁移能力',
  ];

  return {
    taskId: task.id,
    level,
    requiredLevel: Number(task.required_mastery_level) || 3,
    qualified: level >= (Number(task.required_mastery_level) || 3),
    nextRequirement: nextRequirements[level],
    evidence: {
      validLogCount: validLogs.length,
      latestLogId: validLogs.at(-1)?.id || null,
      completeCardCount: completeCards.length,
      knowledgeCardId: completeCards[0]?.id || null,
      closedBookAttemptId: closedBookPasses[0]?.id || null,
      applicationAttemptId: firstApplication?.id || null,
      delayedAttemptId: delayedPass?.id || null,
      projectId: projectEvidence?.id || null,
      projectEvidenceUrl: projectEvidence?.repository_url || projectEvidence?.demo_url || null,
    },
  };
}

function calculateKnowledgeQualification(tasks = [], assessments = []) {
  const requiredTasks = tasks.filter((item) => item.task_type === 'knowledge' && item.is_required !== false && item.status !== 'skipped');
  const assessmentByTask = new Map(assessments.map((item) => [item.roadmap_task_id || item.taskId, item]));
  const totalWeight = requiredTasks.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 1), 0);
  const qualifiedTasks = requiredTasks.filter((task) => {
    const assessment = assessmentByTask.get(task.id);
    const requiredLevel = Number(task.required_mastery_level) || 3;
    return Number(assessment?.level || 0) >= requiredLevel;
  });
  const qualifiedWeight = qualifiedTasks.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 1), 0);
  return {
    percentage: totalWeight ? Math.round((qualifiedWeight / totalWeight) * 100) : 0,
    qualifiedWeight,
    totalWeight,
    qualifiedCount: qualifiedTasks.length,
    totalCount: requiredTasks.length,
    state: 'active',
    message: `达到任务要求等级的知识点 ${qualifiedTasks.length}/${requiredTasks.length}`,
  };
}

module.exports = { OBJECTIVE_SOURCES, calculateKnowledgeQualification, evaluateTaskMastery };
