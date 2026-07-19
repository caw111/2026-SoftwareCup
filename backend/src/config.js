import fs from "node:fs";

import path from "node:path";

import { fileURLToPath } from "node:url";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(SOURCE_DIR, "..", "..");

function loadEnvFile() {
  const externalKeys = new Set(Object.keys(process.env));
  for (const filename of [".env", ".env.local"]) {
    const envPath = path.join(PROJECT_ROOT, filename);
    if (!fs.existsSync(envPath)) continue;
    const seenInFile = new Set();
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
      if (key && !externalKeys.has(key) && !seenInFile.has(key)) {
        process.env[key] = value;
        seenInFile.add(key);
      }
    }
  }
}

function normalizeEnvKey(key) {
  const map = {
    base_url: "OPENAI_BASE_URL",
    model: "OPENAI_MODEL",
    provider: "LLM_PROVIDER",
    model_provider: "LLM_PROVIDER",
    llm_provider: "LLM_PROVIDER",
    llm_api_key: "LLM_API_KEY",
    llm_base_url: "LLM_BASE_URL",
    llm_model: "LLM_MODEL",
    llm_wire_api: "LLM_WIRE_API",
    llm_timeout_ms: "LLM_TIMEOUT_MS",
    wire_api: "OPENAI_WIRE_API",
    api_key: "OPENAI_API_KEY",
    openai_api_key: "OPENAI_API_KEY",
    openai_base_url: "OPENAI_BASE_URL",
    openai_model: "OPENAI_MODEL",
    openai_wire_api: "OPENAI_WIRE_API",
    openai_timeout_ms: "OPENAI_TIMEOUT_MS",
    iflytek_api_password: "IFLYTEK_API_PASSWORD",
    iflytek_api_key: "IFLYTEK_API_KEY",
    iflytek_base_url: "IFLYTEK_BASE_URL",
    iflytek_model: "IFLYTEK_MODEL",
    iflytek_wire_api: "IFLYTEK_WIRE_API",
    spark_api_password: "SPARK_API_PASSWORD",
    spark_api_key: "SPARK_API_KEY",
    spark_base_url: "SPARK_BASE_URL",
    spark_model: "SPARK_MODEL",
    rag_full_context_max_chars: "RAG_FULL_CONTEXT_MAX_CHARS",
    mysql_url: "MYSQL_URL",
    mysql_host: "MYSQL_HOST",
    mysql_port: "MYSQL_PORT",
    mysql_user: "MYSQL_USER",
    mysql_password: "MYSQL_PASSWORD",
    mysql_database: "MYSQL_DATABASE",
    mysql_connection_limit: "MYSQL_CONNECTION_LIMIT",
    workspace_state_key: "WORKSPACE_STATE_KEY",
    frontend_origins: "FRONTEND_ORIGINS",
    session_cookie_name: "SESSION_COOKIE_NAME",
    session_ttl_days: "SESSION_TTL_DAYS",
    session_cookie_secure: "SESSION_COOKIE_SECURE",
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

loadEnvFile();

export const PORT = Number(process.env.BACKEND_PORT || 3000);

export const DATA_DIR = path.join(PROJECT_ROOT, "data");

export const WORKSPACE_STATE_FILE = path.join(DATA_DIR, "workspace-state.json");

export const JUDGE_IMAGE = process.env.JUDGE_IMAGE || "softwarecup-code-judge:latest";

export const JUDGE_BUILD_DIR = path.join(PROJECT_ROOT, "backend", "judge", "python");

export const JUDGE_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS || 10000);

export const JUDGE_AUTO_BOOTSTRAP = process.env.JUDGE_AUTO_BOOTSTRAP !== "false";

export const CONTAINER_CONFIG = {
  cli: process.env.CONTAINER_CLI || process.env.DOCKER_CLI || "docker",
  dockerHost: process.env.JUDGE_DOCKER_HOST || process.env.DOCKER_HOST || "",
  image: JUDGE_IMAGE
};

export const STORAGE_KEY = process.env.WORKSPACE_STATE_KEY || "default";

export const STORAGE_CONFIG = {
  mysqlUrl: process.env.MYSQL_URL,
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 6)
};

export const SESSION_CONFIG = {
  cookieName: process.env.SESSION_COOKIE_NAME || "softwarecup_session",
  ttlDays: Number(process.env.SESSION_TTL_DAYS || 30),
  secure: process.env.SESSION_COOKIE_SECURE === "true"
};

export const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS
  || "http://127.0.0.1:5173,http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const MODEL_PROVIDER_PRESETS = {
  openai: {
    provider: "openai-compatible",
    displayName: "OpenAI 兼容接口",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    defaultWireApi: "chat"
  },
  iflytek: {
    provider: "iflytek-spark",
    displayName: "讯飞星火大模型",
    defaultBaseUrl: "https://spark-api-open.xf-yun.com/v1",
    defaultModel: "4.0Ultra",
    defaultWireApi: "chat"
  }
};

const MODEL_PROVIDER_ALIASES = {
  openai: "openai",
  "openai-compatible": "openai",
  compatible: "openai",
  chatgpt: "openai",
  iflytek: "iflytek",
  xfyun: "iflytek",
  spark: "iflytek",
  "iflytek-spark": "iflytek",
  "spark-desk": "iflytek"
};

export const MODEL_CONFIG = resolveModelProviderConfig(process.env);

export const RAG_CONFIG = {
  // The complete parsed contents are sent to the model. Reject oversized
  // requests explicitly instead of silently truncating course material.
  fullContextMaxChars: Math.max(10000, Number(process.env.RAG_FULL_CONTEXT_MAX_CHARS || 900000))
};

export function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

export function resolveModelProviderConfig(env = process.env) {
  const providerKey = resolveModelProviderKey(env);
  const preset = MODEL_PROVIDER_PRESETS[providerKey] || MODEL_PROVIDER_PRESETS.openai;
  const iflytekApiKey = firstNonEmpty(
    env.IFLYTEK_API_PASSWORD,
    env.SPARK_API_PASSWORD,
    env.IFLYTEK_API_KEY,
    env.SPARK_API_KEY
  );
  const apiKey = firstNonEmpty(
    env.LLM_API_KEY,
    providerKey === "iflytek" ? iflytekApiKey : undefined,
    env.OPENAI_API_KEY,
    iflytekApiKey
  );
  const baseUrl = trimTrailingSlash(firstNonEmpty(
    env.LLM_BASE_URL,
    providerKey === "iflytek" ? env.IFLYTEK_BASE_URL : undefined,
    providerKey === "iflytek" ? env.SPARK_BASE_URL : undefined,
    env.OPENAI_BASE_URL,
    preset.defaultBaseUrl
  ));
  const model = firstNonEmpty(
    env.LLM_MODEL,
    providerKey === "iflytek" ? env.IFLYTEK_MODEL : undefined,
    providerKey === "iflytek" ? env.SPARK_MODEL : undefined,
    env.OPENAI_MODEL,
    preset.defaultModel
  );
  const wireApi = firstNonEmpty(
    env.LLM_WIRE_API,
    providerKey === "iflytek" ? env.IFLYTEK_WIRE_API : undefined,
    env.OPENAI_WIRE_API,
    preset.defaultWireApi
  );
  const timeoutMs = Number(firstNonEmpty(env.LLM_TIMEOUT_MS, env.OPENAI_TIMEOUT_MS, 180000));
  return {
    provider: preset.provider,
    displayName: preset.displayName,
    apiKey,
    baseUrl,
    model,
    wireApi,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 180000
  };
}

function resolveModelProviderKey(env) {
  const explicit = firstNonEmpty(env.LLM_PROVIDER, env.MODEL_PROVIDER, env.OPENAI_PROVIDER);
  if (explicit) return MODEL_PROVIDER_ALIASES[String(explicit).trim().toLowerCase()] || "openai";
  if (firstNonEmpty(env.IFLYTEK_API_PASSWORD, env.SPARK_API_PASSWORD, env.IFLYTEK_API_KEY, env.SPARK_API_KEY, env.IFLYTEK_BASE_URL, env.SPARK_BASE_URL)) {
    return "iflytek";
  }
  return "openai";
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

export function publicModelConfig() {
  return {
    enabled: Boolean(MODEL_CONFIG.apiKey),
    provider: MODEL_CONFIG.provider,
    displayName: MODEL_CONFIG.displayName,
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
