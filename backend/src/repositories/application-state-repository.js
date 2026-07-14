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

export async function saveApplicationStateRecord(userId, state, expectedVersion) {
  const serializedState = JSON.stringify(state);
  if (expectedVersion === 0) {
    try {
      await getDatabasePool().execute(
        `INSERT INTO user_application_states (user_id, state_json, version)
         VALUES (?, ?, 1)`,
        [userId, serializedState]
      );
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") throw stateVersionConflict();
      throw error;
    }
  } else {
    const [result] = await getDatabasePool().execute(
      `UPDATE user_application_states
          SET state_json = ?,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE user_id = ? AND version = ?`,
      [serializedState, userId, expectedVersion]
    );
    if (result.affectedRows !== 1) throw stateVersionConflict();
  }
  return getApplicationStateRecord(userId);
}

function stateVersionConflict() {
  const error = new Error("学习数据已在其他页面更新，请刷新页面后继续");
  error.code = "STATE_VERSION_CONFLICT";
  error.statusCode = 409;
  return error;
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
