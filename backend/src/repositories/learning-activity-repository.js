import { getDatabasePool } from "../db/pool.js";

export async function listLearningEventRecords(userId, options = {}) {
  const requestedLimit = Number(options.limit || 5000);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(10000, Math.trunc(requestedLimit)))
    : 5000;
  const params = [userId];
  const clauses = ["user_id = ?"];
  if (options.planId) {
    clauses.push("plan_id = ?");
    params.push(String(options.planId).slice(0, 64));
  }
  if (options.from) {
    clauses.push("occurred_at >= ?");
    params.push(new Date(options.from));
  }
  if (options.to) {
    clauses.push("occurred_at <= ?");
    params.push(new Date(options.to));
  }
  const [rows] = await getDatabasePool().execute(
    `SELECT id, user_id, plan_id, event_type, event_key, payload_json, occurred_at, created_at
       FROM learning_activity_events
      WHERE ${clauses.join(" AND ")}
      ORDER BY occurred_at ASC, created_at ASC
      LIMIT ${limit}`,
    params
  );
  return rows.map(publicEvent);
}

function publicEvent(row) {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    type: row.event_type,
    eventKey: row.event_key,
    payload: parseJson(row.payload_json, {}),
    occurredAt: toIso(row.occurred_at),
    createdAt: toIso(row.created_at)
  };
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
