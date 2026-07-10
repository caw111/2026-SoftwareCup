import fs from "node:fs";

import { DATA_DIR, WORKSPACE_STATE_FILE, STORAGE_KEY } from "./config.js";
import { getDatabasePool, isDatabaseConfigured } from "./db/pool.js";

// Compatibility reader for one release. New application code uses normalized
// repositories and never writes workspace_states.
export async function readWorkspaceState() {
  const legacyDatabaseState = await readLegacyDatabaseState();
  if (legacyDatabaseState) return normalizeWorkspaceState(legacyDatabaseState);

  try {
    if (!fs.existsSync(WORKSPACE_STATE_FILE)) return emptyWorkspaceState();
    return normalizeWorkspaceState(JSON.parse(fs.readFileSync(WORKSPACE_STATE_FILE, "utf8")));
  } catch {
    return emptyWorkspaceState();
  }
}

// Kept only for old frontends. It writes a local migration source and cannot
// silently claim a successful database write.
export async function writeWorkspaceState(body) {
  const state = normalizeWorkspaceState(body);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const savedAt = new Date().toISOString();
  fs.writeFileSync(
    WORKSPACE_STATE_FILE,
    JSON.stringify({ ...state, savedAt }, null, 2),
    "utf8"
  );
  return {
    ok: true,
    deprecated: true,
    storage: "legacy-file",
    savedAt,
    file: WORKSPACE_STATE_FILE
  };
}

export async function getStorageStatus() {
  return {
    ok: true,
    mode: "legacy-file",
    message: "MySQL 未配置，当前仅保留浏览器和本地文件兼容模式",
    file: WORKSPACE_STATE_FILE
  };
}

export function storagePublicConfig() {
  return {
    mode: isDatabaseConfigured() ? "mysql-relational" : "legacy-file",
    mysqlConfigured: isDatabaseConfigured()
  };
}

async function readLegacyDatabaseState() {
  if (!isDatabaseConfigured()) return null;
  try {
    const pool = getDatabasePool();
    const [tableRows] = await pool.execute(
      `SELECT 1
         FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'workspace_states'
        LIMIT 1`
    );
    if (!tableRows.length) return null;
    const [rows] = await pool.execute(
      "SELECT state_json FROM workspace_states WHERE state_key = ? LIMIT 1",
      [STORAGE_KEY]
    );
    if (!rows.length) return null;
    return typeof rows[0].state_json === "string"
      ? JSON.parse(rows[0].state_json)
      : rows[0].state_json;
  } catch (error) {
    console.warn(`读取旧版 workspace_states 失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
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
    quizResults: value?.quizResults && typeof value.quizResults === "object"
      ? value.quizResults
      : {},
    agents: Array.isArray(value?.agents) ? value.agents : []
  };
}
