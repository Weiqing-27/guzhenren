const splitKnowledgePoints = (coreLearning = '') => String(coreLearning)
  .split(/[、；]/)
  .map((item) => item.trim())
  .filter(Boolean);

function buildStageTaskTemplates(month) {
  const knowledgePoints = splitKnowledgePoints(month.coreLearning);
  const plannedMinutes = Math.max(60, Math.round(1200 / Math.max(knowledgePoints.length, 1)));
  const knowledgeTasks = knowledgePoints.map((point, index) => ({
    seed_key: `knowledge-${String(index + 1).padStart(2, '0')}`,
    title: point,
    description: `学习并整理「${point}」的核心概念、运行机制与常见应用。`,
    acceptance_criteria: `能在不查资料的情况下解释「${point}」的 What / Why / How，完成一道陌生练习，并保留代码、调试或总结证据。`,
    task_type: 'knowledge',
    weight: 1,
    required_mastery_level: 3,
    planned_minutes: plannedMinutes,
    is_required: true,
  }));

  return [
    ...knowledgeTasks,
    {
      seed_key: 'project-deliverable',
      title: month.deliverable,
      description: `完成「${month.title}」阶段交付物，并保留可验证的代码、文档或演示记录。`,
      acceptance_criteria: `提供「${month.deliverable}」的仓库或演示证据，记录实现过程、遇到的问题和验证结果。`,
      task_type: 'project',
      weight: 3,
      required_mastery_level: 0,
      planned_minutes: 1200,
      is_required: true,
    },
  ];
}

module.exports = { buildStageTaskTemplates, splitKnowledgePoints };
