import crypto from "node:crypto";

import { getDatabasePool, withTransaction } from "../db/pool.js";

export async function findUserBySessionTokenHash(tokenHash) {
  const [rows] = await getDatabasePool().execute(
    `SELECT s.id AS session_id, s.user_id, s.expires_at,
            u.user_type, u.display_name, a.username
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_accounts a ON a.user_id = s.user_id
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
