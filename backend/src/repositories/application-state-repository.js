import { getDatabasePool } from "../db/pool.js";

export async function getApplicationStateRecord(userId) {
  const [rows] = await getDatabasePool().execute(
    `SELECT state_json, version, updated_at
       FROM user_application_states
      WHERE user_id = ?
      LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  return {
    state: parseJson(rows[0].state_json, {}),
    version: Number(rows[0].version || 1),
    updatedAt: toIso(rows[0].updated_at)
  };
}

export async function upsertApplicationStateRecord(userId, state) {
  await getDatabasePool().execute(
    `INSERT INTO user_application_states (user_id, state_json)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       state_json = VALUES(state_json),
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP(3)`,
    [userId, JSON.stringify(state)]
  );
  return getApplicationStateRecord(userId);
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
