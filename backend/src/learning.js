import { agents } from "./agents.js";

import { JUDGE_AUTO_BOOTSTRAP, MODEL_CONFIG } from "./config.js";

import { clean, clamp, ensureArray, normalizeCodeLanguage } from "./utils.js";

import { requestChatCompletion, parseJsonFromModel } from "./llm.js";

import { bootstrapJudgeRuntime, friendlyJudgeError, getJudgeRuntimeStatus } from "./judge.js";

import {
  buildAdaptiveState,
  buildDiagnosticPretest,
  buildGovernanceReport,
  buildKnowledgeGraph,
  buildRemediationPlan,
  buildPersonalLearningInsights
} from "./adaptive-learning.js";

export function normalizeInput(body) {
  return {
    topic: clean(body.topic) || "机器学习基础",
    goal: clean(body.goal) || "理解核心概念，并完成一个入门预测项目",
    level: clean(body.level) || "入门",
    duration: clean(body.duration) || "2 周",
    dailyMinutes: clean(body.dailyMinutes) || "45 分钟",
    style: clean(body.style) || "案例驱动",
    weaknesses: clean(body.weaknesses) || "数学基础一般，对模型训练流程和评估指标不熟悉",
    outputType: clean(body.outputType) || "完整学习方案"
  };
}

export function durationToDays(duration) {
  const value = clean(duration);
  const amount = Number.parseInt(value.match(/\d+/)?.[0] || "", 10);
  if (!Number.isFinite(amount) || amount <= 0) return 14;
  if (value.includes("天")) return amount;
  if (value.includes("周")) return amount * 7;
  if (value.includes("个月") || value.includes("月")) return amount * 30;
  return amount;
}

export async function generateLearningPlan(input) {
  const localPlan = runLocalAgents(input);

  if (!MODEL_CONFIG.apiKey) {
    return { mode: "local", input, agents, ...localPlan };
  }

  try {
    const llmPlan = await callLargeModelForPlan(input, localPlan);
    return {
      mode: "llm-core",
      input,
      agents,
      ...mergeLearningPlan(localPlan, llmPlan),
      llmGenerated: true
    };
  } catch (error) {
    return {
      mode: "local-fallback",
      input,
      agents,
      warning: "大模型结构化生成失败，已返回本地可用学习方案。",
      detail: error instanceof Error ? error.message : String(error),
      ...localPlan
    };
  }
}

export async function streamLearningPlan(res, input) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const emit = (event) => {
    res.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  };

  try {
    emit({ type: "session-start", message: "多智能体协作生成已启动" });
    const localPlan = await runLocalAgentsWithEvents(input, emit);

    if (!MODEL_CONFIG.apiKey) {
      emit({ type: "final", result: { mode: "local", input, agents, ...localPlan } });
      res.end();
      return;
    }

    emit({
      type: "agent-start",
      agentId: "llm-agent",
      agent: "大模型优化智能体",
      action: "把本地多智能体草案交给大模型进行结构化优化",
      input: "本地草案、画像、每日任务、测评规则"
    });
    const llmStart = Date.now();

    try {
      const llmPlan = await callLargeModelForPlan(input, localPlan);
      const merged = mergeLearningPlan(localPlan, llmPlan);
      emit({
        type: "agent-done",
        agentId: "llm-agent",
        output: "大模型优化完成，已合并结构化字段",
        durationMs: Date.now() - llmStart
      });
      emit({ type: "final", result: { mode: "llm-core", input, agents, ...merged, llmGenerated: true } });
    } catch (error) {
      emit({
        type: "agent-error",
        agentId: "llm-agent",
        output: "大模型优化失败，使用本地多智能体结果",
        durationMs: Date.now() - llmStart,
        detail: error instanceof Error ? error.message : String(error)
      });
      emit({
        type: "final",
        result: {
          mode: "local-fallback",
          input,
          agents,
          warning: "大模型结构化生成失败，已返回本地可用学习方案。",
          detail: error instanceof Error ? error.message : String(error),
          ...localPlan
        }
      });
    }
  } catch (error) {
    emit({ type: "fatal", message: error instanceof Error ? error.message : String(error) });
  } finally {
    res.end();
  }
}

export function runLocalAgents(input) {
  const learnerProfile = buildLearnerProfile(input);
  const knowledgeGraph = buildKnowledgeGraph(input, learnerProfile);
  const diagnosticPretest = buildDiagnosticPretest(input, learnerProfile, knowledgeGraph);
  const adaptiveState = buildAdaptiveState({ learnerProfile, knowledgeGraph });
  const path = buildLearningPath(input);
  const dailyPlan = buildDailyPlan(input, learnerProfile, knowledgeGraph);
  const assessment = buildAssessment(input, learnerProfile, dailyPlan);
  const resources = buildResources(input, learnerProfile, assessment, knowledgeGraph);
  const generationLoop = buildGenerationLoop(input, learnerProfile, path, resources, assessment);
  const remediationPlan = buildRemediationPlan(input, knowledgeGraph, learnerProfile);
  const governanceReport = buildGovernanceReport({
    input,
    learnerProfile,
    path,
    resources,
    assessment,
    dailyPlan,
    knowledgeGraph
  });
  const personalInsights = buildPersonalLearningInsights({
    input,
    learnerProfile,
    dailyPlan,
    assessment,
    knowledgeGraph,
    governanceReport,
    adaptiveState
  });
  const resourcePackage = buildResourcePackage(input, learnerProfile, path, resources, assessment, generationLoop);
  const tutorCards = buildTutorCards(input, learnerProfile);
  const profile = {
    summary: learnerProfile.summary,
    tags: learnerProfile.tags,
    priority: learnerProfile.strategyPriorities
  };

  return {
    profile,
    learnerProfile,
    knowledgeGraph,
    diagnosticPretest,
    adaptiveState,
    path,
    resources,
    assessment,
    generationLoop,
    remediationPlan,
    governanceReport,
    personalInsights,
    resourcePackage,
    dailyPlan,
    tutorCards
  };
}

async function runLocalAgentsWithEvents(input, emit) {
  const trace = [];
  const runStage = async (stage, work) => {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    emit({ type: "agent-start", startedAt, ...stage });
    const output = await work();
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - start;
    const traceItem = { ...stage, startedAt, completedAt, durationMs, output: stage.outputOf(output) };
    trace.push(traceItem);
    emit({
      type: "agent-done",
      agentId: stage.agentId,
      completedAt,
      durationMs,
      output: traceItem.output
    });
    return output;
  };

  const learnerProfile = await runStage({
    agentId: "profile-agent",
    agent: "学习画像智能体",
    action: "读取用户输入并形成可更新画像",
    input: "学习主题、目标、基础、周期、偏好、薄弱点",
    outputOf: (profile) => `识别薄弱维度：${profile.weakestDimensions.map((item) => item.dimension).join("、")}`
  }, () => buildLearnerProfile(input));

  const knowledgeGraph = await runStage({
    agentId: "knowledge-graph-agent",
    agent: "知识图谱智能体",
    action: "把学习主题拆成可诊断、可推荐、可复测的知识节点",
    input: "学习画像、薄弱维度、学习主题",
    outputOf: (graph) => `生成 ${graph.concepts.length} 个知识节点和 ${graph.edges.length} 条先修关系`
  }, () => buildKnowledgeGraph(input, learnerProfile));

  const diagnosticPretest = await runStage({
    agentId: "diagnostic-pretest-agent",
    agent: "诊断前测智能体",
    action: "围绕薄弱知识点生成首轮诊断题",
    input: "知识图谱、学习画像、薄弱维度",
    outputOf: (diagnostic) => `生成 ${diagnostic.items.length} 道诊断前测题`
  }, () => buildDiagnosticPretest(input, learnerProfile, knowledgeGraph));

  const adaptiveState = buildAdaptiveState({ learnerProfile, knowledgeGraph });

  const path = await runStage({
    agentId: "planner-agent",
    agent: "路径规划智能体",
    action: "根据画像拆解阶段路径",
    input: "学习画像、学习周期、每日时间",
    outputOf: (items) => `生成 ${items.length} 个阶段路径`
  }, () => buildLearningPath(input));

  const dailyPlan = await runStage({
    agentId: "daily-agent",
    agent: "每日任务智能体",
    action: "把阶段路径拆成每日可打卡任务",
    input: "阶段路径、薄弱维度、每日时间",
    outputOf: (items) => `生成 ${items.length} 天每日任务`
  }, () => buildDailyPlan(input, learnerProfile, knowledgeGraph));

  const assessment = await runStage({
    agentId: "assessment-agent",
    agent: "测评评分智能体",
    action: "根据每日任务生成初始测评规则",
    input: "每日任务、薄弱维度、学习目标",
    outputOf: (item) => `生成 ${item.quiz.length} 道初始测评题`
  }, () => buildAssessment(input, learnerProfile, dailyPlan));

  const resources = await runStage({
    agentId: "resource-agent",
    agent: "资源生成智能体",
    action: "生成讲义、例题、练习和复盘模板",
    input: "路径、任务、测评规则",
    outputOf: (items) => `生成 ${items.length} 类学习资源`
  }, () => buildResources(input, learnerProfile, assessment, knowledgeGraph));

  const generationLoop = await runStage({
    agentId: "quality-agent",
    agent: "协作质检智能体",
    action: "检查各智能体产物之间的数据依赖和质量闭环",
    input: "画像、路径、资源、测评题",
    outputOf: (loop) => `质量分 ${loop.qualityScore}，数据流 ${loop.flows.length} 条`
  }, () => buildGenerationLoop(input, learnerProfile, path, resources, assessment));

  const remediationPlan = buildRemediationPlan(input, knowledgeGraph, learnerProfile);

  const governanceReport = await runStage({
    agentId: "governance-agent",
    agent: "内容治理智能体",
    action: "检查资源包的知识点绑定、证据来源、答案泄露和测评闭环",
    input: "知识图谱、资源、测评题、每日任务",
    outputOf: (report) => `质量分 ${report.score}，风险等级 ${report.riskLevel}`
  }, () => buildGovernanceReport({
    input,
    learnerProfile,
    path,
    resources,
    assessment,
    dailyPlan,
    knowledgeGraph
  }));

  const personalInsights = buildPersonalLearningInsights({
    input,
    learnerProfile,
    dailyPlan,
    assessment,
    knowledgeGraph,
    governanceReport,
    adaptiveState
  });

  const resourcePackage = await runStage({
    agentId: "package-agent",
    agent: "方案装配智能体",
    action: "把多智能体产物装配成可保存方案",
    input: "全部阶段产物",
    outputOf: (item) => item.title
  }, () => buildResourcePackage(input, learnerProfile, path, resources, assessment, generationLoop));

  const tutorCards = buildTutorCards(input, learnerProfile);
  const profile = {
    summary: learnerProfile.summary,
    tags: learnerProfile.tags,
    priority: learnerProfile.strategyPriorities
  };

  return {
    profile,
    learnerProfile,
    knowledgeGraph,
    diagnosticPretest,
    adaptiveState,
    path,
    resources,
    assessment,
    generationLoop: {
      ...generationLoop,
      trace
    },
    remediationPlan,
    governanceReport,
    personalInsights,
    resourcePackage,
    dailyPlan,
    tutorCards
  };
}

function buildLearnerProfile(input) {
  const levelBase = {
    "零基础": 32,
    "入门": 46,
    "进阶": 62,
    "冲刺竞赛": 74
  }[input.level] ?? 48;

  const weakText = input.weaknesses;
  const dimensions = [
    { key: "math", dimension: "先修基础", words: ["数学", "公式", "推导", "概率", "线代"] },
    { key: "concept", dimension: "概念理解", words: ["概念", "理解", "原理", "流程", "指标"] },
    { key: "transfer", dimension: "方法迁移", words: ["应用", "迁移", "场景", "不会用"] },
    { key: "practice", dimension: "实践应用", words: ["练习", "实战", "项目", "动手", "代码"] },
    { key: "review", dimension: "表达复盘", words: ["表达", "总结", "报告", "复盘"] },
    { key: "selfDrive", dimension: "学习自驱", words: ["拖延", "坚持", "计划", "打卡"] }
  ];

  const mastery = dimensions.map((item, index) => {
    const penalty = item.words.some((word) => weakText.includes(word)) ? 18 : index * 3;
    return {
      key: item.key,
      dimension: item.dimension,
      score: clamp(levelBase + 8 - penalty),
      evidence: "初始分来自用户填写的当前水平和薄弱点，后续会由打卡和测评成绩自动更新。",
      source: "estimated"
    };
  });
  const weakest = [...mastery].sort((a, b) => a.score - b.score).slice(0, 2);

  return {
    version: new Date().toISOString(),
    summary: `当前画像仅作为初始预估：系统会优先补强“${weakest.map((item) => item.dimension).join("、")}”，并在用户完成每日打卡、练习测评后重新计算掌握度。`,
    mastery,
    weakestDimensions: weakest,
    tags: [input.level, input.style, weakest[0].dimension, "进度驱动画像", "可测评更新"],
    behaviorSignals: [
      `学习周期：${input.duration}`,
      `每日时间：${input.dailyMinutes}`,
      `资源偏好：${input.outputType}`,
      `薄弱点线索：${input.weaknesses}`
    ],
    strategyPriorities: [
      `优先补强“${weakest[0].dimension}”，先用低门槛练习确认是否真的掌握。`,
      "每天用“任务完成 + 选择题测评 + 错因记录”更新画像，避免雷达图停留在主观估计。",
      "如果测评低于 60 分，下一轮练习自动回到对应知识点的讲义和基础题。"
    ]
  };
}

function buildLearningPath(input) {
  return [
    {
      stage: "阶段一：诊断与概念建模",
      task: `梳理 ${input.topic} 的核心概念、先修知识和常见误区。`,
      outcome: "形成一页知识地图，明确个人薄弱点。"
    },
    {
      stage: "阶段二：案例理解与跟练",
      task: `围绕“${input.style}”学习 2 个典型案例，并写出步骤解释。`,
      outcome: "能解释关键流程，并独立复现一个基础例子。"
    },
    {
      stage: "阶段三：分层练习与错因复盘",
      task: `完成围绕“${input.topic}”的基础题、应用题和挑战题。`,
      outcome: "输出错题原因、修正方法和下一轮练习重点。"
    },
    {
      stage: "阶段四：项目迁移与反馈更新",
      task: `完成一个与“${input.goal}”相关的小项目或综合任务。`,
      outcome: "获得作品、测评结果和下一轮个性化学习建议。"
    }
  ];
}

function buildResources(input, learnerProfile, assessment, knowledgeGraph) {
  const focus = learnerProfile.weakestDimensions[0].dimension;
  const concepts = ensureArray(knowledgeGraph?.concepts, []);
  const focusedConcepts = concepts
    .filter((concept) => concept.dimension === focus)
    .concat(concepts)
    .filter((concept, index, array) => array.findIndex((item) => item.id === concept.id) === index)
    .slice(0, 6);
  const grounded = focusedConcepts.map((concept, index) => ({
    type: index % 2 === 0 ? "知识点微讲义" : "变式练习",
    conceptId: concept.id,
    sourceConcepts: [concept.id, ...(concept.prerequisites || [])],
    title: `${concept.title} ${index % 2 === 0 ? "微讲义" : "变式练习"}`,
    objective: concept.standard || `掌握 ${concept.title}`,
    difficulty: concept.difficulty,
    misconceptions: concept.misconceptions || [],
    content: index % 2 === 0
      ? `围绕“${concept.title}”完成定义、适用条件、反例和一个 ${input.topic} 场景解释，重点修正：${(concept.misconceptions || []).slice(0, 2).join("、") || "常见误区"}。`
      : `完成 2 道与“${concept.title}”相关的变式题，要求写出判断依据、错因标签和复测结果。`
  }));
  return [
    {
      type: "微讲义",
      conceptId: focusedConcepts[0]?.id,
      sourceConcepts: focusedConcepts.slice(0, 3).map((concept) => concept.id),
      title: `${input.topic} 核心概念速览`,
      objective: "建立主题总览，并连接后续细粒度知识点。",
      content: `按“概念定义-现实类比-关键步骤-易错点”的结构学习 ${input.topic}，每个概念都写出自己的例子。`
    },
    {
      type: "例题讲解",
      conceptId: focusedConcepts[1]?.id,
      sourceConcepts: focusedConcepts.slice(0, 4).map((concept) => concept.id),
      title: `${input.topic} 场景化案例`,
      objective: "把概念迁移到真实问题结构。",
      content: `选择一个熟悉场景，说明 ${input.topic} 如何解决问题，并标出输入、处理、输出和评估方式。`
    },
    {
      type: "进度匹配练习",
      conceptId: focusedConcepts[2]?.id,
      sourceConcepts: focusedConcepts.map((concept) => concept.id),
      title: `${focus} 专项选择题组`,
      objective: "用题目证据更新掌握度。",
      content: `练习会优先覆盖已打卡任务和薄弱维度，当前默认生成 ${assessment.quiz.length} 道选择题。`
    },
    {
      type: "复盘模板",
      conceptId: focusedConcepts[3]?.id,
      sourceConcepts: focusedConcepts.map((concept) => concept.id),
      title: "错因记录表",
      objective: "沉淀错因、提示使用和复测结果。",
      content: "记录错题、卡点、正确思路、下次提醒和需要补学的知识点，用于下一次画像更新。"
    },
    ...grounded
  ];
}

function buildAssessment(input, learnerProfile, dailyPlan) {
  return {
    quiz: buildProgressQuiz(input, { learnerProfile, dailyPlan }, {}, 0),
    rubric: ["选择题按标准答案即时评分", "简答题按关键词覆盖、逻辑完整度和表达清晰度评分", "代码题可通过 Docker 沙箱运行测试用例"],
    nextActions: [
      "低于 60 分：回到概念讲义和基础题。",
      "60-85 分：继续强化练习和错题复盘。",
      "高于 85 分：进入项目化学习或更高难度任务。"
    ]
  };
}

export async function generateAdaptiveQuiz(input, plan, progress = {}, variant = 0, history = [], options = {}) {
  const summary = summarizeProgress(plan, progress);
  const distributionSeed = `${input.topic || "topic"}-${variant}-${summary.done}-${history.length}`;
  const quizOptions = normalizeQuizOptions({
    ...options,
    includeCode: options.includeCode ?? shouldIncludeProgrammingQuestion(input, plan, progress, history),
    codeLanguage: options.codeLanguage || inferProgrammingLanguage(input, plan, history)
  });
  if (quizOptions.includeCode && JUDGE_AUTO_BOOTSTRAP) {
    bootstrapJudgeRuntime().catch((error) => {
      console.warn(`判题沙箱准备失败：${friendlyJudgeError(error)}`);
    });
  }
  const localQuiz = buildProgressQuiz(input, plan, progress, variant, history, quizOptions);

  if (!MODEL_CONFIG.apiKey) {
    return { quiz: distributeQuizChoiceAnswers(localQuiz, distributionSeed), mode: "local-bank", llmUsed: false, includeCode: quizOptions.includeCode, quizOptions, judge: getJudgeRuntimeStatus() };
  }

  try {
    const llmQuiz = await callLargeModelForQuiz(input, plan, progress, summary, variant, history, quizOptions);
    return { quiz: distributeQuizChoiceAnswers(normalizeGeneratedQuiz(llmQuiz, localQuiz, summary, variant, quizOptions), distributionSeed), mode: "llm-quiz", llmUsed: true, includeCode: quizOptions.includeCode, quizOptions, judge: getJudgeRuntimeStatus() };
  } catch (error) {
    return {
      quiz: distributeQuizChoiceAnswers(localQuiz, distributionSeed),
      mode: "local-bank-fallback",
      llmUsed: false,
      includeCode: quizOptions.includeCode,
      quizOptions,
      judge: getJudgeRuntimeStatus(),
      warning: "大模型出题失败，已使用本地专业题库。",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function normalizeQuizOptions(options = {}) {
  const rawTypeCounts = options.typeCounts || {};
  const parsedCounts = {
    choice: boundedInteger(rawTypeCounts.choice ?? options.choiceCount, 0, 20, 0),
    short: boundedInteger(rawTypeCounts.short ?? options.shortCount, 0, 20, 0),
    code: boundedInteger(rawTypeCounts.code ?? options.codeCount, 0, 20, 0)
  };
  const hasExplicitCounts = Object.values(parsedCounts).some((count) => count > 0);
  const requestedCount = boundedInteger(
    options.questionCount ?? options.count,
    1,
    20,
    hasExplicitCounts ? parsedCounts.choice + parsedCounts.short + parsedCounts.code : 4
  );
  const explicitTypes = new Set(ensureArray(options.types, []).filter((type) => ["choice", "short", "code"].includes(type)));
  let includeCode = Boolean(options.includeCode) || parsedCounts.code > 0 || explicitTypes.has("code");
  const typeCounts = hasExplicitCounts
    ? parsedCounts
    : includeCode
      ? { choice: Math.max(1, requestedCount - 2), short: 1, code: 1 }
      : { choice: Math.max(1, requestedCount - 1), short: Math.min(1, requestedCount - 1), code: 0 };

  if (explicitTypes.size) {
    for (const type of ["choice", "short", "code"]) {
      if (!explicitTypes.has(type)) typeCounts[type] = 0;
    }
    if (!explicitTypes.has("code")) includeCode = false;
  }
  if (options.includeCode === false) {
    typeCounts.code = 0;
    includeCode = false;
  }
  if (!includeCode) typeCounts.code = 0;

  balanceTypeCounts(typeCounts, requestedCount, includeCode);
  return {
    questionCount: typeCounts.choice + typeCounts.short + typeCounts.code,
    typeCounts,
    types: Object.entries(typeCounts).filter(([, count]) => count > 0).map(([type]) => type),
    includeCode: typeCounts.code > 0,
    codeLanguage: normalizeCodeLanguage(options.codeLanguage || "python"),
    difficulty: ["easy", "medium", "hard", "adaptive"].includes(options.difficulty) ? options.difficulty : "adaptive",
    knowledgeScope: ["current", "weak", "all"].includes(options.knowledgeScope) ? options.knowledgeScope : "current",
    showHints: options.showHints !== false,
    showAnswerMode: options.showAnswerMode || "after-submit",
    includeSimilar: Boolean(options.includeSimilar),
    includeRetest: Boolean(options.includeRetest),
    focusDimension: clean(options.focusDimension, 80),
    timeLimitSec: boundedInteger(options.timeLimitSec, 0, 10800, 0)
  };
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(min, Math.min(max, Math.round(fallback)));
  return Math.max(min, Math.min(max, Math.round(number)));
}

function balanceTypeCounts(typeCounts, requestedCount, includeCode) {
  const fillOrder = includeCode ? ["choice", "short", "code"] : ["choice", "short"];
  if (!fillOrder.some((type) => typeCounts[type] > 0)) typeCounts.choice = requestedCount;
  while (typeCounts.choice + typeCounts.short + typeCounts.code < requestedCount) {
    const type = fillOrder[(typeCounts.choice + typeCounts.short + typeCounts.code) % fillOrder.length];
    typeCounts[type] += 1;
  }
  while (typeCounts.choice + typeCounts.short + typeCounts.code > requestedCount) {
    const type = [...fillOrder].reverse().find((item) => typeCounts[item] > 0) || "choice";
    typeCounts[type] -= 1;
  }
}

function describeQuizStructure(options) {
  return [
    options.typeCounts.choice ? `${options.typeCounts.choice} 道 choice 选择题` : "",
    options.typeCounts.short ? `${options.typeCounts.short} 道 short 简答题` : "",
    options.typeCounts.code ? `${options.typeCounts.code} 道 code 编程题` : ""
  ].filter(Boolean).join("、");
}

function shouldIncludeProgrammingQuestion(input, plan, progress, history) {
  const text = [
    input.topic,
    input.goal,
    input.outputType,
    input.style,
    input.weaknesses,
    ...(plan?.dailyPlan || []).flatMap((day) => [day.title, day.focus, ...(day.tasks || [])]),
    ...ensureArray(history, []).map((item) => `${item.type || ""} ${item.dimension || ""} ${item.question || ""}`)
  ].join(" ");
  return /编程|代码|程序|算法|数据结构|python|javascript|java|c\+\+|机器学习|深度学习|模型|训练|预测|数据处理|特征|评估指标/i.test(text);
}

function inferProgrammingLanguage(input, plan, history) {
  const text = [
    input.topic,
    input.goal,
    input.outputType,
    input.style,
    input.weaknesses,
    ...(plan?.dailyPlan || []).flatMap((day) => [day.title, day.focus, ...(day.tasks || [])]),
    ...ensureArray(history, []).map((item) => `${item.language || ""} ${item.question || ""}`)
  ].join(" ").toLowerCase();
  if (/c\+\+|cpp|信息学|竞赛|acm|蓝桥杯/.test(text)) return "cpp";
  if (/javascript|js|node|前端|网页|web/.test(text)) return "javascript";
  if (/\bjava\b|spring|后端/.test(text)) return "java";
  if (/python|机器学习|深度学习|数据|模型|训练|预测|特征|pandas|sklearn/.test(text)) return "python";
  return "python";
}

async function callLargeModelForQuiz(input, plan, progress, summary, variant, history, options) {
  const quizConfig = normalizeQuizOptions(options);
  const completedDays = (plan?.dailyPlan || []).map((day) => ({
    day: day.day,
    title: day.title,
    focus: day.focus,
    doneTasks: (day.tasks || []).filter((_, index) => progress[`day-${day.day}-task-${index}`])
  })).filter((day) => day.doneTasks.length);
  const recentHistory = history.slice(-10).map((item) => ({
    questionId: item.questionId,
    type: item.type,
    dimension: item.dimension,
    question: String(item.question || "").slice(0, 160),
    correct: item.correct,
    score: item.score,
    maxScore: item.maxScore
  }));
  const prompt = `你是专业课程的自适应测评出题智能体。请根据学习进度、已完成任务和错题历史生成新的练习题。
只返回 JSON 数组，不要 Markdown。每个元素必须符合：
{
 "type":"choice|short|code",
 "dimension":"",
 "question":"",
 "options":["仅选择题需要，4项"],
 "answerIndex":0,
 "referenceAnswer":"简答题标准答案",
 "keywords":["简答题评分关键词"],
 "language":"python|cpp|java|javascript",
 "starterCode":"代码题起始代码",
 "tests":[{"function":"","args":[],"expected":null}],
 "explanation":"",
 "score":20或30
}

硬性要求：
1. 生成 ${quizConfig.questionCount} 道题，必须和当前主题 ${input.topic} 的专业知识强相关，不要泛泛学习方法题。
2. 必须利用 completedDays 和 recentHistory，避免重复 recentHistory 中的题干。
3. 题型结构必须严格为：${describeQuizStructure(quizConfig)}${quizConfig.includeCode ? `；编程题语言必须是 ${quizConfig.codeLanguage}，tests 要可由服务端判题沙箱运行。` : "。"}
4. 选择题要有明确干扰项；简答题要给 referenceAnswer 和 keywords；代码题只考一个函数。
5. 编程题测试格式统一为 {"function":"函数名","args":[参数1,参数2],"expected":期望返回值}；不要使用标准输入输出题。
6. 题干中自然体现当前进度或错题薄弱点，但不要机械复制上下文。

上下文：
${JSON.stringify({
  input,
  progressSummary: summary,
  completedDays,
  weakDimensions: plan?.learnerProfile?.weakestDimensions || [],
  recentHistory,
  variant,
  includeProgrammingQuestion: quizConfig.includeCode,
  requiredCodeLanguage: quizConfig.codeLanguage,
  quizConfig
})}`;

  const content = await requestChatCompletion([
    { role: "system", content: "你是严谨的中文自适应测评出题智能体，必须输出可解析 JSON 数组。" },
    { role: "user", content: prompt }
  ], { temperature: 0.75, maxTokens: 2200 });
  const parsed = parseJsonArrayFromModel(content);
  return parsed;
}

function parseJsonArrayFromModel(content) {
  const trimmed = String(content || "").trim();
  const jsonText = trimmed.startsWith("[")
    ? trimmed
    : trimmed.match(/```json\s*([\s\S]*?)```/)?.[1] || trimmed.match(/\[[\s\S]*\]/)?.[0];
  if (!jsonText) throw new Error("大模型没有返回 JSON 数组。");
  return JSON.parse(jsonText);
}

function normalizeGeneratedQuiz(items, fallback, summary, variant, options) {
  if (!Array.isArray(items)) return fallback;
  const normalized = items
    .filter((item) => item && ["choice", "short", "code"].includes(item.type))
    .filter((item) => options.includeCode || item.type !== "code")
    .map((item, index) => normalizeQuizItem(item, summary, variant, index, options));
  const structured = pickQuizByOptions(normalized, options);
  return structured || fallback;
}

function pickQuizByStructure(items, includeCode) {
  const choices = items.filter((item) => item.type === "choice");
  const shorts = items.filter((item) => item.type === "short");
  const codes = items.filter((item) => item.type === "code");
  if (includeCode) {
    if (choices.length < 2 || shorts.length < 1 || codes.length < 1) return null;
    return [choices[0], choices[1], shorts[0], codes[0]];
  }
  if (choices.length < 3 || shorts.length < 1) return null;
  return [choices[0], choices[1], choices[2], shorts[0]];
}

function pickQuizByOptions(items, options = {}) {
  const config = normalizeQuizOptions(options);
  const usableItems = config.includeCode ? items : items.filter((item) => item.type !== "code");
  if (!usableItems.length) return null;
  const selected = [];
  for (const type of ["choice", "short", "code"]) {
    const wanted = config.typeCounts[type] || 0;
    if (!wanted) continue;
    const typed = usableItems.filter((item) => item.type === type);
    if (!typed.length) continue;
    for (let index = 0; index < wanted; index += 1) {
      selected.push({ ...typed[index % typed.length], recycledVariant: Math.floor(index / typed.length) });
    }
  }
  let fillIndex = 0;
  while (selected.length < config.questionCount) {
    const candidate = usableItems[fillIndex % usableItems.length];
    selected.push({ ...candidate, recycledVariant: Math.floor(fillIndex / usableItems.length) + 1 });
    fillIndex += 1;
  }
  return selected.slice(0, config.questionCount);
}

function normalizeQuizItem(item, summary, variant, index, options = {}) {
  const baseId = slugify(`${item.type}-${item.dimension || "general"}-${item.question || index}`).slice(0, 64);
  const normalized = {
    id: `${baseId}-${summary.currentDay || 1}-${summary.done}-${variant || 0}-${index}`,
    type: item.type,
    dimension: clean(item.dimension, 80) || "综合应用",
    question: clean(item.question, 1200),
    explanation: clean(item.explanation, 800),
    score: Number(item.score || (item.type === "choice" ? 20 : 30)),
    relatedDay: summary.currentDay || 1,
    progressContext: {
      done: summary.done,
      total: summary.total
    }
  };

  if (item.type === "choice") {
    normalized.options = ensureArray(item.options, []).slice(0, 4).map((option) => clean(option, 200));
    normalized.answerIndex = Math.max(0, Math.min(3, Number(item.answerIndex || 0)));
    if (normalized.options.length !== 4) throw new Error("选择题选项数量不足");
    return redistributeChoiceAnswer(normalized, (Number(variant || 0) + Number(summary.done || 0) + index) % 4);
  }
  if (item.type === "short") {
    normalized.referenceAnswer = clean(item.referenceAnswer, 800) || clean(item.answer, 800);
    normalized.keywords = ensureArray(item.keywords, []).slice(0, 10).map((keyword) => clean(keyword, 40));
  }
  if (item.type === "code") {
    normalized.language = normalizeCodeLanguage(options.codeLanguage || item.language || "python");
    normalized.tests = ensureArray(item.tests, []).slice(0, 8);
    if (!normalized.tests.length) throw new Error("代码题缺少测试用例");
    const functionName = normalized.tests[0]?.function || "solve";
    const starter = clean(item.starterCode, 2000);
    normalized.starterCode = starterMatchesLanguage(starter, normalized.language)
      ? starter
      : starterForFunction(normalized.language, functionName, normalized.tests);
  }
  return normalized;
}

export function redistributeChoiceAnswer(question, targetIndex) {
  if (question?.type !== "choice" || !Array.isArray(question.options) || question.options.length < 2) return question;
  const options = [...question.options];
  const answerIndex = Math.max(0, Math.min(options.length - 1, Number(question.answerIndex || 0)));
  const target = Math.max(0, Math.min(options.length - 1, Number(targetIndex || 0)));
  [options[answerIndex], options[target]] = [options[target], options[answerIndex]];
  return { ...question, options, answerIndex: target };
}

export function distributeQuizChoiceAnswers(quiz, seed = "quiz") {
  const orders = new Map();
  let choiceIndex = 0;
  return ensureArray(quiz, []).map((question) => {
    if (question?.type !== "choice") return question;
    const cycle = Math.floor(choiceIndex / 4);
    if (!orders.has(cycle)) orders.set(cycle, seededAnswerOrder(`${seed}-${cycle}`));
    const target = orders.get(cycle)[choiceIndex % 4];
    choiceIndex += 1;
    return { ...redistributeChoiceAnswer(question, target), answerDistributionVersion: 2 };
  });
}

function seededAnswerOrder(seed) {
  const order = [0, 1, 2, 3];
  let value = stableHash(seed) || 1;
  for (let index = order.length - 1; index > 0; index -= 1) {
    value = (value * 1664525 + 1013904223) >>> 0;
    const swapIndex = value % (index + 1);
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

function defaultStarterCode(language) {
  if (language === "cpp") return "int solve(int x) {\n    // 在这里编写代码\n    return x;\n}\n";
  if (language === "java") return "public class Solution {\n    public static int solve(int x) {\n        // 在这里编写代码\n        return x;\n    }\n}\n";
  if (language === "javascript") return "function solve(x) {\n  // 在这里编写代码\n  return x;\n}\n\nmodule.exports = { solve };\n";
  return "def solve(x):\n    # 在这里编写代码\n    return x\n";
}

function starterMatchesLanguage(code, language) {
  if (!code) return false;
  if (language === "python") return /def\s+\w+\s*\(/.test(code);
  if (language === "cpp") return /(vector<|#include|int\s+\w+\s*\(|double\s+\w+\s*\()/.test(code) && !/public\s+class/.test(code);
  if (language === "java") return /public\s+class\s+Solution/.test(code);
  if (language === "javascript") return /(module\.exports|function\s+\w+\s*\(|=>)/.test(code);
  return false;
}

function starterForFunction(language, functionName, tests = []) {
  const normalized = normalizeCodeLanguage(language);
  if (functionName === "accuracy") {
    if (normalized === "cpp") return "double accuracy(vector<int> y_true, vector<int> y_pred) {\n    // 在这里编写代码\n    return 0.0;\n}\n";
    if (normalized === "java") return "public class Solution {\n    public static double accuracy(int[] y_true, int[] y_pred) {\n        // 在这里编写代码\n        return 0.0;\n    }\n}\n";
    if (normalized === "javascript") return "function accuracy(y_true, y_pred) {\n  // 在这里编写代码\n  return 0;\n}\n\nmodule.exports = { accuracy };\n";
    return "def accuracy(y_true, y_pred):\n    # 在这里编写代码\n    pass\n";
  }
  if (functionName === "normalize_scores") {
    if (normalized === "cpp") return "vector<double> normalize_scores(vector<double> scores) {\n    // 在这里编写代码\n    return {};\n}\n";
    if (normalized === "java") return "public class Solution {\n    public static double[] normalize_scores(double[] scores) {\n        // 在这里编写代码\n        return new double[]{};\n    }\n}\n";
    if (normalized === "javascript") return "function normalize_scores(scores) {\n  // 在这里编写代码\n  return [];\n}\n\nmodule.exports = { normalize_scores };\n";
    return "def normalize_scores(scores):\n    # 在这里编写代码\n    pass\n";
  }
  return starterFromTests(normalized, functionName, tests);
}

function starterFromTests(language, functionName, tests = []) {
  const first = tests[0] || { args: [0], expected: 0 };
  const args = first.args || [];
  const returnType = codeTypeForValue(language, first.expected);
  const argList = args.map((arg, index) => `${codeTypeForValue(language, arg)} arg${index + 1}`);
  if (language === "cpp") {
    return `${returnType} ${functionName}(${argList.join(", ")}) {\n    // 在这里编写代码\n    return ${defaultReturnForType(language, first.expected)};\n}\n`;
  }
  if (language === "java") {
    return `public class Solution {\n    public static ${returnType} ${functionName}(${argList.join(", ")}) {\n        // 在这里编写代码\n        return ${defaultReturnForType(language, first.expected)};\n    }\n}\n`;
  }
  if (language === "javascript") {
    return `function ${functionName}(${args.map((_, index) => `arg${index + 1}`).join(", ")}) {\n  // 在这里编写代码\n  return ${defaultReturnForType(language, first.expected)};\n}\n\nmodule.exports = { ${functionName} };\n`;
  }
  return `def ${functionName}(${args.map((_, index) => `arg${index + 1}`).join(", ")}):\n    # 在这里编写代码\n    return ${defaultReturnForType(language, first.expected)}\n`;
}

function codeTypeForValue(language, value) {
  if (language === "cpp") {
    if (Array.isArray(value)) return `vector<${codeTypeForValue(language, value[0] ?? 0)}>`;
    if (typeof value === "number" && !Number.isInteger(value)) return "double";
    if (typeof value === "string") return "string";
    if (typeof value === "boolean") return "bool";
    return "int";
  }
  if (language === "java") {
    if (Array.isArray(value)) return `${codeTypeForValue(language, value[0] ?? 0)}[]`;
    if (typeof value === "number" && !Number.isInteger(value)) return "double";
    if (typeof value === "string") return "String";
    if (typeof value === "boolean") return "boolean";
    return "int";
  }
  return "";
}

function defaultReturnForType(language, sample) {
  if (Array.isArray(sample)) {
    if (language === "cpp") return "{}";
    if (language === "java") return `new ${codeTypeForValue(language, sample[0] ?? 0)}[]{}`;
    if (language === "javascript") return "[]";
    return "[]";
  }
  if (typeof sample === "string") return language === "cpp" || language === "java" || language === "javascript" ? '""' : '""';
  if (typeof sample === "boolean") return language === "python" ? "False" : "false";
  return "0";
}

function testsForFunction(language, functionName) {
  const normalized = normalizeCodeLanguage(language);
  if (functionName === "accuracy") {
    const numericTests = [
      { function: "accuracy", args: [[1, 0, 1, 1], [1, 1, 1, 0]], expected: 0.5 },
      { function: "accuracy", args: [[1, 2, 3], [1, 2, 3]], expected: 1 },
      { function: "accuracy", args: [[0, 0, 1], [1, 1, 1]], expected: 0.3333333333333333 }
    ];
    if (normalized === "javascript" || normalized === "python") {
      return [
        numericTests[0],
        { function: "accuracy", args: [["cat", "dog"], ["cat", "dog"]], expected: 1 },
        numericTests[2]
      ];
    }
    return numericTests;
  }
  return [
    { function: "normalize_scores", args: [[2, 4, 6]], expected: [0, 0.5, 1] },
    { function: "normalize_scores", args: [[5, 5]], expected: [0, 0] },
    { function: "normalize_scores", args: [[-1, 1]], expected: [0, 1] }
  ];
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildProgressQuiz(input, plan, progress = {}, variant = 0, history = [], options = {}) {
  const summary = summarizeProgress(plan, progress);
  const focus = summary.focus || plan?.learnerProfile?.weakestDimensions?.[0]?.dimension || "概念理解";
  const missedDimensions = [...new Set(history.filter((item) => item && item.correct === false).map((item) => item.dimension).filter(Boolean))];
  const seedText = JSON.stringify({
    topic: input.topic,
    done: summary.done,
    currentDay: summary.currentDay,
    variant,
    missedDimensions,
    recent: history.slice(-6).map((item) => [item.questionId, item.correct, item.dimension])
  });
  const dayLabel = summary.currentDay ? `第 ${summary.currentDay} 天` : "当前阶段";
  const topic = input.topic || plan?.input?.topic || "当前主题";
  const seedOffset = stableHash(seedText);
  const learnedTask = summary.completedTasks[seedOffset % Math.max(1, summary.completedTasks.length)] || `${topic} 的核心概念`;
  const bank = selectProfessionalQuizBank(topic, focus, dayLabel, learnedTask, options);
  const selected = selectAdaptiveQuizItems(bank, seedOffset, history, missedDimensions, options);
  const answerOffset = (seedOffset + Number(variant || 0)) % 4;
  return selected.map((item, index) => redistributeChoiceAnswer(applyQuizContext(item, {
    index,
    variant,
    summary,
    learnedTask,
    missedDimensions,
    quizOptions: options
  }), (answerOffset + index) % 4));
}

function selectProfessionalQuizBank(topic, focus, dayLabel, learnedTask, options = {}) {
  const codeLanguage = normalizeCodeLanguage(options.codeLanguage || "python");
  if (/机器学习|machine learning|ML/i.test(topic)) {
    return [
      {
        id: "ml-leakage-choice",
        type: "choice",
        dimension: "概念理解",
        question: `${dayLabel}围绕“${learnedTask}”学习后，下面哪种做法最容易造成机器学习评估中的数据泄漏？`,
        options: [
          "先在全量数据上做标准化，再划分训练集和测试集",
          "只用训练集拟合标准化参数，再应用到验证集和测试集",
          "把数据划分为训练集、验证集、测试集",
          "在验证集上比较多个超参数组合"
        ],
        answerIndex: 0,
        explanation: "预处理参数如果从全量数据学习，会让测试集信息提前进入训练流程，导致评估虚高。",
        score: 20
      },
      {
        id: "ml-metric-choice",
        type: "choice",
        dimension: "方法迁移",
        question: "在正负样本极不均衡的二分类任务中，只看 accuracy 可能有什么问题？",
        options: [
          "多数类预测会掩盖少数类识别能力，需要结合 precision、recall、F1 或 PR-AUC",
          "accuracy 一定比 F1 更能反映业务风险",
          "样本不均衡时不需要划分验证集",
          "只要训练轮数足够多，accuracy 就不会误导"
        ],
        answerIndex: 0,
        explanation: "不均衡任务里，高 accuracy 可能来自总是预测多数类，不能说明模型真正识别少数类。",
        score: 20
      },
      {
        id: "ml-gradient-short",
        type: "short",
        dimension: focus,
        question: "简答：用 80 字以内说明梯度下降中“学习率过大”和“学习率过小”分别会造成什么现象。",
        keywords: ["学习率", "过大", "震荡", "发散", "过小", "收敛", "慢"],
        referenceAnswer: "学习率过大可能越过最优点，导致损失震荡甚至发散；过小则每步更新太小，收敛很慢，训练成本升高。",
        explanation: "回答要同时覆盖两种学习率设置对损失曲线和收敛速度的影响。",
        score: 30
      },
      {
        id: "ml-accuracy-code",
        type: "code",
        language: codeLanguage,
        dimension: "实践应用",
        question: "编程题：请实现 accuracy(y_true, y_pred)，返回预测正确的比例。要求 y_true 和 y_pred 为等长列表。",
        starterCode: starterForFunction(codeLanguage, "accuracy"),
        tests: testsForFunction(codeLanguage, "accuracy"),
        explanation: "该题检查你是否能把评估指标转成可运行代码。若本机 Docker 可用，后端会在隔离容器中运行测试。",
        score: 30
      },
      {
        id: "ml-normalize-code",
        type: "code",
        language: codeLanguage,
        dimension: "实践应用",
        question: "编程题：实现 normalize_scores(scores)，把数值列表线性映射到 0-1；若最大值等于最小值，返回全 0。",
        starterCode: starterForFunction(codeLanguage, "normalize_scores"),
        tests: testsForFunction(codeLanguage, "normalize_scores"),
        explanation: "该题对应特征缩放/归一化的基础实现，能检查你是否理解预处理逻辑。",
        score: 30
      },
      {
        id: "ml-bias-variance-short",
        type: "short",
        dimension: "概念理解",
        question: "简答：模型在训练集表现很好、验证集表现差，通常说明什么问题？你会优先尝试哪两种改进？",
        keywords: ["过拟合", "正则化", "数据增强", "简化模型", "交叉验证", "更多数据"],
        referenceAnswer: "通常说明过拟合。可尝试正则化、简化模型、增加数据或数据增强，并用验证集/交叉验证确认改进。",
        explanation: "重点是判断泛化问题，并给出合理的模型或数据层面修正。",
        score: 30
      },
      {
        id: "ml-train-val-short",
        type: "short",
        dimension: "方法迁移",
        question: "简答：为什么不能直接用测试集反复调参？请说明验证集和测试集的职责区别。",
        keywords: ["验证集", "测试集", "调参", "泛化", "泄漏", "最终评估"],
        referenceAnswer: "验证集用于模型选择和调参；测试集应尽量只在最终评估时使用。反复用测试集调参会让模型间接适配测试集，导致泛化评估偏乐观。",
        explanation: "该题检查训练/验证/测试划分的专业理解。",
        score: 30
      },
      {
        id: "ml-regularization-choice",
        type: "choice",
        dimension: "概念理解",
        question: "当线性模型出现过拟合时，L2 正则化通常起什么作用？",
        options: [
          "惩罚过大的权重，降低模型复杂度，从而改善泛化",
          "让训练误差必然变成 0",
          "删除所有无关特征且不需要验证",
          "只改变测试集分布"
        ],
        answerIndex: 0,
        explanation: "L2 正则化通过惩罚权重大小抑制过拟合，但不保证训练误差为 0。",
        score: 20
      }
    ];
  }

  return [
    {
      id: "general-concept-choice",
      type: "choice",
      dimension: "概念理解",
      question: `${dayLabel}学习“${learnedTask}”后，哪种表现最能证明你掌握了专业概念？`,
      options: [
        "能给出定义、适用条件、反例和一个可验证例子",
        "只背出一段定义",
        "只收藏了资料链接",
        "只看完视频但没有输出"
      ],
      answerIndex: 0,
      explanation: "专业掌握需要定义、边界、反例和可验证应用，而不只是记忆。",
      score: 20
    },
    {
      id: "general-transfer-choice",
      type: "choice",
      dimension: "方法迁移",
      question: `把 ${topic} 用到新问题时，最关键的第一步是什么？`,
      options: [
        "识别新问题的输入、输出、约束和评价标准",
        "直接复制旧例题答案",
        "跳过需求分析",
        "只追求更复杂的工具"
      ],
      answerIndex: 0,
      explanation: "专业迁移首先要确认问题结构，而不是套模板。",
      score: 20
    },
    {
      id: "general-short",
      type: "short",
      dimension: focus,
      question: `简答：结合今天已完成任务，说明 ${topic} 中一个关键概念的适用条件和一个常见误区。`,
      keywords: ["适用", "条件", "误区", "例子"],
      referenceAnswer: "答案应说明概念在什么条件下成立，给出一个具体例子，并指出容易误用或混淆的地方。",
      explanation: "该题用于检查你是否能说出概念边界。",
      score: 30
    },
    {
      id: "general-code",
      type: "code",
      language: codeLanguage,
      dimension: "实践应用",
      question: "编程题：实现 normalize_scores(scores)，把列表映射到 0-1 区间；若最大值等于最小值，返回全 0。",
      starterCode: starterForFunction(codeLanguage, "normalize_scores"),
      tests: testsForFunction(codeLanguage, "normalize_scores"),
      explanation: "该题检查你能否把专业数据处理步骤写成可测试函数。",
      score: 30
    }
  ];
}

function selectAdaptiveQuizItems(items, offset, history, missedDimensions, options = {}) {
  const quizConfig = normalizeQuizOptions(options);
  const usableItems = quizConfig.includeCode ? items : items.filter((item) => item.type !== "code");
  if (!usableItems.length) return [];
  const previousBaseIds = new Set(
    history
      .map((item) => String(item.questionId || "").split("-").slice(0, -4).join("-"))
      .filter(Boolean)
  );
  const focusDimensions = [quizConfig.focusDimension, ...missedDimensions].filter(Boolean);
  const prioritized = focusDimensions.length
    ? usableItems.filter((item) => focusDimensions.includes(item.dimension)).concat(usableItems.filter((item) => !focusDimensions.includes(item.dimension)))
    : usableItems;
  const difficultyFiltered = filterByRequestedDifficulty(prioritized, quizConfig.difficulty);
  const scoped = quizConfig.knowledgeScope === "weak" && focusDimensions.length
    ? difficultyFiltered.filter((item) => focusDimensions.includes(item.dimension)).concat(difficultyFiltered.filter((item) => !focusDimensions.includes(item.dimension)))
    : difficultyFiltered;
  const poolSource = scoped.length ? scoped : usableItems;
  const rotated = poolSource.slice(offset % poolSource.length).concat(poolSource.slice(0, offset % poolSource.length));
  const fresh = rotated.filter((item) => !previousBaseIds.has(item.id));
  const pool = fresh.length >= quizConfig.questionCount ? fresh : rotated;
  const selected = pickQuizByOptions(pool, quizConfig);
  if (selected) return selected;
  return pool.slice(0, quizConfig.questionCount);
}

function filterByRequestedDifficulty(items, difficulty) {
  if (!items.length || difficulty === "adaptive") return items;
  const range = {
    easy: [1, 2],
    medium: [2, 3],
    hard: [3, 5]
  }[difficulty] || [1, 5];
  const filtered = items.filter((item) => {
    const level = Number(item.difficulty || (item.type === "code" ? 4 : item.type === "short" ? 3 : 2));
    return level >= range[0] && level <= range[1];
  });
  return filtered.length ? filtered : items;
}

function applyQuizContext(item, context) {
  const quizOptions = normalizeQuizOptions(context.quizOptions || {});
  const estimatedTimeSec = item.estimatedTimeSec || (item.type === "code" ? 900 : item.type === "short" ? 240 : 90);
  const missedText = context.missedDimensions.length
    ? `上一轮薄弱维度：${context.missedDimensions.join("、")}。`
    : "上一轮暂无明显错题维度。";
  const progressPrefix = `【进度：已完成 ${context.summary.done}/${context.summary.total} 项，当前任务：${context.learnedTask}】`;
  return {
    ...item,
    id: `${item.id}-${context.summary.currentDay || 1}-${context.summary.done}-${context.variant || 0}-${context.index}`,
    conceptId: item.conceptId || slugify(`${item.dimension || "general"}-${item.id}`).slice(0, 80),
    difficulty: item.difficulty || (item.type === "code" ? 4 : item.type === "short" ? 3 : 2),
    estimatedTimeSec,
    timeLimitSec: quizOptions.timeLimitSec || item.timeLimitSec || estimatedTimeSec,
    hintLadder: quizOptions.showHints === false ? [] : item.hintLadder || [
      "先判断题目考查的知识点。",
      "再写出适用条件或关键公式。",
      "最后排除与条件冲突的选项或步骤。"
    ],
    quizOptions: {
      difficulty: quizOptions.difficulty,
      knowledgeScope: quizOptions.knowledgeScope,
      focusDimension: quizOptions.focusDimension,
      showAnswerMode: quizOptions.showAnswerMode,
      includeSimilar: quizOptions.includeSimilar,
      includeRetest: quizOptions.includeRetest
    },
    scoringSignals: {
      usesProgress: true,
      usesMistakeHistory: context.missedDimensions.length > 0,
      retestRecommendedBelow: 70
    },
    question: `${progressPrefix}\n${missedText}\n${item.question}`,
    relatedDay: context.summary.currentDay || 1,
    progressContext: {
      done: context.summary.done,
      total: context.summary.total,
      learnedTask: context.learnedTask,
      missedDimensions: context.missedDimensions
    }
  };
}

function stableHash(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function summarizeProgress(plan, progress = {}) {
  const dailyPlan = plan?.dailyPlan || [];
  const completedTasks = [];
  let done = 0;
  let total = 0;
  let currentDay = 1;

  dailyPlan.forEach((day) => {
    (day.tasks || []).forEach((task, index) => {
      total += 1;
      const key = `day-${day.day}-task-${index}`;
      if (progress[key]) {
        done += 1;
        completedTasks.push(task);
        currentDay = Math.max(currentDay, Number(day.day) || 1);
      }
    });
  });

  return {
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    currentDay,
    completedTasks,
    focus: plan?.learnerProfile?.weakestDimensions?.[0]?.dimension
  };
}

function buildGenerationLoop(input, learnerProfile, path, resources, assessment) {
  const weakest = learnerProfile.weakestDimensions.map((item) => item.dimension).join("、");
  const qualityScore = clamp(72 + Math.round(resources.length * 2.5) + (assessment.quiz.length >= 4 ? 8 : 0) - 4);
  return {
    objective: `围绕“${input.topic}”生成可每日执行、可测评更新的个性化学习方案。`,
    status: qualityScore >= 80 ? "已通过质量评审" : "已完成首轮修正",
    qualityScore,
    stages: [
      { id: "profile-agent", agent: "学习画像智能体", status: "done", action: "读取表单目标、基础、偏好和薄弱点", input: "用户学习需求", output: `初始画像：${weakest}` },
      { id: "knowledge-graph-agent", agent: "知识图谱智能体", status: "done", action: "拆解知识节点和先修关系", input: "学习画像与学习主题", output: "形成可诊断、可推荐、可复测的知识图谱" },
      { id: "diagnostic-pretest-agent", agent: "诊断前测智能体", status: "done", action: "生成首轮诊断题", input: "知识图谱与薄弱维度", output: "形成诊断前测和错因标签" },
      { id: "diagnosis-agent", agent: "知识诊断智能体", status: "done", action: "把薄弱点映射到知识维度", input: "画像与薄弱点文本", output: `优先补救：${learnerProfile.weakestDimensions[0].dimension}` },
      { id: "planner-agent", agent: "路径规划智能体", status: "done", action: "拆分阶段路径和每日任务", input: "诊断结果、周期、每日时间", output: `生成 ${path.length} 个阶段` },
      { id: "resource-agent", agent: "资源生成智能体", status: "done", action: "生成讲义、例题、练习和解析", input: "路径约束与学习偏好", output: `生成 ${resources.length} 类资源` },
      { id: "assessment-agent", agent: "测评评分智能体", status: "done", action: "生成选择题并定义评分规则", input: "资源草案与进度信号", output: `生成 ${assessment.quiz.length} 道选择题` },
      { id: "governance-agent", agent: "内容治理智能体", status: "done", action: "审查知识点绑定、证据来源和答案泄露风险", input: "资源、测评、图谱与每日任务", output: "形成质量治理报告" },
      { id: "insight-agent", agent: "个人洞察智能体", status: "done", action: "汇总薄弱知识点和下一步行动", input: "掌握度、错因、质量报告", output: "形成个人学习洞察" },
      { id: "coach-agent", agent: "学习陪练智能体", status: "done", action: "整合为可追问上下文", input: "方案、资源、测评规则", output: "形成后续答疑上下文" }
    ],
    flows: [
      { from: "用户输入", to: "学习画像智能体", payload: "目标、水平、周期、偏好、薄弱点" },
      { from: "学习画像智能体", to: "知识图谱智能体", payload: "初始画像、掌握度预估、薄弱维度" },
      { from: "知识图谱智能体", to: "诊断前测智能体", payload: "知识节点、先修关系、概念难度" },
      { from: "诊断前测智能体", to: "知识诊断智能体", payload: "诊断题、错因标签、待测概念" },
      { from: "知识诊断智能体", to: "路径规划智能体", payload: "薄弱维度和补救优先级" },
      { from: "路径规划智能体", to: "资源生成智能体", payload: "阶段路径、每日任务约束" },
      { from: "资源生成智能体", to: "测评评分智能体", payload: "讲义、例题、练习知识点" },
      { from: "测评评分智能体", to: "内容治理智能体", payload: "题目、标准答案、解析和安全边界" },
      { from: "内容治理智能体", to: "个人洞察智能体", payload: "质量评分、风险项和需补强知识点" },
      { from: "测评评分智能体", to: "学习画像智能体", payload: "得分、错因、维度证据" },
      { from: "学习画像智能体", to: "学习陪练智能体", payload: "更新后的画像和下一步建议" }
    ],
    artifacts: [
      { id: "learner-profile-v1", owner: "学习画像智能体", type: "profile", version: 1, status: "accepted", reviewers: ["知识诊断智能体"] },
      { id: "knowledge-graph-v1", owner: "知识图谱智能体", type: "concept-graph", version: 1, status: "accepted", reviewers: ["诊断前测智能体", "内容治理智能体"] },
      { id: "diagnostic-pretest-v1", owner: "诊断前测智能体", type: "assessment", version: 1, status: "accepted", reviewers: ["内容治理智能体"] },
      { id: "daily-plan-v1", owner: "路径规划智能体", type: "plan", version: 1, status: "accepted", reviewers: ["资源生成智能体"] },
      { id: "resource-pack-v1", owner: "资源生成智能体", type: "resources", version: 1, status: "needs-review", reviewers: ["内容治理智能体", "个人洞察智能体"] },
      { id: "quality-report-v1", owner: "内容治理智能体", type: "governance", version: 1, status: "accepted", reviewers: ["个人洞察智能体"] }
    ],
    revisionCycles: [
      {
        round: 1,
        reviewer: "内容治理智能体",
        issue: "检查题目答案、知识点绑定、难度梯度和泄题风险。",
        decision: "通过基础质量门禁；若个人质量面板发现风险，可退回资源生成智能体重写。"
      },
      {
        round: 2,
        reviewer: "个人洞察智能体",
        issue: "根据薄弱知识点确认补救练习是否可执行。",
        decision: "生成个人补强包、复测建议和下一步行动。"
      }
    ],
    review: {
      passed: qualityScore >= 80,
      checks: [
        { label: "画像可更新", passed: true, detail: "掌握度标注来源，前端会按打卡和测评重新计算。" },
        { label: "每日可执行", passed: true, detail: `任务按每天 ${input.dailyMinutes} 设计。` },
        { label: "资源完整", passed: resources.length >= 4, detail: "覆盖讲义、例题、练习、解析和复盘。" },
        { label: "测评闭环", passed: assessment.quiz.length >= 4, detail: "包含选择题、答案、解析和后续动作。" }
      ]
    }
  };
}

function buildResourcePackage(input, learnerProfile, path, resources, assessment, generationLoop) {
  const mainWeakness = learnerProfile.weakestDimensions[0];
  const secondaryWeakness = learnerProfile.weakestDimensions[1];
  return {
    title: `${input.topic} 个性化学习资源包`,
    audience: `${input.level}学习者 / ${input.style}偏好 / 每天 ${input.dailyMinutes}`,
    packageScore: generationLoop.qualityScore,
    sections: [
      {
        type: "学情诊断报告",
        title: "当前画像结论",
        items: [
          learnerProfile.summary,
          `首要补强维度：${mainWeakness.dimension}（初始 ${mainWeakness.score} 分）`,
          `次要补强维度：${secondaryWeakness.dimension}（初始 ${secondaryWeakness.score} 分）`
        ]
      },
      {
        type: "补救微讲义",
        title: `${mainWeakness.dimension} 快速补救`,
        items: [
          `先复述 ${input.topic} 的核心概念，暴露理解断点。`,
          "再用一个生活化例子解释概念，避免只背定义。",
          "最后完成 2 道低门槛迁移题，确认能把概念用到新情境。"
        ]
      },
      {
        type: "进度匹配练习",
        title: `${input.topic} 专项选择题`,
        items: assessment.quiz.map((item) => item.question)
      },
      {
        type: "答案解析与错因提醒",
        title: "自查清单",
        items: assessment.quiz.map((item) => `${item.explanation}`)
      },
      {
        type: "后续学习路径",
        title: "下一轮行动",
        items: path.map((item) => `${item.stage}：${item.outcome}`)
      }
    ],
    deliverables: ["学情诊断报告", "补救微讲义", "进度匹配选择题", "答案解析", "错因复盘表", "下一轮学习路径"],
    usageGuide: [
      "每天先完成打卡任务，再做当前进度对应的测评题。",
      "不会的题先看提示，再看答案解析。",
      "把错因写进学习笔记，下一次出题会优先覆盖这些知识点。"
    ],
    sourceTrace: resources.map((item) => `${item.type}：${item.title}`)
  };
}

function buildDailyPlan(input, learnerProfile, knowledgeGraph) {
  const days = durationToDays(input.duration);
  const focus = learnerProfile.weakestDimensions[0].dimension;
  const concepts = ensureArray(knowledgeGraph?.concepts, []);
  const conceptTitles = new Map(concepts.map((item) => [item.id, item.title]));
  return Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const concept = concepts[index % Math.max(1, concepts.length)] || {
      id: `concept-${day}`,
      title: fallbackConceptTitle(input.topic, index),
      dimension: focus,
      standard: `理解 ${input.topic} 的核心概念、适用条件和实际用法。`,
      prerequisites: [],
      misconceptions: ["只记定义而忽略适用条件", "会复述但不能迁移到具体问题"]
    };
    return {
      day,
      title: `第 ${day} 天：${concept.title}`,
      estimate: input.dailyMinutes,
      focus: concept.dimension || focus,
      tasks: [
        `完整阅读“${concept.title}”讲义，整理定义、原理、适用条件和常见误区。`,
        `跟随案例逐步分析 ${concept.title} 如何用于“${input.goal}”，重做关键步骤。`,
        `独立完成“${concept.title}”基础题和变式题，对照解析记录具体错因。`
      ],
      materials: buildDetailedDailyMaterials(input, focus, day, {
        ...concept,
        prerequisiteTitles: ensureArray(concept.prerequisites, []).map((id) => conceptTitles.get(id) || id)
      }),
      checkpoint: day % 3 === 0 ? "完成一次小测并更新薄弱点。" : "用一句话总结今天的收获。"
    };
  });
}

function fallbackConceptTitle(topic, index) {
  const names = [
    "基本术语与问题边界",
    "核心组成与相互关系",
    "基本原理与运行机制",
    "标准工作流程",
    "适用条件与限制",
    "典型方法与选择依据",
    "基础案例分析",
    "常见错误与排查方法",
    "结果评价与质量标准",
    "改进与优化策略",
    "复杂情境应用",
    "综合项目设计",
    "表达、汇报与复盘",
    "迁移应用与自主提升"
  ];
  return `${topic} 的${names[index % names.length]}`;
}

function buildTutorCards(input, learnerProfile) {
  const focus = learnerProfile.weakestDimensions[0].dimension;
  return [
    { title: "今天卡住时先问", prompt: `我在学习 ${input.topic} 时，对 ${focus} 不理解，请用 ${input.style} 方式解释。` },
    { title: "做题后复盘", prompt: `我刚做错了一道 ${input.topic} 题，错因可能是 ${input.weaknesses}，请帮我分析。` },
    { title: "准备下一轮", prompt: `根据我的学习笔记和测评结果，帮我更新下一天 ${input.topic} 学习任务。` }
  ];
}

function mergeLearningPlan(localPlan, llmPlan) {
  const merged = {
    ...localPlan,
    ...pickKnownPlanFields(llmPlan)
  };
  merged.profile = {
    summary: merged.learnerProfile?.summary || localPlan.profile.summary,
    tags: merged.learnerProfile?.tags || localPlan.profile.tags,
    priority: merged.learnerProfile?.strategyPriorities || localPlan.profile.priority
  };
  return normalizePlanShape(merged, localPlan);
}

function pickKnownPlanFields(plan) {
  const fields = [
    "learnerProfile",
    "knowledgeGraph",
    "diagnosticPretest",
    "adaptiveState",
    "path",
    "resources",
    "assessment",
    "generationLoop",
    "remediationPlan",
    "governanceReport",
    "personalInsights",
    "resourcePackage",
    "dailyPlan",
    "tutorCards"
  ];
  return Object.fromEntries(fields.filter((field) => plan?.[field]).map((field) => [field, plan[field]]));
}

function normalizePlanShape(plan, fallback) {
  const resources = ensureArray(plan.resources, fallback.resources);
  return {
    ...plan,
    learnerProfile: normalizeLearnerProfile(plan.learnerProfile, fallback.learnerProfile),
    knowledgeGraph: normalizeKnowledgeGraph(plan.knowledgeGraph, fallback.knowledgeGraph),
    diagnosticPretest: normalizeDiagnosticPretest(plan.diagnosticPretest, fallback.diagnosticPretest),
    adaptiveState: plan.adaptiveState || fallback.adaptiveState,
    path: ensureArray(plan.path, fallback.path),
    resources,
    assessment: normalizeAssessment(plan.assessment, fallback.assessment),
    generationLoop: normalizeGenerationLoop(plan.generationLoop, fallback.generationLoop),
    remediationPlan: plan.remediationPlan || fallback.remediationPlan,
    governanceReport: plan.governanceReport || fallback.governanceReport,
    personalInsights: plan.personalInsights || fallback.personalInsights,
    resourcePackage: plan.resourcePackage || fallback.resourcePackage,
    dailyPlan: normalizeDailyPlan(plan.dailyPlan, fallback.dailyPlan),
    tutorCards: ensureArray(plan.tutorCards, fallback.tutorCards)
  };
}

export function normalizeDailyPlan(candidate, fallback) {
  const supplied = ensureArray(candidate, []);
  const suppliedByDay = new Map(
    supplied
      .filter((day) => Number.isInteger(Number(day?.day)))
      .map((day) => [Number(day.day), day])
  );
  const hasDayNumbers = suppliedByDay.size > 0;
  return fallback.map((fallbackDay, index) => {
    const dayNumber = index + 1;
    const day = suppliedByDay.get(dayNumber)
      || (!hasDayNumbers ? supplied[index] : null)
      || fallbackDay;
    return {
      ...fallbackDay,
      ...day,
      day: dayNumber,
      tasks: ensureArray(day.tasks, fallbackDay.tasks),
      materials: ensureArray(day.materials, fallbackDay.materials)
    };
  });
}

function buildDetailedDailyMaterials(input, focus, day, concept) {
  const conceptTitle = concept?.title || `${input.topic} 核心知识点`;
  const standard = concept?.standard || `理解 ${conceptTitle} 的定义、原理和用途。`;
  const prerequisites = ensureArray(concept?.prerequisiteTitles, concept?.prerequisites || []);
  const misconceptions = ensureArray(concept?.misconceptions, ["只背定义而不会应用", "忽略适用条件和边界"]);
  return [
    {
      type: "详细讲义",
      title: `第 ${day} 天讲义：${conceptTitle}`,
      content: `本讲义围绕“${conceptTitle}”建立从概念到应用的完整知识链。学习目标是：${standard}`,
      sections: [
        {
          heading: "一、概念与学习目标",
          body: `${conceptTitle} 是本节的核心知识点。学习时要明确它解决什么问题、接收哪些输入、产生什么输出，以及用什么标准判断结果。完成后不仅要能复述概念，还要能用自己的例子说明它为何有效。`
        },
        {
          heading: "二、前置知识与核心原理",
          body: `${prerequisites.length ? `建议先确认已理解这些前置节点：${prerequisites.join("、")}。` : "本节不要求额外的专门前置知识，但需要先理解问题目标、已知条件和约束。"} 核心原理按“识别问题—选择方法—执行步骤—检查结果”理解：每一步都必须对应一个明确条件，不能只记操作顺序。`
        },
        {
          heading: "三、适用条件与边界",
          body: `使用 ${conceptTitle} 前，要确认当前问题与它解决的问题类型一致，输入信息足够且评价标准明确。如果关键条件缺失、信息不可靠，或者目标与方法假设不匹配，就要补充信息或改用其他方法，不能机械套用结论。`
        },
        {
          heading: "四、常见误区与纠正",
          body: `常见误区包括：${misconceptions.join("；")}。纠正方法是每次作答都写出“选择这个概念的依据”和“结论成立所需的条件”，再用一个不满足条件的反例检查理解。`
        },
        {
          heading: "五、本节知识小结",
          body: `掌握 ${conceptTitle} 的标准是：能解释定义和原理，能识别适用与不适用的情境，能独立完成具体案例，并能根据结果发现错误、说明原因和提出修正方案。`
        }
      ]
    },
    {
      type: "完整案例",
      title: `案例：用 ${conceptTitle} 推进“${input.goal}”`,
      content: `下面用一个从需求到复盘的完整案例演示 ${conceptTitle}，每一步都给出行动和判断依据。`,
      sections: [
        {
          heading: "案例背景",
          body: `学习者希望实现“${input.goal}”，但当前薄弱点是“${focus}”。案例把目标拆成一个可验证的小任务：使用 ${conceptTitle} 得出结果，并说明结果如何支持原目标。`
        },
        {
          heading: "分析与执行",
          body: "执行时不要直接套答案，应保留每一步的输入、中间结果和选择依据。",
          steps: [
            `明确任务输出：写下完成“${input.goal}”时希望得到的具体成果和判断标准。`,
            `整理已知条件：区分已掌握、仍需查证的信息，以及 ${conceptTitle} 所要求的必要条件。`,
            `应用核心方法：按本节原理逐步处理，并在每一步旁写出为什么这样做。`,
            "验证结果：使用一个正常例子和一个边界反例检查结论；若结果冲突，返回上一步修正。"
          ]
        },
        {
          heading: "案例结论与迁移",
          body: `案例形成了可复用过程：定义目标、核对条件、应用 ${conceptTitle}、用证据检查结果。把案例中的目标、输入或限制替换一项，如果仍能解释每一步，才说明真正具备迁移能力。`
        }
      ]
    },
    {
      type: "练习与解析",
      title: `${conceptTitle} 基础题与变式题`,
      content: "练习覆盖概念解释、场景应用和边界判断。请先独立作答，再展开参考解析。",
      questions: [
        {
          prompt: `请用自己的话解释 ${conceptTitle}，写出它解决的问题、两个适用条件和一个不适用的反例。`,
          answer: "合格答案应覆盖概念是什么、为什么需要、在什么条件下使用、何时不能使用。反例必须指出具体哪个条件不成立，不能只写“情况不同”。"
        },
        {
          prompt: `把 ${conceptTitle} 应用于“${input.goal}”：列出输入、执行步骤、预期输出和验证方法。`,
          answer: "先把目标改写为可检查的成果，再列出必要信息；执行步骤要逐项对应本节原理；验证部分至少包括评价标准、正常样例和边界样例。"
        },
        {
          prompt: "如果案例中的一个关键条件不再满足，你会如何识别问题并调整方案？",
          answer: "先指出失效的具体条件及影响，再决定补充信息、调整步骤或更换方法。修正后要重新验证结果，不能沿用原结论。"
        }
      ]
    }
  ];
}

function normalizeLearnerProfile(profile, fallback) {
  if (!profile) return fallback;
  return {
    ...fallback,
    ...profile,
    mastery: ensureArray(profile.mastery, fallback.mastery),
    weakestDimensions: ensureArray(profile.weakestDimensions, fallback.weakestDimensions),
    tags: ensureArray(profile.tags, fallback.tags),
    behaviorSignals: ensureArray(profile.behaviorSignals, fallback.behaviorSignals),
    strategyPriorities: ensureArray(profile.strategyPriorities, fallback.strategyPriorities)
  };
}

function normalizeKnowledgeGraph(graph, fallback) {
  if (!graph) return fallback;
  return {
    ...fallback,
    ...graph,
    dimensions: ensureArray(graph.dimensions, fallback.dimensions),
    concepts: ensureArray(graph.concepts, fallback.concepts),
    edges: ensureArray(graph.edges, fallback.edges)
  };
}

function normalizeDiagnosticPretest(diagnostic, fallback) {
  if (!diagnostic) return fallback;
  return {
    ...fallback,
    ...diagnostic,
    items: ensureArray(diagnostic.items, fallback.items)
  };
}

function normalizeAssessment(assessment, fallback) {
  if (!assessment) return fallback;
  return {
    ...fallback,
    ...assessment,
    quiz: ensureArray(assessment.quiz, fallback.quiz),
    rubric: ensureArray(assessment.rubric, fallback.rubric),
    nextActions: ensureArray(assessment.nextActions, fallback.nextActions)
  };
}

function normalizeGenerationLoop(loop, fallback) {
  if (!loop) return fallback;
  return {
    ...fallback,
    ...loop,
    stages: ensureArray(loop.stages, fallback.stages),
    flows: ensureArray(loop.flows, fallback.flows)
  };
}

async function callLargeModelForPlan(input, localPlan) {
  const planSeed = {
    profileSummary: localPlan.learnerProfile.summary,
    mastery: localPlan.learnerProfile.mastery,
    weak: localPlan.learnerProfile.weakestDimensions,
    requiredDays: durationToDays(input.duration)
  };
  const corePrompt = `你是一个中文多智能体学习系统。请基于学生输入生成个性化学习方案的核心结构。
只返回 JSON，不要 Markdown，也不要生成 dailyPlan。字段必须包含：
{
 "learnerProfile":{"summary":"","mastery":[{"dimension":"","score":0,"evidence":"","source":"estimated"}],"weakestDimensions":[{"dimension":"","score":0}],"tags":[],"behaviorSignals":[],"strategyPriorities":[]},
 "path":[{"stage":"","task":"","outcome":""}],
 "resources":[{"type":"","title":"","content":""}],
 "assessment":{"quiz":[{"id":"","type":"choice","dimension":"","question":"","options":[],"answerIndex":0,"explanation":"","score":25}],"rubric":[],"nextActions":[]},
 "resourcePackage":{"title":"","audience":"","packageScore":0,"sections":[{"type":"","title":"","items":[]}],"deliverables":[],"usageGuide":[],"sourceTrace":[]},
 "tutorCards":[{"title":"","prompt":""}]
}

要求：
1. path 必须体现从当前水平到学习目标的阶段性递进。
2. assessment.quiz 必须是 4 道选择题，带 options、answerIndex、explanation。
3. learnerProfile.mastery 必须说明 evidence/source，不能伪装成真实测量数据。
4. 内容要针对学生输入，不要泛泛而谈；单个长文本控制在 160 字以内。

学生输入：${JSON.stringify(input)}
本地画像种子：${JSON.stringify(planSeed)}`;

  const coreRequest = captureModelRequest(async () => {
    const content = await requestChatCompletion([
      { role: "system", content: "你是严谨的个性化学习资源生成专家，必须输出可解析 JSON。" },
      { role: "user", content: corePrompt }
    ], { temperature: 0.3, maxTokens: 2600 });
    return parseJsonFromModel(content);
  });

  const dailyBatches = splitDailyPlanBatches(localPlan.dailyPlan, planSeed.requiredDays);
  const dailyRequests = mapWithConcurrency(dailyBatches, 3, (batch) => (
    captureModelRequest(() => callLargeModelForDailyBatch(input, planSeed, batch))
  ));
  const [coreResult, dailyResults] = await Promise.all([coreRequest, dailyRequests]);
  const generatedDays = dailyResults
    .filter((result) => result.ok)
    .flatMap((result) => ensureArray(result.value?.dailyPlan, []));

  if (!coreResult.ok && !generatedDays.length) {
    const firstBatchError = dailyResults.find((result) => !result.ok)?.error;
    throw coreResult.error || firstBatchError || new Error("大模型未返回可用学习方案。");
  }

  return {
    ...(coreResult.ok ? coreResult.value : {}),
    ...(generatedDays.length ? { dailyPlan: generatedDays } : {})
  };
}

async function callLargeModelForDailyBatch(input, planSeed, batch) {
  const requestedDays = batch.map((day) => day.day);
  const prompt = `请为学生生成个性化的每日学习路径。
只返回 JSON，不要 Markdown。格式为：
{"dailyPlan":[{"day":1,"title":"","estimate":"","focus":"","tasks":["","",""],"materials":[{"type":"核心讲义","title":"","content":""},{"type":"案例与练习","title":"","content":""}],"checkpoint":""}]}

要求：
1. 仅生成第 ${requestedDays.join("、")} 天，day 值必须与这些天数一致，不得缺失。
2. 每天恰好 3 个可执行任务，并与前后学习进度衔接。
3. 每天生成 2 份针对当天主题的材料：核心讲义必须解释定义、原理和适用边界；案例与练习必须给出具体情境、步骤和自检方法。每份 content 控制在 120-220 个中文字。
4. 必须针对学生的主题、目标和薄弱点，不要使用“核心知识点”等占位表达。

学生输入：${JSON.stringify(input)}
总天数：${planSeed.requiredDays}
当前批次种子：${JSON.stringify(batch.map((day) => ({
    day: day.day,
    title: day.title,
    focus: day.focus,
    tasks: day.tasks
  })))}`;

  const content = await requestChatCompletion([
    { role: "system", content: "你是严谨的个性化学习资源生成专家，必须输出可解析 JSON。" },
    { role: "user", content: prompt }
  ], { temperature: 0.3, maxTokens: Math.min(7000, 1000 + batch.length * 520) });
  return parseJsonFromModel(content);
}

function splitDailyPlanBatches(dailyPlan, requiredDays) {
  const batchSize = requiredDays <= 14 ? 7 : requiredDays <= 30 ? 10 : 15;
  const batches = [];
  for (let index = 0; index < dailyPlan.length; index += batchSize) {
    batches.push(dailyPlan.slice(index, index + batchSize));
  }
  return batches;
}

async function captureModelRequest(work) {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error };
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
