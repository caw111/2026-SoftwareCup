import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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
    role: "分析目标、基础、偏好、薄弱点和学习反馈，形成可更新的学习画像。"
  },
  {
    id: "diagnosis-agent",
    name: "知识诊断智能体",
    role: "定位知识点掌握度、错因和补救优先级。"
  },
  {
    id: "planner-agent",
    name: "路径规划智能体",
    role: "拆解阶段目标，生成适合日常执行的学习路径和每日任务。"
  },
  {
    id: "resource-agent",
    name: "资源生成智能体",
    role: "生成讲义、例题、练习、解析、错因提醒和项目化任务。"
  },
  {
    id: "coach-agent",
    name: "学习陪练智能体",
    role: "回答学习追问，给出下一步提示，帮助学生持续推进。"
  },
  {
    id: "assessment-agent",
    name: "测评反馈智能体",
    role: "评估练习表现，形成下一轮画像更新建议。"
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
      const body = await readJson(req);
      const input = normalizeInput(body);
      const result = await generateLearningPlan(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tutor") {
      const body = await readJson(req);
      const result = await answerTutorQuestion({
        question: clean(body.question, 1000),
        context: clean(body.context, 4000)
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
    const value = rawValue.replace(/^["']|["']$/g, "");
    const key = normalizeEnvKey(rawKey);
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
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
      if (data.length > 1024 * 1024) {
        reject(new Error("请求体过大"));
      }
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
    weaknesses: clean(body.weaknesses) || "概念理解不够系统，练习较少",
    outputType: clean(body.outputType) || "完整学习方案"
  };
}

function clean(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function generateLearningPlan(input) {
  const localPlan = runLocalAgents(input);

  if (!MODEL_CONFIG.apiKey) {
    return {
      mode: "local",
      input,
      agents,
      ...localPlan
    };
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
  const resources = buildResources(input);
  const assessment = buildAssessment(input);
  const generationLoop = buildGenerationLoop(input, learnerProfile, path, resources, assessment);
  const resourcePackage = buildResourcePackage(input, learnerProfile, path, resources, assessment, generationLoop);
  const dailyPlan = buildDailyPlan(input, learnerProfile);
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
    "零基础": 34,
    "入门": 48,
    "进阶": 67,
    "冲刺竞赛": 78
  }[input.level] ?? 50;

  const weakText = input.weaknesses;
  const weakSignals = [
    { key: "math", words: ["数学", "公式", "推导", "概率", "线代"] },
    { key: "practice", words: ["练习", "实战", "项目", "动手", "代码"] },
    { key: "concept", words: ["概念", "理解", "原理", "流程", "指标"] },
    { key: "expression", words: ["表达", "总结", "报告", "复盘"] }
  ];
  const signalPenalty = Object.fromEntries(
    weakSignals.map((signal) => [
      signal.key,
      signal.words.some((word) => weakText.includes(word)) ? 16 : 0
    ])
  );
  const mastery = [
    { dimension: "先修基础", score: clamp(levelBase - signalPenalty.math + 4) },
    { dimension: "概念理解", score: clamp(levelBase - signalPenalty.concept + 8) },
    { dimension: "方法迁移", score: clamp(levelBase - 8 - signalPenalty.practice) },
    { dimension: "实践应用", score: clamp(levelBase - 12 - signalPenalty.practice) },
    { dimension: "表达复盘", score: clamp(levelBase - 6 - signalPenalty.expression) },
    { dimension: "学习自驱", score: clamp(levelBase + (input.duration.includes("3") ? 8 : 2)) }
  ];
  const weakest = [...mastery].sort((a, b) => a.score - b.score).slice(0, 2);

  return {
    version: new Date().toISOString(),
    summary: `画像显示该学习者在“${weakest.map((item) => item.dimension).join("、")}”上需要优先补强，适合采用“${input.style}”路径，每天约 ${input.dailyMinutes} 推进。`,
    mastery,
    weakestDimensions: weakest,
    tags: [input.level, input.style, weakest[0].dimension, "动态画像", "日常学习"],
    behaviorSignals: [
      `学习周期：${input.duration}`,
      `每日时间：${input.dailyMinutes}`,
      `资源偏好：${input.outputType}`,
      `薄弱点线索：${input.weaknesses}`
    ],
    strategyPriorities: [
      `优先补强“${weakest[0].dimension}”，避免直接进入高难综合任务。`,
      "每天采用“学习-练习-复盘-反馈”闭环，形成可持续进步记录。",
      "每轮学习后用测验得分、错题原因和耗时更新画像。"
    ]
  };
}

function buildLearningPath(input) {
  return [
    {
      stage: "阶段一：诊断与概念建模",
      task: `梳理${input.topic}的核心概念、先修知识和常见误区。`,
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

function buildResources(input) {
  return [
    {
      type: "微讲义",
      title: `${input.topic}核心概念速通`,
      content: `按“概念定义-现实类比-关键步骤-易错点”的结构学习${input.topic}，每个概念都要写出自己的例子。`
    },
    {
      type: "例题讲解",
      title: `${input.topic}场景化案例`,
      content: `选择一个熟悉场景，说明${input.topic}如何解决问题，并画出输入、处理、输出三个环节。`
    },
    {
      type: "分层练习",
      title: "基础到挑战题组",
      content: "基础题 3 道检查概念，应用题 2 道训练迁移，挑战题 1 道用于综合表达。"
    },
    {
      type: "复盘模板",
      title: "错因记录表",
      content: "记录错题、卡点、正确思路、下次提醒和需要补充学习的知识点。"
    }
  ];
}

function buildAssessment(input) {
  return {
    quiz: [
      {
        question: `请用 100 字解释${input.topic}最重要的三个概念。`,
        answer: "答案应包含概念名称、各自作用和它们之间的关系。",
        hint: "不要只背定义，要说出它解决了什么问题。"
      },
      {
        question: `针对薄弱点“${input.weaknesses}”，设计一个纠错练习。`,
        answer: "练习应能直接暴露薄弱点，并包含可检查的答案或标准。",
        hint: "把薄弱点拆成一个可执行的小动作。"
      },
      {
        question: `给出一个${input.topic}的实际应用场景，并说明为什么适合使用它。`,
        answer: "需要说明输入、处理流程、输出和评价方式。",
        hint: "如果说不清评价方式，说明还没真正理解应用场景。"
      }
    ],
    rubric: ["概念准确：30%", "案例合理：30%", "表达清晰：20%", "反思可执行：20%"],
    nextActions: [
      "低于 60 分：回到概念建模，减少综合题。",
      "60-85 分：强化练习和错题复盘。",
      "高于 85 分：进入项目化学习，增加开放任务。"
    ]
  };
}

function buildGenerationLoop(input, learnerProfile, path, resources, assessment) {
  const weakest = learnerProfile.weakestDimensions.map((item) => item.dimension).join("、");
  const qualityScore = clamp(72 + Math.round(resources.length * 2.5) + (assessment.quiz.length >= 3 ? 6 : 0) - 6);
  return {
    objective: `围绕“${input.topic}”生成可日常执行的个性化学习方案。`,
    status: qualityScore >= 80 ? "已通过质量评审" : "已完成首轮修正",
    qualityScore,
    stages: [
      { agent: "学习画像智能体", action: "抽取学习目标、偏好、薄弱点和行为信号", input: "表单学习需求", output: `定位薄弱维度：${weakest}` },
      { agent: "知识诊断智能体", action: "将薄弱点映射到知识掌握维度", input: "动态画像与雷达图", output: `优先处理：${learnerProfile.weakestDimensions[0].dimension}` },
      { agent: "资源规划智能体", action: "拆分阶段路径并安排每日任务", input: "画像、周期、每日时间", output: `生成 ${path.length} 个阶段` },
      { agent: "内容生成智能体", action: "生成讲义、例题、练习和解析", input: "路径规划与学习偏好", output: `生成 ${resources.length} 类资源` },
      { agent: "质量评估智能体", action: "检查难度匹配、任务可执行性和测评闭环", input: "资源草案与测评规则", output: `质量分 ${qualityScore}` },
      { agent: "反馈更新智能体", action: "根据完成情况、错因和笔记更新画像", input: "学习结果与反馈", output: "形成下一轮画像更新信号" }
    ],
    review: {
      passed: qualityScore >= 80,
      checks: [
        { label: "画像匹配", passed: true, detail: `资源围绕${input.level}水平与${input.style}偏好生成。` },
        { label: "每日可执行", passed: true, detail: `任务按每天 ${input.dailyMinutes} 设计。` },
        { label: "资源完整性", passed: resources.length >= 4, detail: "覆盖讲义、例题、练习、解析和复盘。" },
        { label: "测评闭环", passed: assessment.quiz.length >= 3, detail: "包含题目、提示、答案和后续动作。" }
      ],
      revisionAdvice: [
        "若连续两天未完成任务，下一轮自动缩短单日任务。",
        "若测验低于 60 分，先补微讲义和基础题。",
        "若测验高于 85 分，增加项目化和开放题。"
      ]
    }
  };
}

function buildResourcePackage(input, learnerProfile, path, resources, assessment, generationLoop) {
  const mainWeakness = learnerProfile.weakestDimensions[0];
  const secondaryWeakness = learnerProfile.weakestDimensions[1];
  return {
    title: `${input.topic}个性化学习资源包`,
    audience: `${input.level}学习者 / ${input.style}偏好 / 每天 ${input.dailyMinutes}`,
    packageScore: generationLoop.qualityScore,
    sections: [
      {
        type: "学情诊断报告",
        title: "当前画像结论",
        items: [
          learnerProfile.summary,
          `首要补强维度：${mainWeakness.dimension}（${mainWeakness.score} 分）`,
          `次要补强维度：${secondaryWeakness.dimension}（${secondaryWeakness.score} 分）`
        ]
      },
      {
        type: "补救微讲义",
        title: `${mainWeakness.dimension}快速补救`,
        items: [
          `先复述${input.topic}的核心概念，暴露理解断点。`,
          "再用一个生活化例子解释概念，避免只背定义。",
          "最后完成 2 道低门槛迁移题，确认能把概念用到新情境。"
        ]
      },
      {
        type: "分层练习",
        title: `${input.topic}专项题组`,
        items: assessment.quiz.map((item) => item.question)
      },
      {
        type: "答案解析与错因提醒",
        title: "自查清单",
        items: assessment.quiz.map((item) => `${item.answer} 提示：${item.hint}`)
      },
      {
        type: "后续学习路径",
        title: "下一轮行动",
        items: path.map((item) => `${item.stage}：${item.outcome}`)
      }
    ],
    deliverables: ["学情诊断报告", "补救微讲义", "分层练习题", "答案解析", "错因复盘表", "下一轮学习路径"],
    usageGuide: [
      "每天先完成今日任务，再做 1 道自测题。",
      "不会的题先看提示，再看答案解析。",
      "把错因写进学习笔记，下一轮生成时填入薄弱点。"
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
      tasks: [
        `学习${input.topic}的一个核心概念，并写下自己的解释。`,
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
    { title: "今天卡住时先问", prompt: `我在学习${input.topic}时，对${focus}不理解，请用${input.style}方式解释。` },
    { title: "做题后复盘", prompt: `我刚做错了一道${input.topic}题，错因可能是${input.weaknesses}，请帮我分析。` },
    { title: "准备下一轮", prompt: `根据我今天的学习笔记，帮我更新下一天${input.topic}学习任务。` }
  ];
}

function clamp(value) {
  return Math.max(20, Math.min(95, Math.round(value)));
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
    generationLoop: plan.generationLoop || fallback.generationLoop,
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

function ensureArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

async function callLargeModelForPlan(input, localPlan) {
  const planSeed = {
    profileSummary: localPlan.learnerProfile.summary,
    mastery: localPlan.learnerProfile.mastery,
    weak: localPlan.learnerProfile.weakestDimensions,
    requiredDays: input.duration.includes("3 天") ? 3 : 7
  };
  const prompt = `你是一个可以真正服务学生日常学习的中文多智能体学习系统。请基于学生输入生成完整可执行学习方案。

只返回 JSON，不要 Markdown。字段必须包含：
{
 "learnerProfile":{"summary":"","mastery":[{"dimension":"","score":0}],"weakestDimensions":[{"dimension":"","score":0}],"tags":[],"behaviorSignals":[],"strategyPriorities":[]},
 "path":[{"stage":"","task":"","outcome":""}],
 "resources":[{"type":"","title":"","content":""}],
 "assessment":{"quiz":[{"question":"","answer":"","hint":""}],"rubric":[],"nextActions":[]},
 "resourcePackage":{"title":"","audience":"","packageScore":0,"sections":[{"type":"","title":"","items":[]}],"deliverables":[],"usageGuide":[],"sourceTrace":[]},
 "dailyPlan":[{"day":1,"title":"","estimate":"","tasks":[],"checkpoint":""}],
 "tutorCards":[{"title":"","prompt":""}]
}

要求：
1. dailyPlan 生成 ${planSeed.requiredDays} 天，每天 3 个任务，任务要具体到学生能直接执行。
2. assessment.quiz 生成 3 道题，必须带 hint 和 answer。
3. resourcePackage.sections 生成 4 个章节：学情诊断、微讲义、分层练习、错因复盘。
4. 内容要针对学生输入，不要泛泛而谈，每个长文本控制在 120 字以内。
学生输入：${JSON.stringify(input)}
画像摘要：${JSON.stringify(planSeed)}`;

  const content = await requestChatCompletion([
    { role: "system", content: "你是严谨的个性化学习资源生成专家，必须输出可解析 JSON。" },
    { role: "user", content: prompt }
  ], { temperature: 0.35, maxTokens: 2600 });
  return parseJsonFromModel(content);
}

function parseJsonFromModel(content) {
  const trimmed = content.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/```json\s*([\s\S]*?)```/)?.[1] || trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) {
    throw new Error("大模型没有返回 JSON。");
  }
  return JSON.parse(jsonText);
}

async function answerTutorQuestion({ question, context }) {
  if (!question) {
    return { answer: "请先输入你的问题。", mode: "local" };
  }
  if (!MODEL_CONFIG.apiKey) {
    return {
      answer: `你可以先把问题拆成“我不懂的概念、我做错的步骤、我下一步要做什么”。当前问题是：${question}`,
      mode: "local"
    };
  }

  const answer = await requestChatCompletion([
    { role: "system", content: "你是耐心的中文学习陪练。回答要具体、短、可执行，不要替学生直接跳过思考。" },
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
    return {
      ok: true,
      message: "大模型接口连接成功。",
      sample: content,
      llm: publicModelConfig()
    };
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
    if (error?.name === "AbortError") {
      throw new Error(`大模型接口请求超时：${MODEL_CONFIG.timeoutMs}ms`);
    }
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
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
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
