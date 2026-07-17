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
    mysql_connection_limit: "MYSQL_CONNECTION_LIMIT",
    sqlite_file: "SQLITE_FILE",
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
    judge_auto_bootstrap: "JUDGE_AUTO_BOOTSTRAP",
    python_executable: "PYTHON_EXECUTABLE"
  };
  return map[key.trim().toLowerCase()] || key.trim();
}

loadEnvFile();

export const PORT = Number(process.env.BACKEND_PORT || 3000);

// Desktop builds live inside a read-only asar archive. Electron sets this
// variable to a writable per-user directory before the backend is imported.
export const DATA_DIR = process.env.SOFTWARECUP_DATA_DIR
  ? path.resolve(process.env.SOFTWARECUP_DATA_DIR)
  : path.join(PROJECT_ROOT, "data");

export const WORKSPACE_STATE_FILE = path.join(DATA_DIR, "workspace-state.json");

export const SQLITE_FILE = path.resolve(
  process.env.SQLITE_FILE || path.join(DATA_DIR, "learning.sqlite3")
);

export const JUDGE_IMAGE = process.env.JUDGE_IMAGE || "softwarecup-code-judge:latest";

export const JUDGE_BUILD_DIR = path.join(PROJECT_ROOT, "backend", "judge", "python");

export const JUDGE_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS || 10000);

export const JUDGE_AUTO_BOOTSTRAP = process.env.JUDGE_AUTO_BOOTSTRAP !== "false";

export const PYTHON_EXECUTABLE = process.env.PYTHON_EXECUTABLE || "";

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
