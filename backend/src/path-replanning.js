import { clean, ensureArray } from "./utils.js";

const LLM_REPLANNING_AGENT = "LLM 路径重规划智能体";
const MAX_MODEL_INSERT_DAYS = 2;
const MAX_MODEL_UPDATE_DAYS = 4;

export function buildLearningEvidence(plan, options = {}) {
  const data = plan?.data || {};
  const dailyPlan = ensureArray(data.dailyPlan, []);
  const progress = plan?.progress || {};
  const diagnostic = data.diagnosticResult || null;
  const remediation = data.remediationPlan || null;
  const quizHistory = ensureArray(plan?.quizHistory, []);
  const recentQuiz = quizHistory.slice(-12);
  const recentWrong = recentQuiz.filter((item) => item && item.correct === false);
  const wrongByDimension = groupCounts(recentWrong.map((item) => item.dimension || "综合"));
  const wrongByConcept = groupCounts(recentWrong.map((item) => item.conceptId || item.dimension || "综合"));
  const current = currentLearningPosition(dailyPlan, progress);
  const weakConcepts = collectWeakConcepts(data, diagnostic, remediation, recentWrong);
  const overdue = estimateOverdue(plan, options.now || new Date());
  const exam = options.exam || null;

  return {
    generatedAt: new Date().toISOString(),
    progress: summarizePlanProgress(dailyPlan, progress),
    current,
    diagnostic: diagnostic ? {
      percent: Number(diagnostic.percent || 0),
      score: Number(diagnostic.score || 0),
      maxScore: Number(diagnostic.maxScore || 0),
      weakestCount: ensureArray(diagnostic.adaptiveState?.weakestConcepts, []).length,
      mistakeTags: ensureArray(diagnostic.mistakeProfile?.dominantTags, [])
    } : null,
    remediation: remediation ? {
      target: remediation.target || "",
      weakConcepts: ensureArray(remediation.weakConcepts, []).slice(0, 6)
    } : null,
    recentWrong: recentWrong.slice(-8).map((item) => ({
      questionId: item.questionId,
      source: item.source || "practice",
      type: item.type || "short",
      dimension: item.dimension || "综合",
      conceptId: item.conceptId || "",
      score: Number(item.score || 0),
      maxScore: Number(item.maxScore || 0),
      feedback: item.feedback || item.result?.feedback || "",
      at: item.at
    })),
    wrongByDimension,
    wrongByConcept,
    weakConcepts,
    overdue,
    exam,
    triggerType: options.triggerType || inferTriggerType({ diagnostic, recentWrong, overdue, exam })
  };
}

export function shouldProposeReplanning(evidence) {
  if (!evidence) return { propose: false, reason: "缺少学习证据" };
  if (evidence.triggerType === "manual") return { propose: true, reason: "用户主动检查路径" };
  if (evidence.diagnostic && evidence.diagnostic.percent < 70) {
    return { propose: true, reason: `诊断得分 ${evidence.diagnostic.percent}% 低于路径调整阈值` };
  }
  const repeatedWrong = Object.entries(evidence.wrongByDimension || {})
    .find(([, count]) => Number(count) >= 2);
  if (repeatedWrong) {
    return { propose: true, reason: `最近在「${repeatedWrong[0]}」连续出现错题` };
  }
  if (evidence.exam && Number(evidence.exam.percent || 0) > 0 && Number(evidence.exam.percent || 0) < 75) {
    return { propose: true, reason: `综合考试得分 ${evidence.exam.percent}% 低于阶段通过线` };
  }
  if (evidence.overdue?.overdueDays >= 2) {
    return { propose: true, reason: `学习节奏已落后 ${evidence.overdue.overdueDays} 天` };
  }
  return { propose: false, reason: "当前证据不足以触发路径重规划" };
}

export function buildPathReplanningContext(plan, evidence) {
  const data = plan?.data || {};
  const dailyPlan = normalizeDailyPlanTaskKeys(data.dailyPlan || []);
  const progress = plan?.progress || {};
  return {
    planId: plan?.id || "",
    title: plan?.title || data?.resourcePackage?.title || data?.input?.topic || "",
    input: {
      topic: data?.input?.topic || "",
      goal: data?.input?.goal || "",
      level: data?.input?.level || "",
      duration: data?.input?.duration || "",
      dailyMinutes: data?.input?.dailyMinutes || "",
      style: data?.input?.style || "",
      weaknesses: data?.input?.weaknesses || ""
    },
    learnerProfile: {
      summary: data?.learnerProfile?.summary || data?.profile?.summary || "",
      weakestDimensions: ensureArray(data?.learnerProfile?.weakestDimensions, []).slice(0, 5),
      strategyPriorities: ensureArray(data?.learnerProfile?.strategyPriorities, []).slice(0, 5)
    },
    evidence: compactEvidenceForModel(evidence || buildLearningEvidence(plan)),
    dailyPlan: dailyPlan.map((day) => ({
      day: Number(day.day || 0),
      title: String(day.title || ""),
      estimate: String(day.estimate || ""),
      focus: String(day.focus || ""),
      checkpoint: String(day.checkpoint || ""),
      knowledgePoints: ensureArray(day.knowledgePoints, []).slice(0, 8),
      tasks: ensureArray(day.tasks, []).map((task, index) => ({
        taskKey: taskKeyFor(day, index),
        content: String(task || ""),
        completed: Boolean(progress[taskKeyFor(day, index)])
      }))
    }))
  };
}

export function buildRevisionFromModelProposal(plan, proposal, options = {}) {
  const data = plan?.data || {};
  const dailyPlan = ensureArray(data.dailyPlan, []);
  if (!dailyPlan.length) return null;

  const revisionId = options.revisionId || `revision-${Date.now()}`;
  const evidence = options.evidence || buildLearningEvidence(plan, options);
  const normalizedProposal = normalizeModelProposal(proposal);
  if (options.requireOperationalProposal && !normalizedProposal.shouldReplan) {
    throw new Error("用户主动要求 LLM 重新检查时，模型必须返回至少一个可执行路径建议");
  }
  if (!normalizedProposal.shouldReplan) {
    return {
      skipped: true,
      reason: normalizedProposal.reason || "LLM 判断当前路径暂不需要调整",
      evidence
    };
  }

  const before = renumberDays(normalizeDailyPlanTaskKeys(dailyPlan));
  const updated = applyModelDayUpdates(before, normalizedProposal.updateDays, {
    revisionId,
    progress: plan?.progress || {}
  });
  const after = renumberDays(applyModelInsertDays(updated, normalizedProposal.insertDays, {
    revisionId,
    progress: plan?.progress || {},
    input: data.input || {}
  }));

  if (dailyPlanShapeSignature(before) === dailyPlanShapeSignature(after)) {
    throw new Error("LLM 未返回可执行的路径变更操作");
  }

  const diff = diffDailyPlan(before, after);
  const actions = buildModelActions(normalizedProposal, diff);
  const revision = {
    id: revisionId,
    status: "proposed",
    triggerType: evidence.triggerType || options.triggerType || "manual",
    triggerEventIds: ensureArray(options.triggerEventIds, []),
    summary: normalizedProposal.summary || summarizeModelRevision(normalizedProposal, diff),
    evidence: {
      ...evidence,
      llm: {
        model: options.model || null,
        source: "path-replanning",
        proposalReason: normalizedProposal.reason || ""
      }
    },
    beforeSnapshot: {
      dailyPlan: before,
      progress: plan?.progress || {},
      planVersion: Number(plan?.version || 1)
    },
    afterSnapshot: {
      dailyPlan: after,
      progress: plan?.progress || {}
    },
    diff,
    actions,
    confidence: normalizeConfidence(normalizedProposal.confidence),
    createdByAgent: options.createdByAgent || LLM_REPLANNING_AGENT,
    createdAt: new Date().toISOString()
  };

  const issues = validateRevisionAgainstProgress(revision, plan?.progress || {});
  if (issues.length) {
    throw new Error(`LLM 路径建议未通过安全校验：${issues.join("；")}`);
  }

  return revision;
}

export function applyRevisionToPlanData(data, revision) {
  return {
    ...(data || {}),
    dailyPlan: ensureArray(revision?.afterSnapshot?.dailyPlan, []),
    lastPathRevision: revision ? {
      id: revision.id,
      summary: revision.summary,
      appliedAt: new Date().toISOString()
    } : null
  };
}

export function revertRevisionFromPlanData(data, revision) {
  return {
    ...(data || {}),
    dailyPlan: ensureArray(revision?.beforeSnapshot?.dailyPlan, []),
    lastPathRevision: revision ? {
      id: revision.id,
      summary: `已撤销：${revision.summary || "路径调整"}`,
      undoneAt: new Date().toISOString()
    } : null
  };
}

export function extractPlanTasksFromDailyPlan(dailyPlan, revisionId = null) {
  const tasks = [];
  for (const day of ensureArray(dailyPlan, [])) {
    ensureArray(day?.tasks, []).forEach((content, taskIndex) => {
      const taskKey = taskKeyFor(day, taskIndex);
      tasks.push({
        taskKey,
        dayNumber: Number(day.day || 0),
        taskIndex,
        content: String(content || ""),
        conceptId: ensureArray(day.conceptIds, [])[taskIndex] || day.conceptId || null,
        revisionId: day.revisionId || revisionId || null
      });
    });
  }
  return tasks.filter((task) => task.dayNumber > 0 && task.content);
}

export function dailyPlanShapeSignature(dailyPlan) {
  return JSON.stringify(normalizeDailyPlanTaskKeys(dailyPlan).map((day) => ({
    day: Number(day?.day || 0),
    title: comparableDayTitle(day?.title),
    focus: String(day?.focus || ""),
    tasks: ensureArray(day?.tasks, []).map(String),
    taskKeys: ensureArray(day?.taskKeys, []).map(String)
  })));
}

export function validateRevisionAgainstProgress(revision, progress = {}) {
  const beforeByKey = new Map(extractPlanTasksFromDailyPlan(revision?.beforeSnapshot?.dailyPlan).map((task) => [task.taskKey, task]));
  const afterByKey = new Map(extractPlanTasksFromDailyPlan(revision?.afterSnapshot?.dailyPlan).map((task) => [task.taskKey, task]));
  const completed = Object.entries(progress)
    .filter(([, completed]) => Boolean(completed))
    .map(([taskKey]) => taskKey);
  const missing = completed.filter((taskKey) => beforeByKey.has(taskKey) && !afterByKey.has(taskKey));
  const changed = completed.filter((taskKey) => (
    beforeByKey.has(taskKey)
      && afterByKey.has(taskKey)
      && beforeByKey.get(taskKey).content !== afterByKey.get(taskKey).content
  ));
  const moved = completed.filter((taskKey) => (
    beforeByKey.has(taskKey)
      && afterByKey.has(taskKey)
      && beforeByKey.get(taskKey).dayNumber !== afterByKey.get(taskKey).dayNumber
  ));
  return [
    ...(missing.length ? [`修订不能移除已完成任务：${missing.join("、")}`] : []),
    ...(changed.length ? [`修订不能改写已完成任务：${changed.join("、")}`] : []),
    ...(moved.length ? [`修订不能移动已完成任务：${moved.join("、")}`] : [])
  ];
}

export function normalizeDailyPlanTaskKeys(dailyPlan) {
  return ensureArray(dailyPlan, []).map((day) => {
    const tasks = ensureArray(day?.tasks, []).map(String);
    const taskKeys = tasks.map((_, index) => taskKeyFor(day, index));
    return {
      ...day,
      tasks,
      taskKeys,
      revisionMeta: day?.revisionMeta || null
    };
  });
}

function taskKeyFor(day, index) {
  const existing = ensureArray(day?.taskKeys, [])[index];
  if (existing) return String(existing).slice(0, 100);
  return `day-${Number(day?.day || 1)}-task-${index}`;
}

function comparableDayTitle(title) {
  const value = String(title || "").trim();
  return value.replace(/^第\s*\d+\s*天[：:]\s*/, "").trim();
}

function currentLearningPosition(dailyPlan, progress) {
  const normalized = normalizeDailyPlanTaskKeys(dailyPlan);
  const index = normalized.findIndex((day) => !isDayComplete(day, progress));
  const safeIndex = index === -1 ? Math.max(0, normalized.length - 1) : index;
  const day = normalized[safeIndex] || null;
  return {
    day: day?.day || null,
    index: safeIndex,
    completedDays: normalized.filter((item) => isDayComplete(item, progress)).length
  };
}

function isDayComplete(day, progress = {}) {
  const tasks = ensureArray(day?.tasks, []);
  if (!tasks.length) return false;
  return tasks.every((_, index) => Boolean(progress[taskKeyFor(day, index)]));
}

function latestTouchedDayIndex(dailyPlan, progress = {}) {
  let latest = -1;
  dailyPlan.forEach((day, dayIndex) => {
    ensureArray(day?.tasks, []).forEach((_, taskIndex) => {
      if (progress[taskKeyFor(day, taskIndex)]) latest = Math.max(latest, dayIndex);
    });
  });
  return latest;
}

function summarizePlanProgress(dailyPlan, progress = {}) {
  let total = 0;
  let done = 0;
  for (const day of normalizeDailyPlanTaskKeys(dailyPlan)) {
    ensureArray(day.tasks, []).forEach((_, index) => {
      total += 1;
      if (progress[taskKeyFor(day, index)]) done += 1;
    });
  }
  return {
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0
  };
}

function collectWeakConcepts(data, diagnostic, remediation, recentWrong) {
  const fromAdaptive = ensureArray(data?.adaptiveState?.weakestConcepts, []).map((item) => ({
    conceptId: item.conceptId || item.id || "",
    title: item.title || item.conceptTitle || item.dimension || "薄弱知识点",
    dimension: item.dimension || "综合",
    masteryScore: Number(item.masteryScore ?? item.score ?? 0),
    confidence: Number(item.confidence ?? 0.35),
    reason: item.evidence || item.nextAction || ""
  }));
  const fromRemediation = ensureArray(remediation?.weakConcepts, []).map((item) => ({
    conceptId: item.conceptId || "",
    title: item.title || item.conceptTitle || item.dimension || "补救知识点",
    dimension: item.dimension || "综合",
    masteryScore: Number(item.masteryScore || 0),
    confidence: Number(item.confidence ?? 0.45),
    reason: item.reason || ""
  }));
  const fromDiagnostic = ensureArray(diagnostic?.conceptMastery, [])
    .filter((item) => Number(item.masteryScore || 0) < 75 || Number(item.confidence || 0) < 0.55)
    .map((item) => ({
      conceptId: item.conceptId || "",
      title: item.conceptTitle || item.title || item.dimension || "诊断薄弱点",
      dimension: item.dimension || "综合",
      masteryScore: Number(item.masteryScore || 0),
      confidence: Number(item.confidence || 0.45),
      reason: item.evidence || ""
    }));
  const fromWrong = recentWrong.map((item) => ({
    conceptId: item.conceptId || "",
    title: item.dimension || "错题知识点",
    dimension: item.dimension || "综合",
    masteryScore: scorePercent(item),
    confidence: 0.62,
    reason: item.feedback || item.result?.feedback || "最近测评未通过"
  }));
  return uniqueByKey([...fromAdaptive, ...fromRemediation, ...fromDiagnostic, ...fromWrong], (item) => (
    item.conceptId || `${item.dimension}|${item.title}`
  )).slice(0, 6);
}

function renumberDays(days) {
  return ensureArray(days, []).map((day, index) => ({
    ...day,
    day: index + 1,
    title: String(day?.title || "").replace(/^第\s*\d+\s*天[：:]/, `第 ${index + 1} 天：`)
  }));
}

function compactEvidenceForModel(evidence = {}) {
  return {
    triggerType: evidence.triggerType || "manual",
    progress: evidence.progress || null,
    current: evidence.current || null,
    diagnostic: evidence.diagnostic || null,
    remediation: evidence.remediation || null,
    recentWrong: ensureArray(evidence.recentWrong, []).slice(-6),
    wrongByDimension: evidence.wrongByDimension || {},
    weakConcepts: ensureArray(evidence.weakConcepts, []).slice(0, 6),
    overdue: evidence.overdue || null,
    exam: evidence.exam || null
  };
}

function normalizeModelProposal(proposal = {}) {
  const decision = String(proposal.decision || "").toLowerCase();
  const explicitNo = proposal.shouldReplan === false
    || ["keep", "no_change", "no-change", "none", "skip"].includes(decision);
  const insertDays = ensureArray(proposal.insertDays || proposal.insertedDays, [])
    .slice(0, MAX_MODEL_INSERT_DAYS)
    .map(normalizeModelInsertDay)
    .filter(Boolean);
  const updateDays = ensureArray(proposal.updateDays || proposal.updatedDays, [])
    .slice(0, MAX_MODEL_UPDATE_DAYS)
    .map(normalizeModelUpdateDay)
    .filter(Boolean);
  const shouldReplan = !explicitNo && (proposal.shouldReplan === true || insertDays.length > 0 || updateDays.length > 0);

  return {
    shouldReplan,
    reason: clean(proposal.reason || proposal.rationale || "", 500),
    summary: clean(proposal.summary || "", 900),
    confidence: proposal.confidence,
    insertDays,
    updateDays
  };
}

function normalizeModelInsertDay(day) {
  if (!day || typeof day !== "object") return null;
  const tasks = normalizeModelTasks(day.tasks);
  if (!tasks.length) return null;
  return {
    afterDay: Math.max(0, Number.parseInt(day.afterDay ?? day.after_day ?? day.position ?? 0, 10) || 0),
    title: clean(day.title || "LLM 建议补强学习日", 120),
    estimate: clean(day.estimate || "", 60),
    focus: clean(day.focus || "", 120),
    tasks,
    checkpoint: clean(day.checkpoint || day.successCriteria || "", 260),
    knowledgePoints: normalizeShortList(day.knowledgePoints || day.knowledge_points, 8, 80),
    conceptIds: normalizeShortList(day.conceptIds || day.concept_ids, 8, 100),
    reason: clean(day.reason || "", 400)
  };
}

function normalizeModelUpdateDay(day) {
  if (!day || typeof day !== "object") return null;
  const targetDay = Number.parseInt(day.day ?? day.dayNumber ?? day.day_number ?? 0, 10);
  if (!Number.isFinite(targetDay) || targetDay <= 0) return null;
  return {
    day: targetDay,
    title: clean(day.title || "", 120),
    estimate: clean(day.estimate || "", 60),
    focus: clean(day.focus || "", 120),
    tasks: normalizeModelTasks(day.tasks),
    checkpoint: clean(day.checkpoint || day.successCriteria || "", 260),
    knowledgePoints: normalizeShortList(day.knowledgePoints || day.knowledge_points, 8, 80),
    conceptIds: normalizeShortList(day.conceptIds || day.concept_ids, 8, 100),
    reason: clean(day.reason || "", 400)
  };
}

function normalizeModelTasks(tasks) {
  return ensureArray(tasks, [])
    .map((task) => clean(task, 260))
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeShortList(value, maxItems, maxLength) {
  return ensureArray(value, [])
    .map((item) => clean(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function applyModelDayUpdates(days, updateDays, { revisionId, progress }) {
  if (!updateDays.length) return days;
  const updatesByDay = new Map(updateDays.map((day) => [Number(day.day), day]));
  const touchedThroughIndex = latestTouchedDayIndex(days, progress);
  return days.map((day, dayIndex) => {
    const update = updatesByDay.get(Number(day.day));
    if (!update) return day;
    if (dayIndex <= touchedThroughIndex || hasCompletedTask(day, progress)) return day;

    const tasks = update.tasks.length ? update.tasks : ensureArray(day.tasks, []).map(String);
    const taskKeys = tasks.map((_, taskIndex) => (
      ensureArray(day.taskKeys, [])[taskIndex]
        || `replan-${revisionId.slice(0, 8)}-update-${day.day}-${taskIndex}`
    ));
    return {
      ...day,
      title: update.title || day.title,
      estimate: update.estimate || day.estimate,
      focus: update.focus || day.focus,
      tasks,
      taskKeys,
      checkpoint: update.checkpoint || day.checkpoint,
      knowledgePoints: update.knowledgePoints.length ? update.knowledgePoints : day.knowledgePoints,
      conceptIds: alignConceptIds(update.conceptIds, tasks.length, day),
      revisionId,
      revisionMeta: {
        type: "llm-updated-day",
        reason: update.reason || "LLM 根据学习证据调整后续学习日",
        createdBy: LLM_REPLANNING_AGENT
      }
    };
  });
}

function applyModelInsertDays(days, insertDays, { revisionId, progress, input }) {
  if (!insertDays.length) return days;
  const touchedThroughIndex = latestTouchedDayIndex(days, progress);
  const minPosition = Math.max(0, touchedThroughIndex + 1);
  const result = [...days];
  const ordered = [...insertDays].sort((a, b) => a.afterDay - b.afterDay);
  let insertedBefore = 0;

  ordered.forEach((insertDay, index) => {
    const basePosition = Math.max(minPosition, Math.min(days.length, insertDay.afterDay));
    const position = Math.min(result.length, basePosition + insertedBefore);
    result.splice(position, 0, buildModelInsertedDay({
      revisionId,
      day: insertDay,
      input,
      ordinal: index
    }));
    insertedBefore += 1;
  });

  return result;
}

function buildModelInsertedDay({ revisionId, day, input, ordinal }) {
  const taskPrefix = `replan-${revisionId.slice(0, 8)}-llm-${ordinal + 1}`;
  const conceptIds = alignConceptIds(day.conceptIds, day.tasks.length);
  return {
    day: Number(day.afterDay || 0) + 1,
    title: day.title || "LLM 建议补强学习日",
    estimate: day.estimate || input.dailyMinutes || "45 分钟",
    focus: day.focus || "路径重规划",
    tasks: day.tasks,
    taskKeys: day.tasks.map((_, taskIndex) => `${taskPrefix}-task-${taskIndex}`),
    conceptId: conceptIds[0] || "",
    conceptIds,
    checkpoint: day.checkpoint || "完成本日任务后，再继续后续学习路径。",
    materials: [],
    knowledgePoints: day.knowledgePoints,
    materialsGeneratedAt: null,
    revisionId,
    revisionMeta: {
      type: "llm-inserted-day",
      reason: day.reason || "LLM 根据学习证据建议插入",
      createdBy: LLM_REPLANNING_AGENT
    }
  };
}

function alignConceptIds(conceptIds, length, fallbackDay = {}) {
  const fallback = ensureArray(fallbackDay.conceptIds, []);
  return Array.from({ length }, (_, index) => (
    conceptIds?.[index] || fallback[index] || fallbackDay.conceptId || ""
  ));
}

function hasCompletedTask(day, progress = {}) {
  return ensureArray(day?.tasks, []).some((_, index) => Boolean(progress[taskKeyFor(day, index)]));
}

function normalizeConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 70;
  return Math.max(20, Math.min(95, Math.round(numeric > 1 ? numeric : numeric * 100)));
}

function buildModelActions(proposal, diff) {
  return [
    ...proposal.insertDays.map((day) => ({
      type: "llm_insert_day",
      afterDay: day.afterDay,
      title: day.title,
      reason: day.reason || proposal.reason || "",
      tasks: day.tasks
    })),
    ...proposal.updateDays.map((day) => ({
      type: "llm_update_day",
      day: day.day,
      title: day.title,
      reason: day.reason || proposal.reason || "",
      tasks: day.tasks
    })),
    ...(diff.shiftedTasks?.length ? [{
      type: "defer_days",
      offset: diff.insertedDays?.length || 0,
      affectedTaskCount: diff.shiftedTasks.length,
      reason: "为插入 LLM 建议学习日，后续未完成任务按顺序顺延"
    }] : [])
  ];
}

function summarizeModelRevision(proposal, diff) {
  const inserted = diff.insertedDays?.length || 0;
  const updated = diff.updatedDays?.length || 0;
  const parts = [];
  if (inserted) parts.push(`新增 ${inserted} 个学习日`);
  if (updated) parts.push(`调整 ${updated} 个后续学习日`);
  return `${proposal.reason || "LLM 根据当前学习证据建议调整路径"}；${parts.join("，") || "优化后续学习安排"}。`;
}

function collectUpdatedDays(before, after, updatedTasks) {
  const updatedTaskKeys = new Set(ensureArray(updatedTasks, []).map((task) => task.taskKey));
  return ensureArray(after, [])
    .map((day) => {
      const keys = ensureArray(day.taskKeys, []);
      const beforeDay = ensureArray(before, []).find((item) => (
        ensureArray(item.taskKeys, []).some((key) => keys.includes(key))
      ));
      if (!beforeDay) return null;
      const hasUpdatedTask = keys.some((key) => updatedTaskKeys.has(key));
      const metaChanged = String(beforeDay.title || "") !== String(day.title || "")
        || String(beforeDay.focus || "") !== String(day.focus || "")
        || String(beforeDay.checkpoint || "") !== String(day.checkpoint || "");
      if (!hasUpdatedTask && !metaChanged) return null;
      return {
        day: day.day,
        title: day.title,
        focus: day.focus,
        tasks: ensureArray(day.tasks, []),
        reason: day.revisionMeta?.reason || ""
      };
    })
    .filter(Boolean);
}

export function diffDailyPlan(before, after) {
  const beforeKeys = new Set(extractPlanTasksFromDailyPlan(before).map((task) => task.taskKey));
  const afterTasks = extractPlanTasksFromDailyPlan(after);
  const insertedTaskKeys = afterTasks
    .filter((task) => !beforeKeys.has(task.taskKey))
    .map((task) => task.taskKey);
  const beforeByKey = new Map(extractPlanTasksFromDailyPlan(before).map((task) => [task.taskKey, task]));
  const shifted = afterTasks
    .filter((task) => beforeByKey.has(task.taskKey) && beforeByKey.get(task.taskKey).dayNumber !== task.dayNumber)
    .map((task) => ({
      taskKey: task.taskKey,
      fromDay: beforeByKey.get(task.taskKey).dayNumber,
      toDay: task.dayNumber,
      content: task.content
    }));
  const updatedTasks = afterTasks
    .filter((task) => beforeByKey.has(task.taskKey) && beforeByKey.get(task.taskKey).content !== task.content)
    .map((task) => ({
      taskKey: task.taskKey,
      day: task.dayNumber,
      before: beforeByKey.get(task.taskKey).content,
      after: task.content
    }));
  const insertedDays = ensureArray(after, [])
    .filter((day) => {
      const keys = ensureArray(day.taskKeys, []);
      return String(day.revisionMeta?.type || "").includes("inserted")
        || (keys.length && keys.every((key) => insertedTaskKeys.includes(key)));
    })
    .map((day) => ({
      day: day.day,
      title: day.title,
      focus: day.focus,
      tasks: ensureArray(day.tasks, [])
    }));
  const updatedDays = collectUpdatedDays(before, after, updatedTasks);

  return {
    insertedDays,
    insertedTaskKeys,
    shiftedTasks: shifted,
    updatedTasks,
    updatedDays,
    changedDayCount: insertedDays.length + updatedDays.length + new Set(shifted.map((item) => item.toDay)).size,
    preservedTaskCount: afterTasks.length - insertedTaskKeys.length
  };
}

function inferTriggerType({ diagnostic, recentWrong, overdue, exam }) {
  if (exam) return "exam_submitted";
  if (diagnostic && Number(diagnostic.percent || 0) < 70) return "diagnostic_completed";
  if (recentWrong.length >= 2) return "quiz_attempt_evaluated";
  if (overdue?.overdueDays >= 2) return "task_overdue";
  return "manual";
}

function estimateOverdue(plan, now) {
  const dailyPlan = ensureArray(plan?.data?.dailyPlan, []);
  if (!dailyPlan.length || !plan?.createdAt) return { overdueDays: 0 };
  const started = new Date(plan.createdAt).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(current) || current <= started) return { overdueDays: 0 };
  const elapsedDays = Math.floor((current - started) / 86_400_000) + 1;
  const completedDays = currentLearningPosition(dailyPlan, plan?.progress || {}).completedDays;
  return {
    elapsedDays,
    completedDays,
    overdueDays: Math.max(0, elapsedDays - completedDays - 1)
  };
}

function groupCounts(values) {
  const counts = {};
  for (const value of values.filter(Boolean)) {
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function uniqueByKey(items, keyOf) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function scorePercent(item) {
  const maxScore = Number(item.maxScore || item.result?.maxScore || 0);
  if (!maxScore) return 0;
  return Math.round((Number(item.score || item.result?.score || 0) / maxScore) * 100);
}
