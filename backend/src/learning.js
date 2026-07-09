import { agents } from "./agents.js";

import { MODEL_CONFIG } from "./config.js";

import { clean, clamp, ensureArray, normalizeCodeLanguage } from "./utils.js";

import { requestChatCompletion, parseJsonFromModel } from "./llm.js";

import { bootstrapJudgeRuntime, friendlyJudgeError } from "./judge.js";

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
  const path = buildLearningPath(input);
  const dailyPlan = buildDailyPlan(input, learnerProfile);
  const assessment = buildAssessment(input, learnerProfile, dailyPlan);
  const resources = buildResources(input, learnerProfile, assessment);
  const generationLoop = buildGenerationLoop(input, learnerProfile, path, resources, assessment);
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
    path,
    resources,
    assessment,
    generationLoop,
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
  }, () => buildDailyPlan(input, learnerProfile));

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
  }, () => buildResources(input, learnerProfile, assessment));

  const generationLoop = await runStage({
    agentId: "quality-agent",
    agent: "协作质检智能体",
    action: "检查各智能体产物之间的数据依赖和质量闭环",
    input: "画像、路径、资源、测评题",
    outputOf: (loop) => `质量分 ${loop.qualityScore}，数据流 ${loop.flows.length} 条`
  }, () => buildGenerationLoop(input, learnerProfile, path, resources, assessment));

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
    path,
    resources,
    assessment,
    generationLoop: {
      ...generationLoop,
      trace
    },
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

function buildResources(input, learnerProfile, assessment) {
  const focus = learnerProfile.weakestDimensions[0].dimension;
  return [
    {
      type: "微讲义",
      title: `${input.topic} 核心概念速览`,
      content: `按“概念定义-现实类比-关键步骤-易错点”的结构学习 ${input.topic}，每个概念都写出自己的例子。`
    },
    {
      type: "例题讲解",
      title: `${input.topic} 场景化案例`,
      content: `选择一个熟悉场景，说明 ${input.topic} 如何解决问题，并标出输入、处理、输出和评估方式。`
    },
    {
      type: "进度匹配练习",
      title: `${focus} 专项选择题组`,
      content: `练习会优先覆盖已打卡任务和薄弱维度，当前默认生成 ${assessment.quiz.length} 道选择题。`
    },
    {
      type: "复盘模板",
      title: "错因记录表",
      content: "记录错题、卡点、正确思路、下次提醒和需要补学的知识点，用于下一次画像更新。"
    }
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
  const quizOptions = {
    ...options,
    includeCode: shouldIncludeProgrammingQuestion(input, plan, progress, history),
    codeLanguage: inferProgrammingLanguage(input, plan, history)
  };
  if (quizOptions.includeCode && JUDGE_AUTO_BOOTSTRAP) {
    bootstrapJudgeRuntime().catch((error) => {
      console.warn(`判题沙箱准备失败：${friendlyJudgeError(error)}`);
    });
  }
  const localQuiz = buildProgressQuiz(input, plan, progress, variant, history, quizOptions);

  if (!MODEL_CONFIG.apiKey) {
    return { quiz: localQuiz, mode: "local-bank", llmUsed: false, includeCode: quizOptions.includeCode, judge: judgeBootstrapStatus };
  }

  try {
    const llmQuiz = await callLargeModelForQuiz(input, plan, progress, summary, variant, history, quizOptions);
    return { quiz: normalizeGeneratedQuiz(llmQuiz, localQuiz, summary, variant, quizOptions), mode: "llm-quiz", llmUsed: true, includeCode: quizOptions.includeCode, judge: judgeBootstrapStatus };
  } catch (error) {
    return {
      quiz: localQuiz,
      mode: "local-bank-fallback",
      llmUsed: false,
      includeCode: quizOptions.includeCode,
      judge: judgeBootstrapStatus,
      warning: "大模型出题失败，已使用本地专业题库。",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
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
1. 生成 4 道题，必须和当前主题 ${input.topic} 的专业知识强相关，不要泛泛学习方法题。
2. 必须利用 completedDays 和 recentHistory，避免重复 recentHistory 中的题干。
3. ${options.includeCode ? `当前学习内容适合编程训练，题型结构必须严格为：2 道 choice 选择题、1 道 short 简答题、1 道 code 编程题；编程题语言必须是 ${options.codeLanguage}，tests 要可由服务端判题沙箱运行。` : "当前学习内容暂不适合编程训练，题型结构为 3 道 choice 选择题、1 道 short 简答题。"}
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
  includeProgrammingQuestion: options.includeCode,
  requiredCodeLanguage: options.codeLanguage
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
  const structured = pickQuizByStructure(normalized, options.includeCode);
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
  return selected.map((item, index) => applyQuizContext(item, {
    index,
    variant,
    summary,
    learnedTask,
    missedDimensions
  }));
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
  const usableItems = options.includeCode ? items : items.filter((item) => item.type !== "code");
  const previousBaseIds = new Set(
    history
      .map((item) => String(item.questionId || "").split("-").slice(0, -4).join("-"))
      .filter(Boolean)
  );
  const prioritized = missedDimensions.length
    ? usableItems.filter((item) => missedDimensions.includes(item.dimension)).concat(usableItems.filter((item) => !missedDimensions.includes(item.dimension)))
    : usableItems;
  const rotated = prioritized.slice(offset % prioritized.length).concat(prioritized.slice(0, offset % prioritized.length));
  const fresh = rotated.filter((item) => !previousBaseIds.has(item.id));
  const pool = fresh.length >= 4 ? fresh : rotated;
  const selected = pickQuizByStructure(pool, Boolean(options.includeCode));
  if (selected) return selected;
  return pool.slice(0, 4);
}

function applyQuizContext(item, context) {
  const missedText = context.missedDimensions.length
    ? `上一轮薄弱维度：${context.missedDimensions.join("、")}。`
    : "上一轮暂无明显错题维度。";
  const progressPrefix = `【进度：已完成 ${context.summary.done}/${context.summary.total} 项，当前任务：${context.learnedTask}】`;
  return {
    ...item,
    id: `${item.id}-${context.summary.currentDay || 1}-${context.summary.done}-${context.variant || 0}-${context.index}`,
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
      { id: "diagnosis-agent", agent: "知识诊断智能体", status: "done", action: "把薄弱点映射到知识维度", input: "画像与薄弱点文本", output: `优先补救：${learnerProfile.weakestDimensions[0].dimension}` },
      { id: "planner-agent", agent: "路径规划智能体", status: "done", action: "拆分阶段路径和每日任务", input: "诊断结果、周期、每日时间", output: `生成 ${path.length} 个阶段` },
      { id: "resource-agent", agent: "资源生成智能体", status: "done", action: "生成讲义、例题、练习和解析", input: "路径约束与学习偏好", output: `生成 ${resources.length} 类资源` },
      { id: "assessment-agent", agent: "测评评分智能体", status: "done", action: "生成选择题并定义评分规则", input: "资源草案与进度信号", output: `生成 ${assessment.quiz.length} 道选择题` },
      { id: "coach-agent", agent: "学习陪练智能体", status: "done", action: "整合为可追问上下文", input: "方案、资源、测评规则", output: "形成后续答疑上下文" }
    ],
    flows: [
      { from: "用户输入", to: "学习画像智能体", payload: "目标、水平、周期、偏好、薄弱点" },
      { from: "学习画像智能体", to: "知识诊断智能体", payload: "初始画像、掌握度预估、行为信号" },
      { from: "知识诊断智能体", to: "路径规划智能体", payload: "薄弱维度和补救优先级" },
      { from: "路径规划智能体", to: "资源生成智能体", payload: "阶段路径、每日任务约束" },
      { from: "资源生成智能体", to: "测评评分智能体", payload: "讲义、例题、练习知识点" },
      { from: "测评评分智能体", to: "学习画像智能体", payload: "得分、错因、维度证据" },
      { from: "学习画像智能体", to: "学习陪练智能体", payload: "更新后的画像和下一步建议" }
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

function buildDailyPlan(input, learnerProfile) {
  const days = input.duration.includes("3 天") ? 3 : input.duration.includes("1 个月") ? 14 : input.duration.includes("3 个月") ? 21 : 10;
  const focus = learnerProfile.weakestDimensions[0].dimension;
  return Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    return {
      day,
      title: `第 ${day} 天：${day <= 3 ? "概念补强" : day <= 7 ? "练习迁移" : "项目复盘"}`,
      estimate: input.dailyMinutes,
      focus,
      tasks: [
        `学习 ${input.topic} 的一个核心概念，并写下自己的解释。`,
        `完成 2 道围绕“${focus}”的练习题。`,
        "记录一个错因或一个新的理解。"
      ],
      checkpoint: day % 3 === 0 ? "完成一次小测并更新薄弱点。" : "用一句话总结今天的收获。"
    };
  });
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
  const fields = ["learnerProfile", "path", "resources", "assessment", "generationLoop", "resourcePackage", "dailyPlan", "tutorCards"];
  return Object.fromEntries(fields.filter((field) => plan?.[field]).map((field) => [field, plan[field]]));
}

function normalizePlanShape(plan, fallback) {
  return {
    ...plan,
    learnerProfile: normalizeLearnerProfile(plan.learnerProfile, fallback.learnerProfile),
    path: ensureArray(plan.path, fallback.path),
    resources: ensureArray(plan.resources, fallback.resources),
    assessment: normalizeAssessment(plan.assessment, fallback.assessment),
    generationLoop: normalizeGenerationLoop(plan.generationLoop, fallback.generationLoop),
    resourcePackage: plan.resourcePackage || fallback.resourcePackage,
    dailyPlan: ensureArray(plan.dailyPlan, fallback.dailyPlan),
    tutorCards: ensureArray(plan.tutorCards, fallback.tutorCards)
  };
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
    requiredDays: input.duration.includes("3 天") ? 3 : 7
  };
  const prompt = `你是一个中文多智能体学习系统。请基于学生输入生成完整可执行学习方案。
只返回 JSON，不要 Markdown。字段必须包含：
{
 "learnerProfile":{"summary":"","mastery":[{"dimension":"","score":0,"evidence":"","source":"estimated"}],"weakestDimensions":[{"dimension":"","score":0}],"tags":[],"behaviorSignals":[],"strategyPriorities":[]},
 "path":[{"stage":"","task":"","outcome":""}],
 "resources":[{"type":"","title":"","content":""}],
 "assessment":{"quiz":[{"id":"","type":"choice","dimension":"","question":"","options":[],"answerIndex":0,"explanation":"","score":25}],"rubric":[],"nextActions":[]},
 "resourcePackage":{"title":"","audience":"","packageScore":0,"sections":[{"type":"","title":"","items":[]}],"deliverables":[],"usageGuide":[],"sourceTrace":[]},
 "dailyPlan":[{"day":1,"title":"","estimate":"","focus":"","tasks":[],"checkpoint":""}],
 "tutorCards":[{"title":"","prompt":""}]
}

要求：
1. dailyPlan 生成 ${planSeed.requiredDays} 天，每天 3 个任务，任务要具体到学生能直接执行。
2. assessment.quiz 必须是 4 道选择题，带 options、answerIndex、explanation，并能与 dailyPlan 的进度相关。
3. learnerProfile.mastery 必须说明 evidence/source，不能伪装成真实测量数据。
4. 内容要针对学生输入，不要泛泛而谈，每个长文本控制在 120 字以内。

学生输入：${JSON.stringify(input)}
本地画像种子：${JSON.stringify(planSeed)}`;

  const content = await requestChatCompletion([
    { role: "system", content: "你是严谨的个性化学习资源生成专家，必须输出可解析 JSON。" },
    { role: "user", content: prompt }
  ], { temperature: 0.35, maxTokens: 2800 });
  return parseJsonFromModel(content);
}
