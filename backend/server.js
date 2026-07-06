import http from "node:http";

const PORT = Number(process.env.BACKEND_PORT || 3000);
const MODEL_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  model: process.env.OPENAI_MODEL || "gpt-4.1-mini"
};

const agents = [
  {
    id: "profile-agent",
    name: "学情分析智能体",
    role: "分析学习者基础、目标、偏好与薄弱点，形成个性化学习画像。"
  },
  {
    id: "planner-agent",
    name: "路径规划智能体",
    role: "把学习目标拆解为阶段任务，规划学习顺序与节奏。"
  },
  {
    id: "resource-agent",
    name: "资源生成智能体",
    role: "生成讲解、案例、练习、项目任务和拓展资料。"
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
        time: new Date().toISOString()
      });
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
    goal: clean(body.goal) || "系统掌握核心概念并能完成小项目",
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
  const profile = {
    summary: `${input.level}学习者，目标是${input.goal}。偏好${input.style}，当前薄弱点为：${input.weaknesses}。`,
    tags: [input.level, input.style, "个性化路径", "阶段反馈"],
    priority: [
      `围绕“${input.topic}”建立知识框架`,
      "用可执行任务替代泛泛阅读",
      "每个阶段加入自测与反馈"
    ]
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
      "概念准确：40%",
      "案例合理：30%",
      "表达清晰：20%",
      "反思可执行：10%"
    ],
    nextActions: [
      "低于 60 分：回到阶段一，重建知识地图。",
      "60-85 分：强化阶段三练习，增加错题复盘。",
      "高于 85 分：进入项目化学习，尝试开放任务。"
    ]
  };

  return { profile, path, resources, assessment };
}

async function callLargeModel(input, localPlan) {
  const prompt = `你是一个中文学习多智能体系统总控。请基于输入和本地智能体草案，优化个性化学习资源，输出中文、结构化、可执行建议。\n\n输入：${JSON.stringify(input)}\n\n本地草案：${JSON.stringify(localPlan)}`;
  const response = await fetch(`${MODEL_CONFIG.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MODEL_CONFIG.apiKey}`
    },
    body: JSON.stringify({
      model: MODEL_CONFIG.model,
      messages: [
        { role: "system", content: "你是严谨的个性化学习资源生成专家。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error(`大模型接口返回 ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "大模型未返回有效内容。";
}
