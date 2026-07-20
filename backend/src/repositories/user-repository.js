import crypto from "node:crypto";

import { getDatabasePool, withTransaction } from "../db/pool.js";

export async function findUserBySessionTokenHash(tokenHash) {
  const [rows] = await getDatabasePool().execute(
    `SELECT s.id AS session_id, s.user_id, s.expires_at
       FROM user_sessions s
      WHERE s.token_hash = ?
        AND s.expires_at > CURRENT_TIMESTAMP(3)
      LIMIT 1`,
    [tokenHash]
  );
  if (!rows.length) return null;
  await getDatabasePool().execute(
    "UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
    [rows[0].session_id]
  );
  return rows[0];
}

export async function createAnonymousUserSession(tokenHash, expiresAt) {
  return withTransaction(async (connection) => {
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    await connection.execute(
      "INSERT INTO users (id, user_type) VALUES (?, 'anonymous')",
      [userId]
    );
    await connection.execute(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [sessionId, userId, tokenHash, expiresAt]
    );
    await connection.execute(
      "INSERT INTO user_workspaces (user_id) VALUES (?)",
      [userId]
    );
    return { sessionId, userId, expiresAt };
  });
}

export async function ensureLocalUserSession() {
  const userId = "local-desktop-user";
  const sessionId = "local-desktop-session";
  const pool = getDatabasePool();
  const [users] = await pool.execute("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!users.length) {
    await withTransaction(async (connection) => {
      await connection.execute(
        "INSERT INTO users (id, user_type, display_name) VALUES (?, 'anonymous', ?)",
        [userId, "本地用户"]
      );
      await connection.execute(
        `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?)`,
        [sessionId, userId, "0".repeat(64), new Date("2099-12-31T23:59:59.000Z")]
      );
      await connection.execute("INSERT INTO user_workspaces (user_id) VALUES (?)", [userId]);
    });
  }
  return { userId, sessionId };
}
