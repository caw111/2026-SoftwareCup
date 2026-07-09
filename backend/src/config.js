import fs from "node:fs";

import path from "node:path";

import { fileURLToPath } from "node:url";

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

loadEnvFile();

export const PORT = Number(process.env.BACKEND_PORT || 3000);

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  database: process.env.MYSQL_DATABASE
};

export const MODEL_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: trimTrailingSlash(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
  model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  wireApi: process.env.OPENAI_WIRE_API || "chat",
  timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 180000)
};

export function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

export function publicModelConfig() {
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
