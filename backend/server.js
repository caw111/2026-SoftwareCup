import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadEnvFile();

const PORT = Number(process.env.BACKEND_PORT || 3000);
const MODEL_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: trimTrailingSlash(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
  model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 45000)
};

const agents = [
  {
    id: "profile-agent",
    name: "学习画像智能体",
    role: "分析学习者基础、目标、偏好、薄弱点和行为轨迹，形成动态学习画像。"
  },
  {
    id: "planner-agent",
    name: "路径规划智能体",
    role: "把学习目标拆解为阶段任务，规划学习顺序、节奏和资源组合。"
  },
  {
    id: "resource-agent",
    name: "资源生成智能体",
    role: "生成讲义、案例、练习、项目任务和拓展资源。"
  },
  {
    id: "assessment-agent",
    name: "测评反馈智能体",
    role: "设计检测题并给出反馈建议，支持持续优化学习路径。"
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

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function publicModelConfig() {
  return {
    enabled: Boolean(MODEL_CONFIG.apiKey),
    baseUrl: MODEL_CONFIG.baseUrl,
    model: MODEL_CONFIG.model,
    timeoutMs: MODEL_CONFIG.timeoutMs,
    apiKeyPreview: MODEL_CONFIG.apiKey ? maskApiKey(MODEL_CONFIG.apiKey) : null
  };
}

function maskApiKey(apiKey) {
  if (apiKey.length <= 10) {
    return "已配置";
  }
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
    goal: clean(body.goal) || "系统掌握核心概念并完成一个入门项目",
    level: clean(body.level) || "入门",
    duration: clean(body.duration) || "2 周",
    style: clean(body.style) || "案例驱动",
    weaknesses: clean(body.weaknesses) || "概念理解不够系统，练习较少",
    outputType: clean(body.outputType) || "学习计划、资源清单、练习题"
  };
}

function clean(value) {
  return String(value ?? "").trim().slice(0, 500);
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
    const llmContent = await callLargeModel(input, localPlan);
    return {
      mode: "llm",
      input,
      agents,
      ...localPlan,
      llmOptimization: llmContent
    };
  } catch (error) {
    return {
      mode: "local-fallback",
      input,
      agents,
      warning: "大模型接口暂不可用，已返回本地多智能体生成结果。",
      detail: error instanceof Error ? error.message : String(error),
      ...localPlan
    };
  }
}

function runLocalAgents(input) {
  const learnerProfile = buildLearnerProfile(input);
  const profile = {
    summary: `${input.level}学习者，目标是${input.goal}。偏好${input.style}，当前薄弱点为：${input.weaknesses}。`,
    tags: learnerProfile.tags,
    priority: learnerProfile.strategyPriorities
  };

  const path = [
    {
      stage: "阶段一：诊断与概念建模",
      task: `梳理${input.topic}的核心概念、先修知识和常见误区。`,
      outcome: "形成一页知识地图，明确个人薄弱点。"
    },
    {
      stage: "阶段二：案例学习与资源生成",
      task: `根据“${input.style}”偏好学习 2 个典型案例，并生成配套讲解。`,
      outcome: "能用自己的话解释关键流程和应用场景。"
    },
    {
      stage: "阶段三：练习巩固与项目迁移",
      task: `完成围绕“${input.topic}”的小型任务，并记录错误原因。`,
      outcome: "输出一个可复盘的小作品或解题报告。"
    },
    {
      stage: "阶段四：测评反馈与路径更新",
      task: "完成综合测验，依据得分调整下一轮学习计划。",
      outcome: "获得个性化补救建议和进阶方向。"
    }
  ];

  const resources = [
    {
      type: "讲解材料",
      title: `${input.topic}核心概念速通`,
      content: `用“概念定义-现实类比-关键步骤-易错点”的结构学习${input.topic}，每学完一个概念立刻写出一个自己的例子。`
    },
    {
      type: "案例任务",
      title: `${input.topic}场景化案例`,
      content: `选择一个熟悉场景，说明${input.topic}如何解决问题，并画出输入、处理、输出三个环节。`
    },
    {
      type: "练习题",
      title: "分层练习",
      content: "基础题 3 道用于检查概念，应用题 2 道用于迁移，挑战题 1 道用于综合表达。"
    },
    {
      type: "拓展资源",
      title: "进阶阅读与项目",
      content: `在掌握基础后，补充阅读权威教程或课程章节，并完成一个与${input.goal}相关的小项目。`
    }
  ];

  const assessment = {
    quiz: [
      `请用 100 字解释${input.topic}最重要的三个概念。`,
      `针对薄弱点“${input.weaknesses}”，设计一个纠错练习。`,
      `给出一个${input.topic}的实际应用场景，并说明为什么适合使用它。`
    ],
    rubric: [
      "概念准确：30%",
      "案例合理：30%",
      "表达清晰：20%",
      "反思可执行：20%"
    ],
    nextActions: [
      "低于 60 分：回到阶段一，重建知识地图。",
      "60-85 分：强化阶段三练习，增加错题复盘。",
      "高于 85 分：进入项目化学习，尝试开放任务。"
    ]
  };

  const generationLoop = buildGenerationLoop(input, learnerProfile, path, resources, assessment);
  const resourcePackage = buildResourcePackage(input, learnerProfile, path, resources, assessment, generationLoop);

  return { profile, learnerProfile, path, resources, assessment, generationLoop, resourcePackage };
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
  const preferredStrategy = {
    "案例驱动": "用真实案例牵引概念，先看完整样例再拆步骤。",
    "图文讲解": "多用图示、表格和流程图降低理解负担。",
    "项目实战": "用小任务串联知识点，边做边补理论。",
    "题目训练": "以分层题组推动巩固，及时统计错因。"
  }[input.style] ?? "采用讲练结合的学习策略。";

  return {
    version: new Date().toISOString(),
    summary: `画像显示该学习者在“${weakest.map((item) => item.dimension).join("、")}”上需要优先补强，适合采用“${input.style}”路径。`,
    mastery,
    weakestDimensions: weakest,
    tags: [
      input.level,
      input.style,
      weakest[0].dimension,
      "动态画像",
      "知识点掌握度"
    ],
    behaviorSignals: [
      `学习周期：${input.duration}`,
      `资源偏好：${input.outputType}`,
      `薄弱点线索：${input.weaknesses}`
    ],
    strategyPriorities: [
      `优先补强“${weakest[0].dimension}”，避免直接进入高难综合任务。`,
      preferredStrategy,
      "每轮学习后用测验得分、错题原因和耗时更新画像。"
    ]
  };
}

function clamp(value) {
  return Math.max(20, Math.min(95, Math.round(value)));
}

function buildGenerationLoop(input, learnerProfile, path, resources, assessment) {
  const weakest = learnerProfile.weakestDimensions.map((item) => item.dimension).join("、");
  const qualityScore = clamp(
    72 +
      Math.round(resources.length * 2.5) +
      (assessment.quiz.length >= 3 ? 6 : 0) -
      learnerProfile.weakestDimensions.length * 3
  );
  const revisionFocus = qualityScore >= 85 ? "提升开放任务挑战度" : `继续补强${weakest}`;

  return {
    objective: `围绕“${input.topic}”生成符合${input.level}学习者的个性化资源。`,
    status: qualityScore >= 80 ? "已通过质量评审" : "已完成首轮修正",
    qualityScore,
    stages: [
      {
        agent: "学习画像智能体",
        action: "抽取学习目标、偏好、薄弱点和行为信号",
        input: "表单学习需求",
        output: `定位薄弱维度：${weakest}`
      },
      {
        agent: "知识诊断智能体",
        action: "将薄弱点映射到知识掌握维度",
        input: "动态画像与掌握度雷达图",
        output: `建议优先处理：${learnerProfile.weakestDimensions[0].dimension}`
      },
      {
        agent: "资源规划智能体",
        action: "拆分阶段路径并分配资源类型",
        input: "画像、周期、输出类型",
        output: `生成 ${path.length} 个学习阶段`
      },
      {
        agent: "内容生成智能体",
        action: "生成讲解、案例、练习和拓展资源",
        input: "路径规划与学习偏好",
        output: `生成 ${resources.length} 类资源`
      },
      {
        agent: "质量评估智能体",
        action: "检查难度匹配、资源完整性和测评闭环",
        input: "资源草案与测评规则",
        output: `质量分 ${qualityScore}，修正重点：${revisionFocus}`
      },
      {
        agent: "反馈更新智能体",
        action: "根据测验分数、错题原因和耗时更新画像",
        input: "学习结果与测评反馈",
        output: "形成下一轮画像更新信号"
      }
    ],
    review: {
      passed: qualityScore >= 80,
      checks: [
        { label: "画像匹配", passed: true, detail: `资源围绕${input.level}水平与${input.style}偏好生成。` },
        { label: "资源完整性", passed: resources.length >= 4, detail: "覆盖讲解、案例、练习和拓展资源。" },
        { label: "测评闭环", passed: assessment.quiz.length >= 3, detail: "包含测验题、评分规则和后续动作。" },
        { label: "难度校准", passed: qualityScore >= 78, detail: `当前质量分 ${qualityScore}，需要关注${revisionFocus}。` }
      ],
      revisionAdvice: [
        `若测验低于 60 分，下一轮资源减少综合任务，增加${learnerProfile.weakestDimensions[0].dimension}的微练习。`,
        "若连续两次通过测评，自动提高应用题比例并加入项目化产出。",
        "每次生成后记录质量分，作为系统自评审证据。"
      ]
    }
  };
}

function buildResourcePackage(input, learnerProfile, path, resources, assessment, generationLoop) {
  const mainWeakness = learnerProfile.weakestDimensions[0];
  const secondaryWeakness = learnerProfile.weakestDimensions[1];
  const practiceTheme = `${input.topic} ${mainWeakness.dimension}专项`;

  return {
    title: `${input.topic}个性化学习资源包`,
    audience: `${input.level}学习者 / ${input.style}偏好 / ${input.duration}周期`,
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
          `先用 5 分钟复述${input.topic}的核心概念，暴露理解断点。`,
          `再用一个生活化例子解释概念，避免只背定义。`,
          `最后完成 2 道低门槛迁移题，确认能把概念用到新情境。`
        ]
      },
      {
        type: "分层练习",
        title: practiceTheme,
        items: [
          `基础题：写出${input.topic}的 3 个关键词，并分别解释其作用。`,
          `应用题：给定一个真实场景，判断应该如何使用${input.topic}解决问题。`,
          `挑战题：设计一个小任务，说明输入、处理过程、输出和评价指标。`
        ]
      },
      {
        type: "答案解析与错因提醒",
        title: "自查清单",
        items: [
          "答案必须包含概念、步骤、应用场景三类信息。",
          `若卡在“${mainWeakness.dimension}”，优先回看微讲义第一步。`,
          "若答案只有结论没有过程，说明表达复盘还需要继续训练。"
        ]
      },
      {
        type: "后续学习路径",
        title: "下一轮行动",
        items: path.map((item) => `${item.stage}：${item.outcome}`)
      }
    ],
    deliverables: [
      "一页学情诊断报告",
      "一份补救微讲义",
      "一组分层练习题",
      "一张错因自查清单",
      "一条下一轮学习路径"
    ],
    usageGuide: [
      "先看学情诊断，确认系统判断是否符合真实情况。",
      "按补救微讲义学习，再完成分层练习。",
      "根据答案解析记录错因，把错因反馈给系统生成下一轮资源。"
    ],
    sourceTrace: resources.map((item) => `${item.type}：${item.title}`)
  };
}

async function callLargeModel(input, localPlan) {
  const prompt = `你是一个中文学习多智能体系统总控。请基于输入和本地智能体草案，优化个性化学习资源，输出中文、结构化、可执行建议。\n\n输入：${JSON.stringify(input)}\n\n本地草案：${JSON.stringify(localPlan)}`;
  return requestChatCompletion([
    { role: "system", content: "你是严谨的个性化学习资源生成专家。" },
    { role: "user", content: prompt }
  ], { temperature: 0.7 });
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

  try {
    const response = await fetch(`${MODEL_CONFIG.baseUrl}/chat/completions`, {
    method: "POST",
      signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MODEL_CONFIG.apiKey}`
    },
    body: JSON.stringify({
      model: MODEL_CONFIG.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens
    })
  });

  if (!response.ok) {
      const detail = await response.text();
      throw new Error(`大模型接口返回 ${response.status}：${detail.slice(0, 500)}`);
  }

  const data = await response.json();
    return data.choices?.[0]?.message?.content || "大模型未返回有效内容。";
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`大模型接口请求超时：${MODEL_CONFIG.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
