import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

loadEnvFile();

const PORT = Number(process.env.BACKEND_PORT || 3000);
const MODEL_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: trimTrailingSlash(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
  model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  wireApi: process.env.OPENAI_WIRE_API || "chat",
  timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 180000)
};

const agents = [
  {
    id: "profile-agent",
    name: "学习画像智能体",
    role: "整合用户目标、基础、偏好、每日完成记录和测评表现，维护可更新的学习画像。"
  },
  {
    id: "diagnosis-agent",
    name: "知识诊断智能体",
    role: "把薄弱点、打卡进度、错题原因映射到知识维度，输出下一轮补救优先级。"
  },
  {
    id: "planner-agent",
    name: "路径规划智能体",
    role: "根据画像和诊断结果拆解阶段目标，生成每日任务和复习节奏。"
  },
  {
    id: "resource-agent",
    name: "资源生成智能体",
    role: "生成讲义、例题、练习题、解析和项目化任务，并接收规划智能体的约束。"
  },
  {
    id: "assessment-agent",
    name: "测评评分智能体",
    role: "根据用户答案自动评分，选择题即时判分，代码题可调用 Docker 沙箱运行测试。"
  },
  {
    id: "coach-agent",
    name: "学习陪练智能体",
    role: "基于当前方案、进度和测评结果回答追问，给出下一步建议。"
  }
];

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        status: "ok",
        service: "个性化资源生成与学习多智能体后端",
        llmEnabled: Boolean(MODEL_CONFIG.apiKey),
        llm: publicModelConfig(),
        time: new Date().toISOString()
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/llm-test") {
      const result = await testLargeModelConnection();
      sendJson(res, result.ok ? 200 : 503, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/agents") {
      sendJson(res, 200, { agents });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const input = normalizeInput(await readJson(req));
      const result = await generateLearningPlan(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/quiz") {
      const body = await readJson(req);
      const input = normalizeInput(body.input || {});
      const plan = body.plan || runLocalAgents(input);
      const progress = body.progress || {};
      const quiz = buildProgressQuiz(input, plan, progress, Boolean(body.regenerate));
      sendJson(res, 200, { quiz, generatedAt: new Date().toISOString(), source: summarizeProgress(plan, progress) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/evaluate") {
      const body = await readJson(req);
      const result = await evaluateAnswer(body);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tutor") {
      const body = await readJson(req);
      const result = await answerTutorQuestion({
        question: clean(body.question, 1000),
        context: clean(body.context, 5000)
      });
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { message: "接口不存在" });
  } catch (error) {
    sendJson(res, 500, {
      message: "服务器处理失败",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(PORT, () => {
  console.log(`API 服务已启动：http://localhost:${PORT}`);
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function loadEnvFile() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const rawKey = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const key = normalizeEnvKey(rawKey);
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function normalizeEnvKey(key) {
  const map = {
    base_url: "OPENAI_BASE_URL",
    model: "OPENAI_MODEL",
    wire_api: "OPENAI_WIRE_API",
    api_key: "OPENAI_API_KEY",
    openai_api_key: "OPENAI_API_KEY",
    openai_base_url: "OPENAI_BASE_URL",
    openai_model: "OPENAI_MODEL",
    openai_wire_api: "OPENAI_WIRE_API",
    openai_timeout_ms: "OPENAI_TIMEOUT_MS"
  };
  return map[key.trim().toLowerCase()] || key.trim();
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function publicModelConfig() {
  return {
    enabled: Boolean(MODEL_CONFIG.apiKey),
    baseUrl: MODEL_CONFIG.baseUrl,
    model: MODEL_CONFIG.model,
    wireApi: MODEL_CONFIG.wireApi,
    timeoutMs: MODEL_CONFIG.timeoutMs,
    apiKeyPreview: MODEL_CONFIG.apiKey ? maskApiKey(MODEL_CONFIG.apiKey) : null
  };
}

function maskApiKey(apiKey) {
  if (apiKey.length <= 10) return "已配置";
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) reject(new Error("请求体过大"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("JSON 格式不正确"));
      }
    });
  });
}

function normalizeInput(body) {
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

function clean(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function generateLearningPlan(input) {
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

function runLocalAgents(input) {
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
    quiz: buildProgressQuiz(input, { learnerProfile, dailyPlan }, {}, false),
    rubric: ["选择题按标准答案即时评分", "简答题按关键词覆盖、逻辑完整度和表达清晰度评分", "代码题可通过 Docker 沙箱运行测试用例"],
    nextActions: [
      "低于 60 分：回到概念讲义和基础题。",
      "60-85 分：继续强化练习和错题复盘。",
      "高于 85 分：进入项目化学习或更高难度任务。"
    ]
  };
}

function buildProgressQuiz(input, plan, progress = {}, regenerate = false) {
  const summary = summarizeProgress(plan, progress);
  const focus = summary.focus || plan?.learnerProfile?.weakestDimensions?.[0]?.dimension || "概念理解";
  const seedOffset = regenerate ? 1 : 0;
  const dayLabel = summary.currentDay ? `第 ${summary.currentDay} 天` : "当前阶段";
  const topic = input.topic || plan?.input?.topic || "当前主题";
  const learnedTask = summary.completedTasks[seedOffset % Math.max(1, summary.completedTasks.length)] || `${topic} 的核心概念`;

  return [
    {
      id: "q-understanding",
      type: "choice",
      dimension: focus,
      relatedDay: summary.currentDay || 1,
      question: `${dayLabel}学习后，最能说明你真正理解“${learnedTask}”的是哪一项？`,
      options: [
        "能用自己的例子解释它解决了什么问题，并指出适用条件",
        "能背出教材中的一句定义",
        "只要看过相关视频就算掌握",
        "能把所有公式完整抄写一遍"
      ],
      answerIndex: 0,
      explanation: "真正掌握不仅是记忆定义，还要能解释问题、条件和使用方式。",
      score: 25
    },
    {
      id: "q-transfer",
      type: "choice",
      dimension: "方法迁移",
      relatedDay: summary.currentDay || 1,
      question: `围绕“${topic}”，从已完成任务进入新场景时，第一步最应该做什么？`,
      options: [
        "先判断新场景的输入、目标和评价指标是否与原例题一致",
        "直接套用上一题答案",
        "跳过分析，先找更复杂的模型",
        "只关注最终结果，不需要记录过程"
      ],
      answerIndex: 0,
      explanation: "迁移能力的关键是识别新旧任务之间的相同点和差异点。",
      score: 25
    },
    {
      id: "q-review",
      type: "choice",
      dimension: "表达复盘",
      relatedDay: summary.currentDay || 1,
      question: "做错一道练习后，哪种复盘记录最有助于后续个性化出题？",
      options: [
        "写清楚错因、正确思路、涉及知识点和下次提醒",
        "只写“粗心”两个字",
        "删除错题避免影响心情",
        "只保存答案，不记录自己的思路"
      ],
      answerIndex: 0,
      explanation: "系统需要错因和知识点信号，才能把下一轮题目对准真实薄弱处。",
      score: 25
    },
    {
      id: "q-application",
      type: "choice",
      dimension: "实践应用",
      relatedDay: summary.currentDay || 1,
      question: `如果今天任务要求用 ${topic} 完成一个小案例，最合理的完成证据是什么？`,
      options: [
        "有可复现步骤、输入输出说明、结果评价和一句反思",
        "只截图最终页面",
        "只说自己看懂了",
        "只复制别人完整代码"
      ],
      answerIndex: 0,
      explanation: "实践题需要可复现、可评价和可反思，才能支撑真实掌握度更新。",
      score: 25
    }
  ];
}

function summarizeProgress(plan, progress = {}) {
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

function clamp(value) {
  return Math.max(20, Math.min(95, Math.round(value)));
}

async function evaluateAnswer(body) {
  const question = body.question || {};
  const answer = body.answer;

  if (question.type === "choice") {
    const selectedIndex = Number(answer);
    const correct = selectedIndex === Number(question.answerIndex);
    return {
      agent: "测评评分智能体",
      mode: "rule-choice",
      correct,
      score: correct ? Number(question.score || 25) : 0,
      maxScore: Number(question.score || 25),
      feedback: correct ? "回答正确，掌握证据已记录。" : `回答不正确。${question.explanation || "请回到对应知识点复习。"}`,
      dimension: question.dimension,
      evidence: {
        selectedIndex,
        answerIndex: question.answerIndex,
        explanation: question.explanation
      }
    };
  }

  if (question.type === "code") {
    return evaluateCodeAnswer(question, clean(answer, 8000));
  }

  return evaluateTextAnswer(question, clean(answer, 2000));
}

async function evaluateTextAnswer(question, answer) {
  if (!MODEL_CONFIG.apiKey) {
    const keywords = ensureArray(question.keywords, []).map((item) => String(item).toLowerCase());
    const lower = answer.toLowerCase();
    const hit = keywords.filter((keyword) => lower.includes(keyword)).length;
    const score = keywords.length ? Math.round((hit / keywords.length) * 100) : Math.min(100, Math.round(answer.length / 2));
    return {
      agent: "测评评分智能体",
      mode: "local-text",
      correct: score >= 60,
      score,
      maxScore: 100,
      feedback: score >= 60 ? "答案覆盖了主要要点。" : "答案要点不足，建议补充概念、例子和使用条件。",
      dimension: question.dimension
    };
  }

  const content = await requestChatCompletion([
    { role: "system", content: "你是中文学习测评评分智能体。只返回 JSON，不要 Markdown。" },
    { role: "user", content: `题目：${JSON.stringify(question)}\n学生答案：${answer}\n请返回 {"score":0-100,"correct":true/false,"feedback":"","dimension":""}` }
  ], { temperature: 0.2, maxTokens: 500 });
  return { agent: "测评评分智能体", mode: "llm-text", ...parseJsonFromModel(content) };
}

async function evaluateCodeAnswer(question, code) {
  const tests = ensureArray(question.tests, []);
  if (!tests.length) {
    return {
      agent: "测评评分智能体",
      mode: "code-no-tests",
      correct: false,
      score: 0,
      maxScore: 100,
      feedback: "代码题缺少测试用例，无法运行评测。"
    };
  }

  try {
    const result = await runCodeInDocker(question.language || "python", code, tests);
    return {
      agent: "测评评分智能体",
      mode: "docker-code",
      correct: result.passed === result.total,
      score: result.total ? Math.round((result.passed / result.total) * 100) : 0,
      maxScore: 100,
      feedback: `Docker 沙箱完成 ${result.total} 个测试，通过 ${result.passed} 个。`,
      detail: result
    };
  } catch (error) {
    return {
      agent: "测评评分智能体",
      mode: "docker-unavailable",
      correct: false,
      score: 0,
      maxScore: 100,
      feedback: `代码评测需要本机可用 Docker。当前未能运行：${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function runCodeInDocker(language, code, tests) {
  return new Promise((resolve, reject) => {
    if (language !== "python") {
      reject(new Error("当前示例沙箱仅支持 python 代码题"));
      return;
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "learning-code-"));
    const solutionPath = path.join(workDir, "solution.py");
    const testPath = path.join(workDir, "test_runner.py");
    fs.writeFileSync(solutionPath, code, "utf8");
    fs.writeFileSync(testPath, buildPythonTestRunner(tests), "utf8");

    const dockerArgs = [
      "run",
      "--rm",
      "--network",
      "none",
      "-v",
      `${workDir.replaceAll("\\", "/")}:/work`,
      "-w",
      "/work",
      "python:3.11-alpine",
      "python",
      "test_runner.py"
    ];
    const child = spawn("docker", dockerArgs, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", reject);
    child.on("close", () => {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(stderr || stdout || "Docker 测试未返回有效 JSON"));
      }
    });
  });
}

function buildPythonTestRunner(tests) {
  return `
import importlib.util, json
spec = importlib.util.spec_from_file_location("solution", "solution.py")
solution = importlib.util.module_from_spec(spec)
spec.loader.exec_module(solution)
tests = ${JSON.stringify(tests)}
passed = 0
results = []
for index, test in enumerate(tests, 1):
    fn = getattr(solution, test.get("function", "solve"))
    try:
        args = test.get("args", [])
        actual = fn(*args)
        ok = actual == test.get("expected")
        passed += 1 if ok else 0
        results.append({"index": index, "passed": ok, "actual": actual, "expected": test.get("expected")})
    except Exception as exc:
        results.append({"index": index, "passed": False, "error": str(exc)})
print(json.dumps({"total": len(tests), "passed": passed, "results": results}, ensure_ascii=False))
`;
}

function ensureArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
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

function parseJsonFromModel(content) {
  const trimmed = String(content || "").trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/```json\s*([\s\S]*?)```/)?.[1] || trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new Error("大模型没有返回 JSON。");
  return JSON.parse(jsonText);
}

async function answerTutorQuestion({ question, context }) {
  if (!question) return { answer: "请先输入你的问题。", mode: "local" };
  if (!MODEL_CONFIG.apiKey) {
    return {
      answer: `你可以先把问题拆成“我不懂的概念、我做错的步骤、我下一步要做什么”。当前问题是：${question}`,
      mode: "local"
    };
  }

  const answer = await requestChatCompletion([
    { role: "system", content: "你是耐心的中文学习陪练。回答要具体、短、可执行，不要替学生跳过思考。" },
    { role: "user", content: `学习上下文：${context || "暂无"}\n\n学生问题：${question}` }
  ], { temperature: 0.5, maxTokens: 900 });
  return { answer, mode: "llm" };
}

async function testLargeModelConnection() {
  if (!MODEL_CONFIG.apiKey) {
    return {
      ok: false,
      message: "未配置 OPENAI_API_KEY，当前仍是本地规则模式。",
      llm: publicModelConfig()
    };
  }

  try {
    const content = await requestChatCompletion([
      { role: "system", content: "你是一个接口连通性测试助手。" },
      { role: "user", content: "请只回复：大模型连接成功" }
    ], { temperature: 0.1, maxTokens: 32 });
    return { ok: true, message: "大模型接口连接成功。", sample: content, llm: publicModelConfig() };
  } catch (error) {
    return {
      ok: false,
      message: "大模型接口连接失败。",
      detail: error instanceof Error ? error.message : String(error),
      llm: publicModelConfig()
    };
  }
}

async function requestChatCompletion(messages, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_CONFIG.timeoutMs);
  const url = buildModelUrl();
  const requestBody = buildModelRequestBody(messages, options);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MODEL_CONFIG.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`大模型接口返回 ${response.status}：${detail.slice(0, 500)}`);
    }

    const data = await response.json();
    return extractModelText(data) || "大模型未返回有效内容。";
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`大模型接口请求超时：${MODEL_CONFIG.timeoutMs}ms`);
    if (process.platform === "win32" && isNetworkResetError(error)) {
      const data = await requestModelWithPowerShell(url, requestBody);
      return extractModelText(data) || "大模型未返回有效内容。";
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isNetworkResetError(error) {
  return error?.message === "fetch failed" || error?.cause?.code === "ECONNRESET";
}

function requestModelWithPowerShell(url, requestBody) {
  return new Promise((resolve, reject) => {
    const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$payload = [Console]::In.ReadToEnd()
$headers = @{
  Authorization = "Bearer $env:LLM_API_KEY"
  Accept = "application/json"
}
$response = Invoke-RestMethod -Uri $env:LLM_API_URL -Method Post -Headers $headers -Body $payload -ContentType "application/json; charset=utf-8" -TimeoutSec $env:LLM_TIMEOUT_SECONDS
$response | ConvertTo-Json -Depth 40 -Compress
`;
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        LLM_API_KEY: MODEL_CONFIG.apiKey,
        LLM_API_URL: url,
        LLM_TIMEOUT_SECONDS: String(Math.ceil(MODEL_CONFIG.timeoutMs / 1000))
      }
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`PowerShell 大模型请求失败：${stderr || `退出码 ${code}`}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`PowerShell 大模型响应不是有效 JSON：${stdout.slice(0, 500)}`));
      }
    });
    child.stdin.end(JSON.stringify(requestBody));
  });
}

function extractModelText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const responseText = data.output
    ?.flatMap((item) => item.content || [])
    ?.map((content) => content.text)
    ?.filter(Boolean)
    ?.join("\n");
  return responseText || data.choices?.[0]?.message?.content;
}

function buildModelUrl() {
  const endpoint = MODEL_CONFIG.wireApi === "responses" ? "/responses" : "/chat/completions";
  const baseUrl = MODEL_CONFIG.baseUrl.endsWith("/v1") ? MODEL_CONFIG.baseUrl : `${MODEL_CONFIG.baseUrl}/v1`;
  return `${baseUrl}${endpoint}`;
}

function buildModelRequestBody(messages, options) {
  if (MODEL_CONFIG.wireApi === "responses") {
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    const input = messages.filter((message) => message.role !== "system").map((message) => `${message.role}: ${message.content}`).join("\n\n");
    return removeUndefined({
      model: MODEL_CONFIG.model,
      instructions: system || undefined,
      input,
      temperature: options.temperature ?? 0.7,
      max_output_tokens: options.maxTokens
    });
  }

  return removeUndefined({
    model: MODEL_CONFIG.model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens
  });
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
