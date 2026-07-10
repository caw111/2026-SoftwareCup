import crypto from "node:crypto";

import {
  createPlanRecord,
  getWorkspaceRecord,
  planExistsForUser,
  resetPlanProgressRecord,
  setActivePlanRecord,
  softDeletePlanRecord,
  updatePlanContentRecord,
  updatePlanNotesRecord,
  updateTaskProgressRecord
} from "../repositories/plan-repository.js";
import {
  createQuizAttemptRecord,
  createQuizSessionRecord,
  getLatestQuizStateRecord
} from "../repositories/quiz-repository.js";
import {
  claimLegacyImportRecord,
  releaseLegacyImportRecord
} from "../repositories/legacy-repository.js";

export async function getWorkspaceForUser(userId) {
  const workspace = await getWorkspaceRecord(userId);
  const quizState = await getLatestQuizStateRecord(userId, workspace.currentPlanId);
  return { ...workspace, ...quizState };
}

export async function createPlanForUser(userId, value) {
  const plan = normalizePlan(value);
  if (await planExistsForUser(userId, plan.id)) {
    const error = new Error("方案 ID 已存在");
    error.statusCode = 409;
    throw error;
  }
  return createPlanRecord(userId, plan);
}

export async function setActivePlanForUser(userId, planId) {
  const ok = await setActivePlanRecord(userId, planId || null);
  if (!ok) throw notFound("学习方案不存在");
  return { ok: true, currentPlanId: planId || null };
}

export async function deletePlanForUser(userId, planId) {
  const ok = await softDeletePlanRecord(userId, planId);
  if (!ok) throw notFound("学习方案不存在");
  return { ok: true };
}

export async function updatePlanNotesForUser(userId, planId, notes) {
  const normalizedNotes = String(notes ?? "").slice(0, 100000);
  const ok = await updatePlanNotesRecord(userId, planId, normalizedNotes);
  if (!ok) throw notFound("学习方案不存在");
  return { ok: true, notes: normalizedNotes };
}

export async function updatePlanContentForUser(userId, planId, payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : null;
  if (!data) {
    const error = new Error("方案内容不能为空");
    error.statusCode = 400;
    throw error;
  }
  const masteryEvidence = Array.isArray(payload?.masteryEvidence) ? payload.masteryEvidence : undefined;
  const ok = await updatePlanContentRecord(userId, planId, { data, masteryEvidence });
  if (!ok) throw notFound("学习方案不存在");
  return { ok: true, data, masteryEvidence };
}

export async function updateTaskProgressForUser(userId, planId, taskKey, completed) {
  const ok = await updateTaskProgressRecord(userId, planId, taskKey, Boolean(completed));
  if (!ok) throw notFound("学习任务不存在");
  return { ok: true, taskKey, completed: Boolean(completed) };
}

export async function resetPlanProgressForUser(userId, planId) {
  if (!(await planExistsForUser(userId, planId))) throw notFound("学习方案不存在");
  const count = await resetPlanProgressRecord(userId, planId);
  return { ok: true, resetTasks: count };
}

export async function importLegacyWorkspaceForUser(userId, value) {
  const existing = await getWorkspaceRecord(userId);
  if (existing.plans.length) {
    const error = new Error("当前用户已经存在数据库方案，不能重复导入");
    error.statusCode = 409;
    throw error;
  }

  const importedPlans = [];
  for (const valuePlan of Array.isArray(value?.plans) ? value.plans : []) {
    const plan = normalizePlan(valuePlan);
    await createPlanRecord(userId, plan);
    importedPlans.push(plan);
  }
  const activePlanId = importedPlans.some((plan) => plan.id === value?.currentPlanId)
    ? value.currentPlanId
    : importedPlans[0]?.id || null;
  await setActivePlanRecord(userId, activePlanId);

  if (activePlanId && Array.isArray(value?.quiz) && value.quiz.length) {
    const created = await createQuizSessionRecord(userId, activePlanId, {
      roundNumber: importedPlans.find((plan) => plan.id === activePlanId)?.quizRound || 0,
      mode: "legacy-import",
      summary: { imported: true },
      quiz: value.quiz
    });
    for (const question of created?.quiz || []) {
      const result = value?.quizResults?.[question.id];
      if (result) {
        await createQuizAttemptRecord(
          userId,
          question.databaseId,
          result.evidence?.answer ?? result.evidence?.selectedIndex ?? null,
          result
        );
      }
    }
  }
  return { ok: true, importedPlans: importedPlans.length, currentPlanId: activePlanId };
}

export async function claimServerLegacyWorkspaceForUser(userId, value) {
  if (!Array.isArray(value?.plans) || !value.plans.length) return false;
  const sourceKey = "legacy-workspace-state-v2";
  const claimed = await claimLegacyImportRecord(userId, sourceKey);
  if (!claimed) return false;
  try {
    await importLegacyWorkspaceForUser(userId, value);
    return true;
  } catch (error) {
    await releaseLegacyImportRecord(userId, sourceKey);
    throw error;
  }
}

function normalizePlan(value) {
  const id = String(value?.id || crypto.randomUUID()).slice(0, 64);
  const createdAt = Number.isNaN(Date.parse(value?.createdAt))
    ? new Date().toISOString()
    : new Date(value.createdAt).toISOString();
  return {
    id,
    title: String(value?.title || value?.data?.resourcePackage?.title || "学习方案").slice(0, 255),
    category: String(value?.category || value?.data?.input?.outputType || "完整学习方案").slice(0, 100),
    createdAt,
    data: value?.data && typeof value.data === "object" ? value.data : {},
    progress: value?.progress && typeof value.progress === "object" ? value.progress : {},
    notes: String(value?.notes || "").slice(0, 100000),
    masteryEvidence: Array.isArray(value?.masteryEvidence) ? value.masteryEvidence : [],
    quizHistory: Array.isArray(value?.quizHistory) ? value.quizHistory : [],
    quizRound: Math.max(0, Number(value?.quizRound || 0))
  };
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}
