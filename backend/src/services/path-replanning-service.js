import crypto from "node:crypto";

import { MODEL_CONFIG } from "../config.js";
import { parseJsonFromModel, requestChatCompletion } from "../llm.js";
import {
  buildLearningEvidence,
  buildPathReplanningContext,
  buildRevisionFromModelProposal,
  shouldProposeReplanning
} from "../path-replanning.js";
import {
  applyPathRevisionRecord,
  createLearningEventRecord,
  createPathRevisionRecord,
  expireOpenPathRevisionRecords,
  findOpenPathRevisionRecord,
  getPathRevisionRecord,
  listPathRevisionRecords,
  rejectPathRevisionRecord,
  undoPathRevisionRecord
} from "../repositories/path-revision-repository.js";
import { getWorkspaceForUser } from "./plan-service.js";

export async function recordLearningEventForUser(userId, planId, event) {
  if (!planId) return null;
  return createLearningEventRecord(userId, planId, event || {});
}

export async function evaluatePathReplanningForUser(userId, planId, options = {}) {
  const plan = await findPlanForUser(userId, planId);
  const triggerType = String(options.triggerType || "manual").slice(0, 80);
  const existing = options.force ? null : await findOpenPathRevisionRecord(userId, planId, triggerType);
  if (existing && isLlmRevision(existing)) {
    return {
      ok: true,
      reused: true,
      revision: existing,
      revisions: await listPathRevisionRecords(userId, planId)
    };
  }
  if (existing && !isLlmRevision(existing)) {
    await expireOpenPathRevisionRecords(userId, planId, { triggerType, nonLlmOnly: true });
  }
  if (options.force) {
    await expireOpenPathRevisionRecords(userId, planId);
  }

  const triggerEventIds = [];
  if (options.recordEvent !== false) {
    const event = await createLearningEventRecord(userId, planId, {
      type: triggerType,
      eventKey: options.eventKey || null,
      payload: options.payload || {},
      occurredAt: options.occurredAt || new Date().toISOString()
    });
    if (event?.id) triggerEventIds.push(event.id);
  }

  const evidence = buildLearningEvidence(plan, {
    triggerType,
    ...(options.payload || {}),
    exam: options.payload?.exam || null
  });
  const decision = shouldProposeReplanning(evidence);
  if (!options.force && !decision.propose) {
    return {
      ok: true,
      revision: null,
      reason: decision.reason,
      evidence,
      revisions: await listPathRevisionRecords(userId, planId)
    };
  }

  const revision = await proposePathRevisionWithLlm(plan, {
    revisionId: crypto.randomUUID(),
    triggerType,
    triggerEventIds,
    evidence,
    forceSuggestion: Boolean(options.force)
  });

  if (!revision || revision.skipped) {
    return {
      ok: true,
      revision: null,
      reason: revision?.reason || "LLM 判断当前无需调整路径",
      evidence,
      revisions: await listPathRevisionRecords(userId, planId)
    };
  }

  const stored = await createPathRevisionRecord(userId, planId, plan.version || 1, revision);
  return {
    ok: true,
    revision: stored,
    revisions: await listPathRevisionRecords(userId, planId)
  };
}

export async function listPathRevisionsForUser(userId, planId) {
  await findPlanForUser(userId, planId);
  return { ok: true, revisions: await listPathRevisionRecords(userId, planId) };
}

export async function getPathRevisionForUser(userId, planId, revisionId) {
  await findPlanForUser(userId, planId);
  const revision = await getPathRevisionRecord(userId, planId, revisionId);
  if (!revision) throw notFound("路径修订不存在");
  return { ok: true, revision };
}

export async function applyPathRevisionForUser(userId, planId, revisionId) {
  const revision = await applyPathRevisionRecord(userId, planId, revisionId);
  if (!revision) throw notFound("路径修订不存在");
  const workspace = await getWorkspaceForUser(userId);
  return {
    ok: true,
    revision,
    workspace,
    revisions: await listPathRevisionRecords(userId, planId)
  };
}

export async function rejectPathRevisionForUser(userId, planId, revisionId) {
  const ok = await rejectPathRevisionRecord(userId, planId, revisionId);
  if (!ok) throw notFound("可拒绝的路径修订不存在");
  return {
    ok: true,
    revisions: await listPathRevisionRecords(userId, planId)
  };
}

export async function undoPathRevisionForUser(userId, planId, revisionId) {
  const revision = await undoPathRevisionRecord(userId, planId, revisionId);
  if (!revision) throw notFound("可撤销的路径修订不存在");
  const workspace = await getWorkspaceForUser(userId);
  return {
    ok: true,
    revision,
    workspace,
    revisions: await listPathRevisionRecords(userId, planId)
  };
}

async function findPlanForUser(userId, planId) {
  const workspace = await getWorkspaceForUser(userId);
  const plan = workspace.plans.find((item) => item.id === planId);
  if (!plan) throw notFound("学习方案不存在");
  return plan;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

async function proposePathRevisionWithLlm(plan, options) {
  if (!MODEL_CONFIG.apiKey) {
    return {
      skipped: true,
      reason: "未配置大模型，无法生成 LLM 路径变更建议",
      evidence: options.evidence
    };
  }

  const context = {
    ...buildPathReplanningContext(plan, options.evidence),
    forceSuggestion: Boolean(options.forceSuggestion)
  };
  let previousIssues = [];
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const content = await requestChatCompletion([
        {
          role: "system",
          content: [
            "你是中文个性化学习系统的路径重规划专家。",
            "你的任务是基于学习证据提出结构化路径变更建议，而不是套用固定模板。",
            "必须保护学习者已完成的任务：不得删除、移动、改写 completed=true 的任务。",
            "只能输出可解析 JSON，不要 Markdown，不要代码块。"
          ].join("")
        },
        {
          role: "user",
          content: buildPathReplanningPrompt(context, previousIssues)
        }
      ], { temperature: 0.25, maxTokens: 2600 });
      const proposal = parseJsonFromModel(content);
      const revision = buildRevisionFromModelProposal(plan, proposal, {
        ...options,
        model: MODEL_CONFIG.model,
        requireOperationalProposal: Boolean(options.forceSuggestion)
      });
      return revision;
    } catch (error) {
      lastError = error;
      previousIssues = [error instanceof Error ? error.message : String(error)];
    }
  }

  return {
    skipped: true,
    reason: `LLM 路径变更建议生成失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
    evidence: options.evidence
  };
}

function buildPathReplanningPrompt(context, previousIssues = []) {
  const repair = previousIssues.length
    ? `\n上一次输出没有通过系统校验，请修正这些问题：${previousIssues.join("；")}。`
    : "";
  const forceInstruction = context.forceSuggestion
    ? "\n本次是用户主动点击“让 LLM 重新检查”。除非所有学习任务都已完成且没有任何可调整空间，否则必须输出至少一个 insertDays 或 updateDays，给出真正由你生成的路径建议。"
    : "";
  return `请根据下面的学习状态快照，判断是否需要调整学习路径，并给出可执行的结构化建议。

输出 JSON Schema：
{
  "shouldReplan": true,
  "reason": "为什么需要或不需要调整，必须引用快照中的证据",
  "summary": "给学习者看的简短中文摘要",
  "confidence": 0.82,
  "insertDays": [
    {
      "afterDay": 1,
      "title": "新增学习日标题",
      "estimate": "45 分钟",
      "focus": "本日聚焦",
      "tasks": ["具体任务1", "具体任务2", "具体任务3"],
      "checkpoint": "完成标准",
      "knowledgePoints": ["知识点"],
      "conceptIds": ["可选知识点ID"],
      "reason": "为什么插入这一天"
    }
  ],
  "updateDays": [
    {
      "day": 3,
      "title": "可选：改写后的原学习日标题",
      "estimate": "可选",
      "focus": "可选",
      "tasks": ["可选：改写后的任务1", "任务2", "任务3"],
      "checkpoint": "可选：新的完成标准",
      "knowledgePoints": ["可选"],
      "conceptIds": ["可选"],
      "reason": "为什么调整这个后续学习日"
    }
  ]
}

硬性约束：
1. 如果证据不足或当前路径合理，返回 {"shouldReplan": false, "reason": "...", "summary": "...", "confidence": 0.6, "insertDays": [], "updateDays": []}。
2. insertDays 最多 2 个，updateDays 最多 4 个。
3. 每个新增学习日的 tasks 必须是由你根据主题、错因、诊断和当前路径生成的具体学习任务，不能套用通用模板。
4. afterDay 表示插入到原路径第几天之后；不要插入到任何 completed=true 任务所在学习日之前。
5. updateDays 只能调整尚未开始、没有 completed=true 任务的后续学习日。
6. 不要输出 taskKey，系统会为新增任务生成稳定 key，并保留原任务 key。
7. 不要输出课程讲义正文，只输出路径层面的任务、聚焦点和完成标准。
8. 摘要要说明“为什么调”和“调哪里”，不要空泛。
${forceInstruction}
${repair}

学习状态快照：
${JSON.stringify(context)}`;
}

function isLlmRevision(revision) {
  return String(revision?.createdByAgent || "").includes("LLM");
}
