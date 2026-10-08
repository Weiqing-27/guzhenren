const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const { calculateKnowledgeQualification } = require('./growth-mastery');

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function todayInTimeZone(timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function assertDateKey(value, fieldName = 'date') {
  if (!DATE_RE.test(String(value || ''))) {
    const error = new Error(`${fieldName} 必须是 YYYY-MM-DD 格式`);
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return value;
}

function shiftDate(dateKey, days) {
  assertDateKey(dateKey);
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
}

function startOfWeek(dateKey, weekStartsOn = 1) {
  assertDateKey(dateKey);
  const normalizedStart = Math.min(7, Math.max(1, Number(weekStartsOn) || 1));
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const currentDay = date.getUTCDay() || 7;
  return shiftDate(dateKey, -((currentDay - normalizedStart + 7) % 7));
}

function startOfMonth(dateKey) {
  assertDateKey(dateKey);
  return `${dateKey.slice(0, 7)}-01`;
}

function toUtcDayNumber(dateKey, fieldName = 'date') {
  assertDateKey(dateKey, fieldName);
  return Date.parse(`${dateKey}T00:00:00.000Z`) / 86400000;
}

function calculateScheduleProgress(startsOn, endsOn, targetDate) {
  const start = toUtcDayNumber(startsOn, 'startsOn');
  const end = toUtcDayNumber(endsOn, 'endsOn');
  const target = toUtcDayNumber(targetDate, 'targetDate');
  if (end < start) {
    const error = new Error('阶段结束日期不能早于开始日期');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const totalDays = end - start + 1;
  const elapsedDays = Math.min(totalDays, Math.max(0, target - start + 1));
  return {
    percentage: Math.round((elapsedDays / totalDays) * 100),
    elapsedDays,
    totalDays,
    startsOn,
    endsOn,
  };
}

function calculateTaskCompletion(tasks = []) {
  const validTasks = tasks.filter((task) => task && task.status !== 'skipped');
  const totalWeight = validTasks.reduce((sum, task) => sum + Math.max(0, Number(task.weight) || 1), 0);
  const completedTasks = validTasks.filter((task) => task.status === 'done');
  const completedWeight = completedTasks
    .reduce((sum, task) => sum + Math.max(0, Number(task.weight) || 1), 0);
  return {
    percentage: totalWeight ? Math.round((completedWeight / totalWeight) * 100) : 0,
    completedWeight,
    totalWeight,
    completedCount: completedTasks.length,
    totalCount: validTasks.length,
  };
}

function createPendingKnowledgeQualification() {
  return {
    percentage: 0,
    qualifiedWeight: 0,
    totalWeight: 0,
    state: 'pending',
    message: '知识证据关联将在掌握度引擎启用后计算',
  };
}

function createStageProgress(stage, tasks, targetDate, assessments = null) {
  return {
    schedule: calculateScheduleProgress(stage.starts_on, stage.ends_on, targetDate),
    tasks: calculateTaskCompletion(tasks),
    knowledge: assessments === null
      ? createPendingKnowledgeQualification()
      : calculateKnowledgeQualification(tasks, assessments),
  };
}

// 保留数值返回供旧调用方过渡；新页面应使用 calculateTaskCompletion。
function calculateMonthlyProgress(tasks = []) {
  return calculateTaskCompletion(tasks).percentage;
}

function calculateStreak(logDates = [], targetDate, options = {}) {
  assertDateKey(targetDate, 'targetDate');
  const dates = new Set(logDates.filter((date) => DATE_RE.test(String(date))));
  let cursor = targetDate;
  if (options.allowYesterdayWhenTodayEmpty !== false && !dates.has(cursor)) {
    cursor = shiftDate(cursor, -1);
  }
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

function summarizeLearningLogs(logs = []) {
  const activeDates = new Set();
  let minutes = 0;
  for (const log of logs) {
    const duration = Math.max(0, Number(log.duration_minutes) || 0);
    minutes += duration;
    if (duration > 0 && DATE_RE.test(String(log.log_date))) activeDates.add(log.log_date);
  }
  return { minutes, activeDays: activeDates.size };
}

function createReviewSnapshot({ logs = [], tasks = [], practices = [], milestones = [] } = {}) {
  const learning = summarizeLearningLogs(logs);
  return {
    learningMinutes: learning.minutes,
    activeDays: learning.activeDays,
    taskTotal: tasks.length,
    taskCompleted: tasks.filter((item) => item.status === 'done').length,
    practiceAttempts: practices.length,
    practicePassed: practices.filter((item) => item.result === 'passed').length,
    milestoneTotal: milestones.length,
    milestoneCompleted: milestones.filter((item) => item.status === 'done').length,
  };
}

module.exports = {
  DATE_RE,
  assertDateKey,
  calculateMonthlyProgress,
  calculateScheduleProgress,
  calculateStreak,
  calculateTaskCompletion,
  createPendingKnowledgeQualification,
  createReviewSnapshot,
  createStageProgress,
  shiftDate,
  startOfMonth,
  startOfWeek,
  summarizeLearningLogs,
  todayInTimeZone,
};
