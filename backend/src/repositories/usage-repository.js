import { withTransaction } from "../db/pool.js";

export async function incrementDailyUsageRecord(userId, endpoint) {
  return withTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO api_usage_daily (user_id, usage_date, endpoint, request_count)
       VALUES (?, UTC_DATE(), ?, 1)
       ON DUPLICATE KEY UPDATE
         request_count = request_count + 1,
         updated_at = CURRENT_TIMESTAMP(3)`,
      [userId, endpoint]
    );
    const [rows] = await connection.execute(
      `SELECT request_count
         FROM api_usage_daily
        WHERE user_id = ? AND usage_date = UTC_DATE() AND endpoint = ?
        FOR UPDATE`,
      [userId, endpoint]
    );
    return Number(rows[0]?.request_count || 0);
  });
}
