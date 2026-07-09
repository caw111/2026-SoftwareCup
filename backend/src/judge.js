import { spawn } from "node:child_process";

import path from "node:path";

import { CONTAINER_CONFIG, JUDGE_BUILD_DIR, JUDGE_IMAGE, JUDGE_TIMEOUT_MS, MODEL_CONFIG } from "./config.js";

import { clean, ensureArray, normalizeCodeLanguage } from "./utils.js";

import { requestChatCompletion, parseJsonFromModel } from "./llm.js";

let judgeBootstrapPromise = null;
let judgeBootstrapStatus = {
  ok: false,
  bootstrapping: false,
  message: "判题沙箱尚未初始化"
};

export function getJudgeRuntimeStatus() {
  return { ...judgeBootstrapStatus };
}

export async function evaluateAnswer(body) {
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
    if (!judgeBootstrapStatus.ok) {
      throw new Error(judgeBootstrapStatus.message || "服务端容器判题沙箱未就绪");
    }
    const result = await runCodeInDockerJudge(question.language || "python", code, tests);
    const feedback = buildCodeFeedback("Docker 沙箱", result);
    return {
      agent: "测评评分智能体",
      mode: "docker-code",
      correct: result.passed === result.total,
      score: result.total ? Math.round((result.passed / result.total) * maxScore) : 0,
      maxScore,
      feedback,
      detail: result
    };
  } catch (error) {
    try {
      const result = await runCodeInLocalJudge(question.language || "python", code, tests);
      const feedback = buildCodeFeedback("服务端本地判题", result);
      return {
        agent: "测评评分智能体",
        mode: "local-runner-code",
        correct: result.passed === result.total,
        score: result.total ? Math.round((result.passed / result.total) * maxScore) : 0,
        maxScore,
        feedback,
        detail: result,
        sandboxFallback: friendlyJudgeError(error)
      };
    } catch (localError) {
      return {
        agent: "测评评分智能体",
        mode: "judge-unavailable",
        correct: false,
        score: 0,
        maxScore,
        feedback: `服务端在线代码评测环境未就绪：${friendlyJudgeError(localError)}。`,
        detail: {
          dockerReason: error instanceof Error ? error.message : String(error),
          localReason: localError instanceof Error ? localError.message : String(localError),
          image: JUDGE_IMAGE,
          runtime: CONTAINER_CONFIG.cli,
          dockerHost: CONTAINER_CONFIG.dockerHost || "local-engine"
        }
      };
    }
  }
}

function buildCodeFeedback(label, result) {
  const base = `${label}完成 ${result.total} 个测试，通过 ${result.passed} 个。`;
  const firstFailed = ensureArray(result.results, []).find((item) => !item.passed);
  if (!firstFailed) return base;
  return `${base} 首个失败用例：输入 ${stringifyCompact(firstFailed.input ?? firstFailed.args ?? [])}；正确输出 ${stringifyCompact(firstFailed.expected)}；你的输出 ${firstFailed.error ? `运行错误：${firstFailed.error}` : stringifyCompact(firstFailed.actual)}。`;
}

function stringifyCompact(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function getJudgeStatus() {
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
    try {
      const result = await runCodeInLocalJudge("python", "def solve(x):\n    return x + 1\n", [
        { function: "solve", args: [1], expected: 2 }
      ]);
      return {
        ok: result.passed === 1,
        mode: "local-runner",
        runtime: "server-process",
        message: result.passed === 1 ? "服务端本地判题可用" : "服务端本地判题样例未通过",
        dockerFallbackReason: friendlyJudgeError(error),
        sample: result
      };
    } catch (localError) {
      return {
        ok: false,
        mode: "unavailable",
        runtime: CONTAINER_CONFIG.cli,
        dockerHost: CONTAINER_CONFIG.dockerHost || "local-engine",
        image: JUDGE_IMAGE,
        bootstrapping: judgeBootstrapStatus.bootstrapping,
        message: "服务端代码判题不可用",
        detail: friendlyJudgeError(localError),
        dockerDetail: friendlyJudgeError(error)
      };
    }
  }
}

export function friendlyJudgeError(error) {
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
  const normalizedLanguage = normalizeCodeLanguage(language);
  await bootstrapJudgeRuntime();
  const payload = JSON.stringify({ language: normalizedLanguage, code, tests });
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

async function runCodeInLocalJudge(language, code, tests) {
  const payload = JSON.stringify({
    language: normalizeCodeLanguage(language),
    code,
    tests
  });
  const { stdout } = await runCommand("python", [
    path.join(JUDGE_BUILD_DIR, "run_python.py")
  ], {
    input: payload,
    timeoutMs: JUDGE_TIMEOUT_MS
  });
  return JSON.parse(stdout);
}

export async function bootstrapJudgeRuntime() {
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
