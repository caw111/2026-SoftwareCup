import { databaseDialect, getDatabasePool } from "../db/pool.js";

export async function getAppStateRecord(userId) {
  const [rows] = await getDatabasePool().execute(
    "SELECT state_json, updated_at FROM app_states WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (!rows.length) return { state: {}, updatedAt: null };
  try {
    return {
      state: JSON.parse(rows[0].state_json || "{}"),
      updatedAt: rows[0].updated_at || null
    };
  } catch {
    return { state: {}, updatedAt: rows[0].updated_at || null };
  }
}

export async function saveAppStateRecord(userId, state) {
  const serialized = JSON.stringify(state || {});
  const sql = databaseDialect() === "sqlite"
    ? `INSERT INTO app_states (user_id, state_json)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = CURRENT_TIMESTAMP`
    : `INSERT INTO app_states (user_id, state_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         state_json = VALUES(state_json),
         updated_at = CURRENT_TIMESTAMP(3)`;
  await getDatabasePool().execute(sql, [userId, serialized]);
  return { ok: true, updatedAt: new Date().toISOString() };
}
