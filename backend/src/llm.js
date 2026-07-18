import { spawn } from "node:child_process";

import { MODEL_CONFIG, publicModelConfig } from "./config.js";

export function parseJsonFromModel(content) {
  const trimmed = String(content || "").trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/```json\s*([\s\S]*?)```/)?.[1] || trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new Error("大模型没有返回 JSON。");
  return JSON.parse(jsonText);
}

export async function answerTutorQuestion({ question, context, mode = "hint", hintLevel = 1, history = [] }) {
  if (!question) return { answer: "请先输入你的问题。", mode: "local" };
  const tutorMode = normalizeTutorMode(mode);
  const level = Math.max(1, Math.min(4, Number(hintLevel || 1)));
  const recentHistory = Array.isArray(history) ? history.slice(-6) : [];
  if (!MODEL_CONFIG.apiKey) {
    return {
      answer: buildLocalTutorAnswer(question, tutorMode, level, recentHistory),
      mode: "local",
      tutorMode,
      hintLevel: level
    };
  }

  const answer = await requestChatCompletion([
    { role: "system", content: tutorSystemPrompt(tutorMode, level) },
    { role: "user", content: `学习上下文：${context || "暂无"}\n\n最近对话：${JSON.stringify(recentHistory)}\n\n学生问题：${question}` }
  ], { temperature: 0.5, maxTokens: 900 });
  return { answer, mode: "llm", tutorMode, hintLevel: level };
}

function normalizeTutorMode(mode) {
  return ["hint", "inquiry", "explain"].includes(mode) ? mode : "hint";
}

function tutorSystemPrompt(mode, hintLevel) {
  const hintPolicy = [
    "只给方向，不给关键步骤。",
    "给出关键条件和排除思路。",
    "给出半成品步骤，让学生补全。",
    "可以给完整讲解，但必须最后要求学生用自己的话复述。"
  ][Math.max(1, Math.min(4, hintLevel)) - 1];
  if (mode === "inquiry") {
    return `你是中文学习陪练，采用苏格拉底式追问。先判断学生卡点，再提出2-3个具体问题，不直接给最终答案。提示层级要求：${hintPolicy}`;
  }
  if (mode === "explain") {
    return `你是中文学习陪练，可以给出清晰讲解，但必须包含概念边界、一个例子和一个让学生自检的小问题。提示层级要求：${hintPolicy}`;
  }
  return `你是中文学习陪练。优先给分层提示，避免直接跳到最终答案。提示层级要求：${hintPolicy}`;
}

function buildLocalTutorAnswer(question, mode, hintLevel, history) {
  const memory = history.length ? `我会结合你刚才的 ${history.length} 轮追问继续推进。` : "我会先从当前问题建立上下文。";
  const ladder = {
    1: "提示 1：先判断它考查哪个知识点，暂时不要算最终答案。",
    2: "提示 2：写出适用条件，再排除一个明显不符合的选项或步骤。",
    3: "提示 3：我给你半成品路径：概念 -> 条件 -> 例子 -> 自检，你补中间判断。",
    4: "提示 4：可以看完整讲解，但看完要用自己的话复述一遍。"
  }[hintLevel] || "提示 1：先定位知识点。";
  if (mode === "inquiry") {
    return `${memory}${ladder} 你先回答三个问题：1. 卡住的是概念、步骤还是应用场景？2. 题目要求的输入、输出和约束分别是什么？3. 你已经尝试到哪一步？当前问题是：${question}`;
  }
  if (mode === "explain") {
    return `${memory}${ladder} 可以按“定义-边界-例子-自检”理解：先写核心概念，再说明什么时候适用，接着举例，最后做一道变式题。当前问题是：${question}`;
  }
  return `${memory}${ladder} 把问题拆成“我不懂的概念、我做错的步骤、我下一步要做什么”。先写出你认为最关键的一步，再回来对照。当前问题是：${question}`;
}

export async function testLargeModelConnection() {
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

export async function requestChatCompletion(messages, options = {}) {
  const timeoutMs = options.timeoutMs === 0
    ? 0
    : Number(options.timeoutMs || MODEL_CONFIG.timeoutMs);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const url = buildModelUrl();
  const requestBody = buildModelRequestBody(messages, options);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller?.signal,
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

    if (options.stream) {
      const streamContent = await response.text();
      return extractStreamingModelText(streamContent) || "大模型未返回有效内容。";
    }

    const data = await response.json();
    return extractModelText(data) || "大模型未返回有效内容。";
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`大模型接口请求超时：${timeoutMs}ms`);
    if (process.platform === "win32" && isNetworkResetError(error)) {
      const data = await requestModelWithPowerShell(url, requestBody, timeoutMs, Boolean(options.stream));
      if (options.stream && typeof data?.streamContent === "string") {
        return extractStreamingModelText(data.streamContent) || "大模型未返回有效内容。";
      }
      return extractModelText(data) || "大模型未返回有效内容。";
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isNetworkResetError(error) {
  return error?.message === "fetch failed" || error?.cause?.code === "ECONNRESET";
}

function requestModelWithPowerShell(url, requestBody, timeoutMs, stream) {
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
$requestParameters = @{
  Uri = $env:LLM_API_URL
  Method = 'Post'
  Headers = $headers
  Body = $payload
  ContentType = 'application/json; charset=utf-8'
}
if ([int]$env:LLM_TIMEOUT_SECONDS -gt 0) {
  $requestParameters.TimeoutSec = [int]$env:LLM_TIMEOUT_SECONDS
}
if ($env:LLM_STREAM -eq 'true') {
  $response = Invoke-WebRequest @requestParameters
  @{ streamContent = $response.Content } | ConvertTo-Json -Depth 5 -Compress
} else {
  $response = Invoke-RestMethod @requestParameters
  $response | ConvertTo-Json -Depth 40 -Compress
}
`;
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        LLM_API_KEY: MODEL_CONFIG.apiKey,
        LLM_API_URL: url,
        LLM_TIMEOUT_SECONDS: timeoutMs > 0 ? String(Math.ceil(timeoutMs / 1000)) : "0",
        LLM_STREAM: stream ? "true" : "false"
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

function extractStreamingModelText(content) {
  const raw = String(content || "").trim();
  if (!raw) return "";
  if (raw.startsWith("{")) {
    try {
      return extractModelText(JSON.parse(raw)) || "";
    } catch {
      // Continue with SSE parsing when an individual data event starts with JSON.
    }
  }

  let deltaText = "";
  let completedText = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload);
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        deltaText += event.delta;
        continue;
      }
      const chatDelta = event.choices?.[0]?.delta?.content;
      if (typeof chatDelta === "string") {
        deltaText += chatDelta;
        continue;
      }
      if (event.type === "content_block_delta" && typeof event.delta?.text === "string") {
        deltaText += event.delta.text;
        continue;
      }
      const finalText = extractModelText(event.response || event);
      if (finalText) completedText = finalText;
    } catch {
      // Ignore non-JSON SSE control lines from compatible providers.
    }
  }
  return deltaText || completedText;
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
      max_output_tokens: options.maxTokens,
      stream: options.stream || undefined
    });
  }

  return removeUndefined({
    model: MODEL_CONFIG.model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens,
    stream: options.stream || undefined
  });
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
