import crypto from "node:crypto";

import { clean } from "./utils.js";

const FIELD_ORDER = ["topic", "major", "goal", "level", "duration", "dailyMinutes", "style", "weaknesses"];

const FIELD_META = {
  topic: { label: "学习主题", weight: 20, question: "你最想系统学习的课程或主题是什么？" },
  major: { label: "专业背景", weight: 10, question: "你的专业、年级或当前学习方向是什么？" },
  goal: { label: "学习目标", weight: 16, question: "完成这次学习后，你希望能解决什么问题或交付什么成果？" },
  level: { label: "当前基础", weight: 12, question: "你目前是零基础、入门、进阶，还是正在准备竞赛或考试？" },
  duration: { label: "学习周期", weight: 10, question: "你准备投入几天、几周或几个月完成这一阶段？" },
  dailyMinutes: { label: "每日时间", weight: 10, question: "你每天通常能稳定安排多少分钟学习？" },
  style: { label: "学习偏好", weight: 10, question: "你更喜欢案例、图文、项目实战，还是题目训练？" },
  weaknesses: { label: "薄弱点", weight: 12, question: "目前最容易卡住、做错或不理解的地方是什么？" }
};

export function createProfileInterviewState(seed = {}) {
  const draft = normalizeDraft(seed);
  return buildInterviewResult({ draft, messages: [], lastMessage: "" });
}

export function advanceProfileInterviewLocally({ message, draft = {}, messages = [] }) {
  const normalizedMessage = clean(message, 1600);
  if (!normalizedMessage) {
    const error = new Error("请先描述你的学习需求");
    error.statusCode = 400;
    throw error;
  }
  const nextDraft = extractProfileFields(normalizedMessage, normalizeDraft(draft));
  const history = normalizeMessages(messages);
  history.push({
    id: crypto.randomUUID(),
    role: "student",
    content: normalizedMessage,
    at: new Date().toISOString()
  });
  return buildInterviewResult({ draft: nextDraft, messages: history, lastMessage: normalizedMessage });
}

export function extractProfileFields(message, currentDraft = {}) {
  const text = clean(message, 1600);
  const draft = normalizeDraft(currentDraft);
  const set = (field, value, confidence = 0.76) => {
    const normalized = clean(value, field === "learningHistory" ? 500 : 240)
      .replace(/^(是|为|想要|希望|计划|大概|每天|每日)[：:\s]*/, "")
      .replace(/[，。；]+$/, "")
      .trim();
    if (!normalized) return;
    draft[field] = normalized;
    draft.confidence[field] = Math.max(Number(draft.confidence[field] || 0), confidence);
  };

  const topic = text.match(/(?:我?想学|想要学习|准备学习|学习主题(?:是|为|：|:)?|课程(?:是|为|：|:)?)([^，。；\n]{2,48})/i)?.[1];
  if (topic) set("topic", stripTopicTail(topic), 0.9);
  else if (!draft.topic && text.length <= 32 && !looksLikeOnlySchedule(text)) set("topic", stripTopicTail(text), 0.62);

  const major = text.match(/我是([^，。；\n]{2,24}?)(?:专业)?(?:学生|大[一二三四]|研[一二三]|本科|研究生)/)?.[1]
    || text.match(/(?:专业(?:是|为|：|:)|主修|就读于?)([^，。；\n]{2,32})/i)?.[1];
  if (major) set("major", major.replace(/专业$/, ""), 0.88);

  if (/零基础|完全没学过|从零开始|没有基础/.test(text)) set("level", "零基础", 0.95);
  else if (/冲刺|竞赛|比赛|考研|期末|考试/.test(text)) set("level", "冲刺竞赛", 0.84);
  else if (/进阶|深入|有项目经验|系统学过|比较熟悉/.test(text)) set("level", "进阶", 0.88);
  else if (/入门|了解一点|接触过|学过一些|基础一般/.test(text)) set("level", "入门", 0.84);

  const duration = text.match(/(?:计划|周期|准备用|希望用|在)?\s*([一二三四五六七八九十两\d]{1,3}\s*(?:天|周|个?月))/)?.[1];
  if (duration) set("duration", duration.replace(/\s+/g, " "), 0.94);

  const daily = text.match(/(?:每天|每日|一天)(?:能|可|大概|稳定|安排|学习|投入)*\s*(\d+(?:\.\d+)?\s*(?:分钟|小时))/)?.[1];
  if (daily) set("dailyMinutes", normalizeDailyMinutes(daily), 0.96);

  if (/案例|场景|例子|结合实际/.test(text)) set("style", "案例驱动", 0.86);
  else if (/图文|图解|可视化|思维导图/.test(text)) set("style", "图文讲解", 0.86);
  else if (/项目|实战|作品|动手做/.test(text)) set("style", "项目实战", 0.86);
  else if (/刷题|做题|题目|练习为主/.test(text)) set("style", "题目训练", 0.86);

  const goal = text.match(/(?:目标(?:是|为|：|:)?|希望(?:能够|能|学会)?|想要(?:能够|能)?)([^。；\n]{4,160})/)?.[1];
  if (goal) set("goal", goal, 0.82);

  const weaknesses = text.match(/([^，。；\n]{2,90})(?:不熟悉|不理解|不会|薄弱|欠缺)/)?.[1]
    || text.match(/(?:薄弱点?|容易(?:做)?错|困难|卡在|卡住)(?:是|的|在|为|：|:)?([^，。；\n]{2,140})/)?.[1];
  if (weaknesses) set("weaknesses", weaknesses, 0.88);

  const history = text.match(/(?:之前|已经|曾经|学过|接触过|做过)([^。；\n]{3,220})/)?.[0];
  if (history) set("learningHistory", history, 0.78);

  return draft;
}

export function buildProfilePreview(draft = {}) {
  const levelBase = { "零基础": 34, "入门": 49, "进阶": 67, "冲刺竞赛": 73 }[draft.level] ?? 45;
  const evidenceText = `${draft.weaknesses || ""} ${draft.learningHistory || ""}`;
  const dimensions = [
    { key: "foundation", dimension: "先修基础", words: ["数学", "公式", "英语", "基础", "没学过"] },
    { key: "concept", dimension: "概念理解", words: ["概念", "原理", "不理解", "流程"] },
    { key: "transfer", dimension: "方法迁移", words: ["应用", "迁移", "场景", "不会用"] },
    { key: "practice", dimension: "实践应用", words: ["项目", "代码", "实操", "动手"] },
    { key: "review", dimension: "表达复盘", words: ["总结", "复盘", "表达", "报告"] },
    { key: "selfDrive", dimension: "学习自驱", words: ["拖延", "坚持", "计划", "时间"] }
  ].map((item, index) => {
    const weaknessHit = item.words.some((word) => evidenceText.includes(word));
    const preferenceBoost = draft.style === "项目实战" && item.key === "practice" ? 7
      : draft.style === "图文讲解" && item.key === "concept" ? 5
        : draft.style === "题目训练" && item.key === "review" ? 4
          : 0;
    const score = clampScore(levelBase + preferenceBoost + (index % 2 ? 2 : 0) - (weaknessHit ? 16 : 0));
    const evidence = weaknessHit
      ? `对话中识别到与“${item.dimension}”相关的薄弱线索。`
      : draft.level
        ? `依据当前基础“${draft.level}”形成初始估计，待诊断题校准。`
        : "信息尚少，当前为低置信初始估计。";
    return {
      ...item,
      score,
      confidence: round2(0.28 + Number(Boolean(draft.level)) * 0.18 + Number(Boolean(draft.weaknesses)) * 0.16),
      evidence,
      source: "profile-interview"
    };
  });
  return {
    dimensions,
    summary: profileSummary(draft, dimensions),
    weakestDimensions: [...dimensions].sort((left, right) => left.score - right.score).slice(0, 2),
    tags: [draft.major, draft.level, draft.style, draft.duration].filter(Boolean)
  };
}

function buildInterviewResult({ draft, messages, lastMessage }) {
  const completeness = calculateCompleteness(draft);
  const preview = buildProfilePreview(draft);
  const nextField = completeness.missing[0] || null;
  const assistantContent = nextField
    ? `${lastMessage ? summarizeExtraction(draft, lastMessage) : "你好，我是学习画像智能体。"}\n\n${FIELD_META[nextField].question}`
    : `画像信息已经完整。我识别到你希望学习“${draft.topic}”，当前基础为“${draft.level}”，会优先围绕“${draft.weaknesses}”安排学习。你可以继续补充，或确认画像并生成课程。`;
  const nextMessages = normalizeMessages(messages);
  nextMessages.push({
    id: crypto.randomUUID(),
    role: "assistant",
    content: assistantContent,
    at: new Date().toISOString(),
    field: nextField
  });
  return {
    draft,
    messages: nextMessages.slice(-24),
    completeness,
    profilePreview: preview,
    nextQuestion: nextField ? FIELD_META[nextField].question : null,
    suggestions: suggestionsFor(nextField),
    ready: completeness.percent >= 80 && Boolean(draft.topic && draft.goal),
    mode: "profile-interview-rules-v1"
  };
}

function calculateCompleteness(draft) {
  const completed = FIELD_ORDER.filter((field) => Boolean(draft[field]));
  const missing = FIELD_ORDER.filter((field) => !draft[field]);
  const percent = completed.reduce((sum, field) => sum + FIELD_META[field].weight, 0);
  return {
    percent,
    completed,
    missing,
    fields: FIELD_ORDER.map((field) => ({
      field,
      label: FIELD_META[field].label,
      completed: Boolean(draft[field]),
      confidence: Number(draft.confidence?.[field] || 0)
    }))
  };
}

function normalizeDraft(value = {}) {
  const draft = {
    topic: clean(value.topic, 120),
    major: clean(value.major, 120),
    goal: clean(value.goal, 300),
    level: ["零基础", "入门", "进阶", "冲刺竞赛"].includes(value.level) ? value.level : "",
    duration: clean(value.duration, 40),
    dailyMinutes: clean(value.dailyMinutes, 40),
    style: ["案例驱动", "图文讲解", "项目实战", "题目训练"].includes(value.style) ? value.style : "",
    weaknesses: clean(value.weaknesses, 300),
    learningHistory: clean(value.learningHistory, 500),
    confidence: value.confidence && typeof value.confidence === "object" ? { ...value.confidence } : {}
  };
  return draft;
}

function normalizeMessages(messages) {
  return Array.isArray(messages)
    ? messages.slice(-22).map((item) => ({
      id: clean(item?.id, 80) || crypto.randomUUID(),
      role: item?.role === "student" ? "student" : "assistant",
      content: clean(item?.content, 1800),
      at: Number.isNaN(Date.parse(item?.at)) ? new Date().toISOString() : new Date(item.at).toISOString(),
      ...(item?.field ? { field: clean(item.field, 40) } : {})
    })).filter((item) => item.content)
    : [];
}

function stripTopicTail(value) {
  return String(value || "")
    .replace(/(?:，|,)?(?:目标|希望|每天|周期|目前|但是|并且).*$/i, "")
    .replace(/(?:这门)?课程$/, "")
    .trim();
}

function looksLikeOnlySchedule(text) {
  return /每天|每日|分钟|小时|\d+\s*(?:天|周|月)/.test(text);
}

function normalizeDailyMinutes(value) {
  const amount = Number.parseFloat(String(value).match(/\d+(?:\.\d+)?/)?.[0] || "45");
  return String(value).includes("小时") ? `${Math.max(15, Math.round(amount * 60))} 分钟` : `${Math.max(10, Math.round(amount))} 分钟`;
}

function summarizeExtraction(draft, message) {
  const facts = [draft.topic && `主题“${draft.topic}”`, draft.major && `${draft.major}背景`, draft.level && `${draft.level}基础`, draft.duration && `${draft.duration}周期`].filter(Boolean);
  return facts.length
    ? `收到。我已经从这段描述中更新了${facts.slice(-3).join("、")}。`
    : `收到“${message.slice(0, 36)}${message.length > 36 ? "…" : ""}”，我会把它作为画像证据。`;
}

function suggestionsFor(field) {
  return {
    topic: ["机器学习基础", "数据结构与算法", "操作系统"],
    major: ["计算机科学大二", "人工智能专业", "跨专业自学"],
    goal: ["完成一个可运行项目", "通过期末考试", "建立完整知识体系"],
    level: ["零基础", "了解一点，缺少体系", "有基础，想继续进阶"],
    duration: ["2 周", "1 个月", "3 个月"],
    dailyMinutes: ["每天 25 分钟", "每天 45 分钟", "每天 1 小时"],
    style: ["喜欢案例和图解", "偏好项目实战", "希望多做练习"],
    weaknesses: ["概念理解不牢", "不会把方法用于新问题", "代码实践和调试较弱"]
  }[field] || ["补充我的学习经历", "确认画像并生成课程"];
}

function profileSummary(draft, dimensions) {
  const weak = [...dimensions].sort((left, right) => left.score - right.score).slice(0, 2).map((item) => item.dimension);
  if (!draft.topic) return `画像正在构建，当前低置信薄弱维度为${weak.join("、")}。`;
  return `${draft.major ? `${draft.major}学习者` : "当前学习者"}计划在${draft.duration || "待确认周期"}内学习${draft.topic}，建议优先校准${weak.join("、")}。`;
}

function clampScore(value) {
  return Math.max(15, Math.min(92, Math.round(value)));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
