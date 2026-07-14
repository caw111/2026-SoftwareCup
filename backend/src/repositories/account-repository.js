import crypto from "node:crypto";

import { getDatabasePool, withTransaction } from "../db/pool.js";

export async function createAccountRecord(userId, account) {
  return withTransaction(async (connection) => {
    const [users] = await connection.execute(
      "SELECT user_type FROM users WHERE id = ? FOR UPDATE",
      [userId]
    );
    if (!users.length) throw httpError(404, "用户不存在");
    if (users[0].user_type === "registered") throw httpError(409, "当前用户已经注册");

    try {
      await connection.execute(
        `INSERT INTO user_accounts (user_id, username, password_salt, password_hash)
         VALUES (?, ?, ?, ?)`,
        [userId, account.username, account.passwordSalt, account.passwordHash]
      );
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") throw httpError(409, "用户名已被使用");
      throw error;
    }
    await connection.execute(
      "UPDATE users SET user_type = 'registered', display_name = ? WHERE id = ?",
      [account.displayName, userId]
    );
    return { userId, userType: "registered", username: account.username, displayName: account.displayName };
  });
}

export async function findAccountByUsername(username) {
  const [rows] = await getDatabasePool().execute(
    `SELECT a.user_id, a.username, a.password_salt, a.password_hash,
            u.user_type, u.display_name
       FROM user_accounts a
       JOIN users u ON u.id = a.user_id
      WHERE a.username = ?
      LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

export async function createSessionRecord(userId, tokenHash, expiresAt) {
  const sessionId = crypto.randomUUID();
  await getDatabasePool().execute(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [sessionId, userId, tokenHash, expiresAt]
  );
  return { sessionId, userId, expiresAt };
}

export async function deleteSessionRecord(tokenHash) {
  await getDatabasePool().execute("DELETE FROM user_sessions WHERE token_hash = ?", [tokenHash]);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
