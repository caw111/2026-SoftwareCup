import { publicModelConfig } from "../config.js";
import { parseJsonFromModel, requestChatCompletion } from "../llm.js";
import {
  advanceProfileInterviewLocally,
  buildProfileInterviewFromDraft,
  createProfileInterviewState
} from "../profile-interview.js";
import { clean } from "../utils.js";

const PROFILE_FIELDS = [
  "topic",
  "major",
  "goal",
  "level",
  "duration",
  "dailyMinutes",
  "style",
  "weaknesses",
  "learningHistory"
];

const FIELD_LIMITS = {
  topic: 120,
  major: 120,
  goal: 300,
  level: 20,
  duration: 40,
  dailyMinutes: 40,
  style: 20,
  weaknesses: 300,
  learningHistory: 500
};

export function createProfileInterviewSession() {
  const model = publicModelConfig();
  return withModelState(createProfileInterviewState(), model, model.enabled ? "llm-ready" : "local-fallback", {
    warning: model.enabled ? null : "尚未配置大模型，画像访谈暂时使用本地规则。"
  });
}

export async function advanceProfileInterviewWithLlm(input, dependencies = {}) {
  const localResult = advanceProfileInterviewLocally(input);
  const model = dependencies.modelConfig || publicModelConfig();
  const requestModel = dependencies.requestModel || requestChatCompletion;

  if (!model.enabled) {
    return withModelState(localResult, model, "local-fallback", {
      warning: "尚未配置大模型，本轮已使用本地规则完成画像更新。",
      fallbackReason: "model-not-configured"
    });
  }

  try {
    const modelMessages = buildProfileInterviewMessages(input, localResult);
    const firstResponse = await requestProfileModelWithRetry(requestModel, modelMessages, dependencies);
    let payload;
    let attempts = firstResponse.attempts;
    try {
      payload = parseAndValidateModelPayload(firstResponse.content);
    } catch (parseError) {
      const repairMessages = [
        ...modelMessages,
        { role: "assistant", content: clean(firstResponse.content, 2400) },
        { role: "user", content: "上一条响应不符合约定的 JSON 结构。请根据原对话重新输出一个完整、有效的 JSON 对象，不要输出任何额外文本。" }
      ];
      const repaired = await requestProfileModelWithRetry(requestModel, repairMessages, dependencies);
      attempts += repaired.attempts;
      try {
        payload = parseAndValidateModelPayload(repaired.content);
      } catch {
        throw parseError;
      }
    }
    return {
      ...buildLlmResult(input, localResult, payload, model),
      llmAttempts: attempts
    };
  } catch (error) {
    return withModelState(localResult, model, "local-fallback", {
      warning: "大模型本轮响应异常，已保留你的输入并使用本地规则继续画像。你可以直接重试。",
      fallbackReason: classifyModelError(error),
      fallbackDetail: clean(error instanceof Error ? error.message : String(error), 240)
    });
  }
}

async function requestProfileModelWithRetry(requestModel, messages, dependencies) {
  const options = { temperature: 0.35, maxTokens: 1200 };
  const delayMs = Math.max(0, Number(dependencies.retryDelayMs ?? 180));
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return { content: await requestModel(messages, options), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt === 2 || !isTransientModelError(error)) throw error;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export function buildProfileInterviewMessages(input, localResult) {
  const currentDraft = sanitizeDraftForPrompt(input?.draft || {});
  const recentHistory = Array.isArray(input?.messages)
    ? input.messages.slice(-10).map((item) => ({
      role: item?.role === "student" ? "user" : "assistant",
      content: clean(item?.content, 1600)
    })).filter((item) => item.content)
    : [];
  const missing = localResult.completeness?.missing || [];
  const system = `你是 LearnMate 的学习画像智能体，正在与学生进行中文多轮访谈。

你的任务不是机械填写表单，而是理解学生真实的学习情境，并帮助其形成可用于生成个性化课程的画像。

当前服务端画像草稿：${JSON.stringify(currentDraft)}
本轮本地确定性抽取后的缺失字段：${JSON.stringify(missing)}

必须遵守：
1. 先自然回应并简短复述本轮真正识别到的信息，再追问最多一个最有价值的问题；不要重复询问已有信息。
2. 学生明确说“改成、不是、其实、重新调整”等内容时，应修正旧字段。
3. 不得猜测学生没有表达的信息；未知字段返回空字符串。
4. level 只能是：零基础、入门、进阶、冲刺竞赛。
5. style 只能是：案例驱动、图文讲解、项目实战、题目训练。
6. dailyMinutes 统一写成“数字 分钟”，例如“45 分钟”；duration 使用“2 周、1 个月”等简洁形式。
7. assistantMessage 使用 2 到 4 句自然中文，不使用 Markdown 标题，不连续提出多个问题。画像足够完整时邀请学生确认并生成课程。
8. evidence 中的 quote 必须来自学生真实说过的话，不能编造。
9. 只输出一个 JSON 对象，不要输出代码围栏或额外解释。

严格使用以下结构：
{
  "assistantMessage": "自然对话回复",
  "draft": {
    "topic": "", "major": "", "goal": "", "level": "",
    "duration": "", "dailyMinutes": "", "style": "",
    "weaknesses": "", "learningHistory": ""
  },
  "confidence": { "字段名": 0.0 },
  "evidence": [{ "field": "字段名", "quote": "学生原话" }],
  "nextField": "一个仍需确认的字段名或空字符串",
  "suggestions": ["2 至 4 个贴合当前问题的简短回答"]
}`;

  return [
    { role: "system", content: system },
    ...recentHistory,
    { role: "user", content: clean(input?.message, 1600) }
  ];
}

function parseAndValidateModelPayload(content) {
  const value = parseJsonFromModel(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("大模型画像响应不是对象");
  }
  const assistantMessage = clean(value.assistantMessage || value.reply, 1600);
  if (!assistantMessage) throw new Error("大模型画像响应缺少 assistantMessage");
  return {
    assistantMessage,
    draft: value.draft && typeof value.draft === "object" ? value.draft : {},
    confidence: value.confidence && typeof value.confidence === "object" ? value.confidence : {},
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    nextField: PROFILE_FIELDS.includes(value.nextField) ? value.nextField : "",
    suggestions: normalizeSuggestions(value.suggestions)
  };
}

function buildLlmResult(input, localResult, payload, model) {
  const draft = mergeModelDraft(localResult.draft, payload.draft, payload.confidence);
  const refreshed = buildProfileInterviewFromDraft({
    message: input.message,
    draft,
    messages: input.messages,
    assistantContent: payload.assistantMessage,
    suggestions: payload.suggestions,
    mode: "llm"
  });
  if (payload.nextField) refreshed.messages.at(-1).field = payload.nextField;
  refreshed.extractionEvidence = normalizeEvidence(payload.evidence, input);
  return withModelState(refreshed, model, "llm", { warning: null });
}

function mergeModelDraft(baseDraft, candidate, confidence) {
  const merged = {
    ...baseDraft,
    confidence: { ...(baseDraft?.confidence || {}) }
  };
  for (const field of PROFILE_FIELDS) {
    const value = normalizeProfileValue(field, candidate?.[field]);
    if (!value) continue;
    merged[field] = value;
    const score = Number(confidence?.[field]);
    merged.confidence[field] = Number.isFinite(score)
      ? Math.max(0.35, Math.min(0.99, Math.round(score * 100) / 100))
      : Math.max(Number(merged.confidence[field] || 0), 0.76);
  }
  return merged;
}

function normalizeProfileValue(field, value) {
  const text = clean(value, FIELD_LIMITS[field] || 240);
  if (!text) return "";
  if (field === "level") {
    if (/零基础|完全没学过|从零/.test(text)) return "零基础";
    if (/冲刺|竞赛|比赛|考试|考研/.test(text)) return "冲刺竞赛";
    if (/进阶|深入|熟悉|项目经验/.test(text)) return "进阶";
    if (/入门|基础|了解|接触/.test(text)) return "入门";
    return "";
  }
  if (field === "style") {
    if (/案例|场景|例子/.test(text)) return "案例驱动";
    if (/图文|图解|可视化|思维导图/.test(text)) return "图文讲解";
    if (/项目|实战|作品|动手/.test(text)) return "项目实战";
    if (/题|练习|刷题/.test(text)) return "题目训练";
    return "";
  }
  if (field === "dailyMinutes") return normalizeMinutes(text);
  return text;
}

function normalizeMinutes(value) {
  const amount = Number.parseFloat(value.match(/\d+(?:\.\d+)?/)?.[0] || "");
  if (!Number.isFinite(amount)) return "";
  const minutes = /小时|hour/i.test(value) ? amount * 60 : amount;
  return `${Math.max(10, Math.min(720, Math.round(minutes)))} 分钟`;
}

function normalizeEvidence(items, input) {
  const corpus = [
    ...(Array.isArray(input?.messages) ? input.messages.map((item) => item?.role === "student" ? item.content : "") : []),
    input?.message
  ].map((item) => clean(item, 1800)).filter(Boolean).join("\n");
  return items.slice(0, 12).map((item) => {
    const field = PROFILE_FIELDS.includes(item?.field) ? item.field : "";
    const quote = clean(item?.quote, 240);
    if (!field || !quote || !corpus.includes(quote)) return null;
    return { field, quote, source: "student-message" };
  }).filter(Boolean);
}

function normalizeSuggestions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => clean(item, 80)).filter(Boolean))].slice(0, 4);
}

function sanitizeDraftForPrompt(draft) {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [field, clean(draft?.[field], FIELD_LIMITS[field]) || ""]));
}

function withModelState(result, model, mode, extras = {}) {
  return {
    ...result,
    mode,
    model: model?.enabled ? model.model : null,
    llm: {
      enabled: Boolean(model?.enabled),
      model: model?.model || null,
      wireApi: model?.wireApi || null
    },
    ...extras
  };
}

function classifyModelError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/JSON|assistantMessage|不是对象/.test(message)) return "invalid-model-response";
  if (/超时|timeout/i.test(message)) return "model-timeout";
  return "model-unavailable";
}

function isTransientModelError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:接口返回|HTTP)\s*(?:429|500|502|503|504)|temporarily unavailable|ECONNRESET|fetch failed|超时|timeout/i.test(message);
}
