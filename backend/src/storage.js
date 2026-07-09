import fs from "node:fs";

import path from "node:path";

import mysql from "mysql2/promise";

import { DATA_DIR, WORKSPACE_STATE_FILE, STORAGE_KEY, STORAGE_CONFIG } from "./config.js";

let mysqlPool = null;
let mysqlReady = false;

export async function readWorkspaceState() {
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

export async function writeWorkspaceState(body) {
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

export async function getStorageStatus() {
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

export function storagePublicConfig() {
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
