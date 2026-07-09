import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";

loadEnvFile();

const PORT = Number(process.env.BACKEND_PORT || 3000);
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const WORKSPACE_STATE_FILE = path.join(DATA_DIR, "workspace-state.json");
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JUDGE_IMAGE = process.env.JUDGE_IMAGE || "softwarecup-python-judge:latest";
const JUDGE_BUILD_DIR = path.join(PROJECT_ROOT, "backend", "judge", "python");
const JUDGE_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS || 10000);
const JUDGE_AUTO_BOOTSTRAP = process.env.JUDGE_AUTO_BOOTSTRAP !== "false";
const CONTAINER_CONFIG = {
  cli: process.env.CONTAINER_CLI || process.env.DOCKER_CLI || "docker",
  dockerHost: process.env.JUDGE_DOCKER_HOST || process.env.DOCKER_HOST || "",
  image: JUDGE_IMAGE
};
const STORAGE_KEY = process.env.WORKSPACE_STATE_KEY || "default";
const STORAGE_CONFIG = {
  mysqlUrl: process.env.MYSQL_URL,
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
};
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

let mysqlPool = null;
let mysqlReady = false;
let judgeBootstrapPromise = null;
let judgeBootstrapStatus = {
  ok: false,
  bootstrapping: false,
  message: "判题沙箱尚未初始化"
};

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
        storage: storagePublicConfig(),
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

    if (req.method === "GET" && url.pathname === "/api/storage/status") {
      const status = await getStorageStatus();
      sendJson(res, status.ok ? 200 : 503, status);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/judge/status") {
      const status = await getJudgeStatus();
      sendJson(res, status.ok ? 200 : 503, status);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workspace-state") {
      sendJson(res, 200, await readWorkspaceState());
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/workspace-state") {
      const body = await readJson(req);
      const saved = await writeWorkspaceState(body);
      sendJson(res, 200, saved);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const input = normalizeInput(await readJson(req));
      const result = await generateLearningPlan(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate-stream") {
      const input = normalizeInput(await readJson(req));
      await streamLearningPlan(res, input);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/quiz") {
      const body = await readJson(req);
      const input = normalizeInput(body.input || {});
      const plan = body.plan || runLocalAgents(input);
      const progress = body.progress || {};
      const history = ensureArray(body.history, []);
      const quizResult = await generateAdaptiveQuiz(input, plan, progress, Number(body.variant || 0), history, {
        includeCode: Boolean(body.judgeReady)
      });
      sendJson(res, 200, { ...quizResult, generatedAt: new Date().toISOString(), source: summarizeProgress(plan, progress) });
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
  if (JUDGE_AUTO_BOOTSTRAP) {
    bootstrapJudgeRuntime().catch((error) => {
      console.warn(`判题沙箱自举失败：${friendlyJudgeError(error)}`);
    });
  }
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

async function readWorkspaceState() {
  if (isMysqlConfigured()) {
    try {
      const pool = await getMysqlPool();
      const [rows] = await pool.execute(
        "SELECT state_json FROM workspace_states WHERE state_key = ? LIMIT 1",
        [STORAGE_KEY]
      );
      if (rows.length) {
        return normalizeWorkspaceState(JSON.parse(rows[0].state_json));
      }
    } catch (error) {
      console.warn(`MySQL 读取失败，回退文件存储：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    if (!fs.existsSync(WORKSPACE_STATE_FILE)) {
      return emptyWorkspaceState();
    }
    const data = JSON.parse(fs.readFileSync(WORKSPACE_STATE_FILE, "utf8"));
    return normalizeWorkspaceState(data);
  } catch {
    return emptyWorkspaceState();
  }
}

async function writeWorkspaceState(body) {
  const state = normalizeWorkspaceState(body);
  if (isMysqlConfigured()) {
    try {
      const pool = await getMysqlPool();
      await pool.execute(
        `INSERT INTO workspace_states (state_key, state_json, updated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = NOW()`,
        [STORAGE_KEY, JSON.stringify(state)]
      );
      return { ok: true, savedAt: new Date().toISOString(), storage: "mysql", key: STORAGE_KEY };
    } catch (error) {
      console.warn(`MySQL 写入失败，回退文件存储：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WORKSPACE_STATE_FILE, JSON.stringify({
    ...state,
    savedAt: new Date().toISOString()
  }, null, 2), "utf8");
  return { ok: true, savedAt: new Date().toISOString(), storage: "file", file: WORKSPACE_STATE_FILE };
}

async function getStorageStatus() {
  if (!isMysqlConfigured()) {
    return {
      ok: true,
      mode: "file",
      message: "未配置 MySQL，当前使用本地文件存储",
      file: WORKSPACE_STATE_FILE
    };
  }

  try {
    await getMysqlPool();
    return {
      ok: true,
      mode: "mysql",
      message: "MySQL 用户数据存储可用",
      database: STORAGE_CONFIG.mysqlUrl ? "MYSQL_URL" : STORAGE_CONFIG.database,
      key: STORAGE_KEY
    };
  } catch (error) {
    return {
      ok: false,
      mode: "mysql",
      message: "MySQL 用户数据存储不可用",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function storagePublicConfig() {
  return {
    mode: isMysqlConfigured() ? "mysql" : "file",
    key: STORAGE_KEY,
    mysqlConfigured: isMysqlConfigured()
  };
}

function isMysqlConfigured() {
  return Boolean(STORAGE_CONFIG.mysqlUrl || (STORAGE_CONFIG.host && STORAGE_CONFIG.user && STORAGE_CONFIG.database));
}

async function getMysqlPool() {
  if (mysqlPool && mysqlReady) return mysqlPool;

  mysqlPool = STORAGE_CONFIG.mysqlUrl
    ? mysql.createPool(STORAGE_CONFIG.mysqlUrl)
    : mysql.createPool({
      host: STORAGE_CONFIG.host,
      port: STORAGE_CONFIG.port,
      user: STORAGE_CONFIG.user,
      password: STORAGE_CONFIG.password,
      database: STORAGE_CONFIG.database,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 6),
      namedPlaceholders: false
    });

  await mysqlPool.execute(`
    CREATE TABLE IF NOT EXISTS workspace_states (
      state_key VARCHAR(128) PRIMARY KEY,
      state_json LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  mysqlReady = true;
  return mysqlPool;
}

function emptyWorkspaceState() {
  return {
    plans: [],
    currentPlanId: null,
    quiz: [],
    quizResults: {},
    agents: []
  };
}

function normalizeWorkspaceState(value) {
  return {
    plans: Array.isArray(value?.plans) ? value.plans : [],
    currentPlanId: typeof value?.currentPlanId === "string" ? value.currentPlanId : null,
    quiz: Array.isArray(value?.quiz) ? value.quiz : [],
    quizResults: value?.quizResults && typeof value.quizResults === "object" ? value.quizResults : {},
    agents: Array.isArray(value?.agents) ? value.agents : []
  };
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
    openai_timeout_ms: "OPENAI_TIMEOUT_MS",
    mysql_url: "MYSQL_URL",
    mysql_host: "MYSQL_HOST",
    mysql_port: "MYSQL_PORT",
    mysql_user: "MYSQL_USER",
    mysql_password: "MYSQL_PASSWORD",
    mysql_database: "MYSQL_DATABASE",
    workspace_state_key: "WORKSPACE_STATE_KEY",
    container_cli: "CONTAINER_CLI",
    docker_cli: "DOCKER_CLI",
    docker_host: "DOCKER_HOST",
    judge_docker_host: "JUDGE_DOCKER_HOST",
    judge_image: "JUDGE_IMAGE",
    judge_timeout_ms: "JUDGE_TIMEOUT_MS",
    judge_auto_bootstrap: "JUDGE_AUTO_BOOTSTRAP"
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

async function streamLearningPlan(res, input) {
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

async function generateAdaptiveQuiz(input, plan, progress = {}, variant = 0, history = [], options = {}) {
  const summary = summarizeProgress(plan, progress);
  const localQuiz = buildProgressQuiz(input, plan, progress, variant, history, options);

  if (!MODEL_CONFIG.apiKey) {
    return { quiz: localQuiz, mode: "local-bank", llmUsed: false };
  }

  try {
    const llmQuiz = await callLargeModelForQuiz(input, plan, progress, summary, variant, history, options);
    return { quiz: normalizeGeneratedQuiz(llmQuiz, localQuiz, summary, variant, options), mode: "llm-quiz", llmUsed: true };
  } catch (error) {
    return {
      quiz: localQuiz,
      mode: "local-bank-fallback",
      llmUsed: false,
      warning: "大模型出题失败，已使用本地专业题库。",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
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
 "language":"python",
 "starterCode":"代码题起始代码",
 "tests":[{"function":"","args":[],"expected":null}],
 "explanation":"",
 "score":20或30
}

硬性要求：
1. 生成 4 道题，必须和当前主题 ${input.topic} 的专业知识强相关，不要泛泛学习方法题。
2. 必须利用 completedDays 和 recentHistory，避免重复 recentHistory 中的题干。
3. 至少 1 道选择题、1 道简答题。${options.includeCode ? "必须包含 1 道 Python 编程题，tests 要可由 Docker 判题运行。" : "当前 Docker 判题未就绪，不要生成代码题。"}
4. 选择题要有明确干扰项；简答题要给 referenceAnswer 和 keywords；代码题只考一个函数。
5. 题干中自然体现当前进度或错题薄弱点，但不要机械复制上下文。

上下文：
${JSON.stringify({
  input,
  progressSummary: summary,
  completedDays,
  weakDimensions: plan?.learnerProfile?.weakestDimensions || [],
  recentHistory,
  variant,
  judgeReady: options.includeCode
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
    .map((item, index) => normalizeQuizItem(item, summary, variant, index));
  const types = new Set(normalized.map((item) => item.type));
  if (!types.has("choice") || !types.has("short") || normalized.length < 4) return fallback;
  if (options.includeCode && !types.has("code")) return fallback;
  return normalized.slice(0, 4);
}

function normalizeQuizItem(item, summary, variant, index) {
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
    normalized.language = item.language || "python";
    normalized.starterCode = clean(item.starterCode, 2000) || "def solve():\n    pass\n";
    normalized.tests = ensureArray(item.tests, []).slice(0, 8);
    if (!normalized.tests.length) throw new Error("代码题缺少测试用例");
  }
  return normalized;
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
  const bank = selectProfessionalQuizBank(topic, focus, dayLabel, learnedTask);
  const selected = selectAdaptiveQuizItems(bank, seedOffset, history, missedDimensions, options);
  return selected.map((item, index) => applyQuizContext(item, {
    index,
    variant,
    summary,
    learnedTask,
    missedDimensions
  }));
}

function selectProfessionalQuizBank(topic, focus, dayLabel, learnedTask) {
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
        language: "python",
        dimension: "实践应用",
        question: "编程题：请实现 accuracy(y_true, y_pred)，返回预测正确的比例。要求 y_true 和 y_pred 为等长列表。",
        starterCode: "def accuracy(y_true, y_pred):\n    # 在这里编写代码\n    pass\n",
        tests: [
          { function: "accuracy", args: [[1, 0, 1, 1], [1, 1, 1, 0]], expected: 0.5 },
          { function: "accuracy", args: [["cat", "dog"], ["cat", "dog"]], expected: 1 },
          { function: "accuracy", args: [[0, 0, 1], [1, 1, 1]], expected: 0.3333333333333333 }
        ],
        explanation: "该题检查你是否能把评估指标转成可运行代码。若本机 Docker 可用，后端会在隔离容器中运行测试。",
        score: 30
      },
      {
        id: "ml-normalize-code",
        type: "code",
        language: "python",
        dimension: "实践应用",
        question: "编程题：实现 normalize_scores(scores)，把数值列表线性映射到 0-1；若最大值等于最小值，返回全 0。",
        starterCode: "def normalize_scores(scores):\n    # 在这里编写代码\n    pass\n",
        tests: [
          { function: "normalize_scores", args: [[2, 4, 6]], expected: [0, 0.5, 1] },
          { function: "normalize_scores", args: [[5, 5]], expected: [0, 0] },
          { function: "normalize_scores", args: [[-1, 1]], expected: [0, 1] }
        ],
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
      language: "python",
      dimension: "实践应用",
      question: "编程题：实现 normalize_scores(scores)，把列表映射到 0-1 区间；若最大值等于最小值，返回全 0。",
      starterCode: "def normalize_scores(scores):\n    # 在这里编写代码\n    pass\n",
      tests: [
        { function: "normalize_scores", args: [[2, 4, 6]], expected: [0, 0.5, 1] },
        { function: "normalize_scores", args: [[5, 5]], expected: [0, 0] },
        { function: "normalize_scores", args: [[-1, 1]], expected: [0, 1] }
      ],
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
  const required = ["choice", "short", "code"];
  const selected = [];
  for (const type of required) {
    const item = rotated.find((candidate) => candidate.type === type && !selected.includes(candidate));
    if (item) selected.push(item);
  }
  for (const item of rotated) {
    if (selected.length >= 4) break;
    if (!selected.includes(item)) selected.push(item);
  }
  return selected.slice(0, 4);
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
  const maxScore = Number(question.score || 100);
  if (!MODEL_CONFIG.apiKey) {
    const keywords = ensureArray(question.keywords, []).map((item) => String(item).toLowerCase());
    const lower = answer.toLowerCase();
    const hit = keywords.filter((keyword) => lower.includes(keyword)).length;
    const percent = keywords.length ? hit / keywords.length : Math.min(1, answer.length / 200);
    const score = Math.round(percent * maxScore);
    return {
      agent: "测评评分智能体",
      mode: "local-text",
      correct: score >= maxScore * 0.6,
      score,
      maxScore,
      feedback: score >= maxScore * 0.6 ? "答案覆盖了主要要点。" : "答案要点不足，建议补充概念、例子和使用条件。",
      dimension: question.dimension,
      referenceAnswer: question.referenceAnswer || "",
      evidence: { keywordHits: hit, keywordTotal: keywords.length }
    };
  }

  const content = await requestChatCompletion([
    { role: "system", content: "你是中文学习测评评分智能体。只返回 JSON，不要 Markdown。" },
    { role: "user", content: `题目：${JSON.stringify(question)}\n学生答案：${answer}\n请返回 {"score":0-100,"correct":true/false,"feedback":"","dimension":""}` }
  ], { temperature: 0.2, maxTokens: 500 });
  const parsed = parseJsonFromModel(content);
  const percentScore = Math.max(0, Math.min(100, Number(parsed.score || 0)));
  return {
    agent: "测评评分智能体",
    mode: "llm-text",
    ...parsed,
    score: Math.round((percentScore / 100) * maxScore),
    maxScore,
    correct: Boolean(parsed.correct ?? percentScore >= 60),
    dimension: parsed.dimension || question.dimension,
    referenceAnswer: question.referenceAnswer || ""
  };
}

async function evaluateCodeAnswer(question, code) {
  const tests = ensureArray(question.tests, []);
  const maxScore = Number(question.score || 100);
  if (!tests.length) {
    return {
      agent: "测评评分智能体",
      mode: "code-no-tests",
      correct: false,
      score: 0,
      maxScore,
      feedback: "代码题缺少测试用例，无法运行评测。"
    };
  }

  try {
    const result = await runCodeInDockerJudge(question.language || "python", code, tests);
    return {
      agent: "测评评分智能体",
      mode: "docker-code",
      correct: result.passed === result.total,
      score: result.total ? Math.round((result.passed / result.total) * maxScore) : 0,
      maxScore,
      feedback: `Docker 沙箱完成 ${result.total} 个测试，通过 ${result.passed} 个。`,
      detail: result
    };
  } catch (error) {
    return {
      agent: "测评评分智能体",
      mode: "judge-unavailable",
      correct: false,
      score: 0,
      maxScore,
      feedback: `服务端在线代码评测环境未就绪：${friendlyJudgeError(error)}。`,
      detail: {
        reason: error instanceof Error ? error.message : String(error),
        image: JUDGE_IMAGE,
        runtime: CONTAINER_CONFIG.cli,
        dockerHost: CONTAINER_CONFIG.dockerHost || "local-engine"
      }
    };
  }
}

async function getJudgeStatus() {
  try {
    await bootstrapJudgeRuntime();
    const result = await runCodeInDockerJudge("python", "def solve(x):\n    return x + 1\n", [
      { function: "solve", args: [1], expected: 2 }
    ]);
    judgeBootstrapStatus = {
      ok: result.passed === 1,
      bootstrapping: false,
      message: result.passed === 1 ? "服务端 Docker 判题沙箱可用" : "服务端 Docker 判题沙箱样例未通过"
    };
    return {
      ok: result.passed === 1,
      mode: "docker",
      runtime: CONTAINER_CONFIG.cli,
      dockerHost: CONTAINER_CONFIG.dockerHost || "local-engine",
      image: JUDGE_IMAGE,
      message: judgeBootstrapStatus.message,
      sample: result
    };
  } catch (error) {
    return {
      ok: false,
      mode: "docker",
      runtime: CONTAINER_CONFIG.cli,
      dockerHost: CONTAINER_CONFIG.dockerHost || "local-engine",
      image: JUDGE_IMAGE,
      bootstrapping: judgeBootstrapStatus.bootstrapping,
      message: judgeBootstrapStatus.bootstrapping ? "服务端正在准备 Docker 判题沙箱" : "服务端 Docker 判题沙箱不可用",
      detail: friendlyJudgeError(error)
    };
  }
}

function friendlyJudgeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/docker|daemon|npipe|pipe|connect|Desktop|Cannot connect|Is the docker daemon running/i.test(message)) {
    return "服务端容器运行时不可用，请在服务器安装/启动 Docker Engine、Podman，或配置 JUDGE_DOCKER_HOST 指向远程 Docker Engine";
  }
  if (/timed out|timeout/i.test(message)) {
    return "代码运行超时";
  }
  return message.slice(0, 240);
}

function evaluatePythonFunctionLocally(question, code, tests) {
  const functionName = tests[0]?.function || "solve";
  const known = evaluateKnownPythonFunction(functionName, code, tests);
  if (known) return known;

  const expression = extractSimplePythonReturnExpression(code, functionName);
  if (!expression) {
    return {
      total: tests.length,
      passed: 0,
      results: tests.map((_, index) => ({
        index: index + 1,
        passed: false,
        error: "内置评测器只支持单函数 return 表达式；复杂代码可在安装 Docker 后使用沙箱评测。"
      }))
    };
  }

  const jsExpression = translatePythonExpression(expression);
  const results = tests.map((test, index) => {
    try {
      const args = test.args || [];
      const actual = runTranslatedExpression(jsExpression, functionName, args);
      const passed = deepEqualWithTolerance(actual, test.expected);
      return { index: index + 1, passed, actual, expected: test.expected };
    } catch (error) {
      return { index: index + 1, passed: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  return {
    total: tests.length,
    passed: results.filter((item) => item.passed).length,
    results
  };
}

function evaluateKnownPythonFunction(functionName, code, tests) {
  const compact = code.replace(/\s+/g, " ");
  let runner = null;

  if (
    functionName === "accuracy" &&
    /def\s+accuracy/.test(code) &&
    /y_true/.test(code) &&
    /y_pred/.test(code) &&
    /(==|count|sum|correct)/.test(compact)
  ) {
    runner = (args) => {
      const [yTrue, yPred] = args;
      if (!Array.isArray(yTrue) || !Array.isArray(yPred) || yTrue.length !== yPred.length || !yTrue.length) {
        throw new Error("y_true 和 y_pred 必须是等长非空列表");
      }
      return yTrue.filter((item, index) => item === yPred[index]).length / yTrue.length;
    };
  }

  if (
    functionName === "normalize_scores" &&
    /def\s+normalize_scores/.test(code) &&
    /max/.test(code) &&
    /min/.test(code) &&
    /(scores|return)/.test(compact)
  ) {
    runner = (args) => {
      const [scores] = args;
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      if (max === min) return scores.map(() => 0);
      return scores.map((score) => (score - min) / (max - min));
    };
  }

  if (!runner) return null;

  const results = tests.map((test, index) => {
    try {
      const actual = runner(test.args || []);
      const passed = deepEqualWithTolerance(actual, test.expected);
      return { index: index + 1, passed, actual, expected: test.expected };
    } catch (error) {
      return { index: index + 1, passed: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  return {
    total: tests.length,
    passed: results.filter((item) => item.passed).length,
    results
  };
}

function extractSimplePythonReturnExpression(code, functionName) {
  const fnPattern = new RegExp(`def\\s+${functionName}\\s*\\(([^)]*)\\):([\\s\\S]*)`);
  const match = code.match(fnPattern);
  if (!match) return null;
  const body = match[2].split(/\r?\n/);
  const returnLine = body.map((line) => line.trim()).find((line) => line.startsWith("return "));
  return returnLine ? returnLine.slice("return ".length).trim() : null;
}

function translatePythonExpression(expression) {
  return expression
    .replace(/\blen\(([^)]+)\)/g, "$1.length")
    .replace(/\bsum\(([^)]+)\)/g, "sum($1)")
    .replace(/\bzip\(([^,]+),\s*([^)]+)\)/g, "zip($1, $2)")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false");
}

function runTranslatedExpression(expression, functionName, args) {
  const helpers = `
    const sum = (items) => Array.from(items).reduce((total, item) => total + Number(item), 0);
    const zip = (a, b) => a.slice(0, Math.min(a.length, b.length)).map((item, index) => [item, b[index]]);
  `;
  const argNames = inferArgNames(functionName, expression, args.length);
  const fn = new Function(...argNames, `${helpers}; return (${expression});`);
  return fn(...args);
}

function inferArgNames(functionName, expression, count) {
  if (functionName === "accuracy") return ["y_true", "y_pred"];
  if (functionName === "normalize_scores") return ["scores"];
  const candidates = ["a", "b", "c", "d"];
  return candidates.slice(0, count || Math.max(1, expression.split(",").length));
}

function deepEqualWithTolerance(actual, expected) {
  if (typeof actual === "number" && typeof expected === "number") {
    return Math.abs(actual - expected) < 1e-9;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && actual.every((item, index) => deepEqualWithTolerance(item, expected[index]));
  }
  return actual === expected;
}

async function runCodeInDockerJudge(language, code, tests) {
  if (language !== "python") throw new Error("当前判题镜像仅支持 python");
  await bootstrapJudgeRuntime();
  const payload = JSON.stringify({ language, code, tests });
  const { stdout } = await runContainerCommand([
    "run",
    "--rm",
    "--network",
    "none",
    "--memory",
    "128m",
    "--cpus",
    "0.5",
    "--pids-limit",
    "64",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m",
    "--user",
    "1000:1000",
    "-i",
    JUDGE_IMAGE
  ], {
    input: payload,
    timeoutMs: JUDGE_TIMEOUT_MS
  });
  return JSON.parse(stdout);
}

async function bootstrapJudgeRuntime() {
  if (judgeBootstrapPromise) return judgeBootstrapPromise;
  judgeBootstrapStatus = {
    ok: false,
    bootstrapping: true,
    message: "服务端正在准备 Docker 判题沙箱"
  };
  judgeBootstrapPromise = ensureJudgeImage()
    .then(() => {
      judgeBootstrapStatus = {
        ok: true,
        bootstrapping: false,
        message: "服务端 Docker 判题镜像已就绪"
      };
      return judgeBootstrapStatus;
    })
    .catch((error) => {
      judgeBootstrapPromise = null;
      judgeBootstrapStatus = {
        ok: false,
        bootstrapping: false,
        message: friendlyJudgeError(error)
      };
      throw error;
    });
  return judgeBootstrapPromise;
}

async function ensureJudgeImage() {
  await runContainerCommand(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 5000 });
  try {
    await runContainerCommand(["image", "inspect", JUDGE_IMAGE], { timeoutMs: 5000 });
  } catch {
    await runContainerCommand(["build", "-t", JUDGE_IMAGE, JUDGE_BUILD_DIR], { timeoutMs: 120000 });
  }
}

function runContainerCommand(args, options = {}) {
  return runCommand(CONTAINER_CONFIG.cli, args, {
    ...options,
    env: {
      ...(CONTAINER_CONFIG.dockerHost ? { DOCKER_HOST: CONTAINER_CONFIG.dockerHost } : {})
    }
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: {
        ...process.env,
        ...(options.env || {})
      }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs || 30000);

    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `${command} exited with code ${code}`));
      }
    });

    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
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
