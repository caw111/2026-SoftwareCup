import crypto from "node:crypto";

import { getDatabasePool, withTransaction } from "../db/pool.js";
import {
  applyRevisionToPlanData,
  dailyPlanShapeSignature,
  extractPlanTasksFromDailyPlan,
  revertRevisionFromPlanData,
  validateRevisionAgainstProgress
} from "../path-replanning.js";

export async function createLearningEventRecord(userId, planId, event) {
  const id = event.id || crypto.randomUUID();
  const eventType = String(event.type || event.eventType || "learning_event").slice(0, 80);
  const eventKey = event.eventKey ? String(event.eventKey).slice(0, 160) : null;
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const occurredAt = Number.isNaN(Date.parse(event.occurredAt))
    ? new Date()
    : new Date(event.occurredAt);
  await getDatabasePool().execute(
    `INSERT IGNORE INTO learning_activity_events
       (id, user_id, plan_id, event_type, event_key, payload_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, planId, eventType, eventKey, JSON.stringify(payload), occurredAt]
  );
  return { id, type: eventType, eventKey };
}

export async function createPathRevisionRecord(userId, planId, basePlanVersion, revision) {
  await getDatabasePool().execute(
    `INSERT INTO path_revisions
       (id, user_id, plan_id, base_plan_version, status, trigger_type,
        trigger_event_ids_json, evidence_json, summary, before_snapshot_json,
        after_snapshot_json, diff_json, actions_json, confidence, created_by_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      revision.id,
      userId,
      planId,
      Number(basePlanVersion || 1),
      revision.status || "proposed",
      String(revision.triggerType || "manual").slice(0, 80),
      JSON.stringify(revision.triggerEventIds || []),
      JSON.stringify(revision.evidence || {}),
      String(revision.summary || "学习路径调整建议").slice(0, 1000),
      JSON.stringify(revision.beforeSnapshot || {}),
      JSON.stringify(revision.afterSnapshot || {}),
      JSON.stringify(revision.diff || {}),
      JSON.stringify(revision.actions || []),
      Number(revision.confidence || 0),
      String(revision.createdByAgent || "路径重规划智能体").slice(0, 100)
    ]
  );
  return getPathRevisionRecord(userId, planId, revision.id);
}

export async function findOpenPathRevisionRecord(userId, planId, triggerType = null) {
  const params = [userId, planId];
  const triggerSql = triggerType ? "AND trigger_type = ?" : "";
  if (triggerType) params.push(triggerType);
  const [rows] = await getDatabasePool().execute(
    `SELECT *
       FROM path_revisions
      WHERE user_id = ? AND plan_id = ?
        AND status = 'proposed'
        ${triggerSql}
      ORDER BY created_at DESC
      LIMIT 1`,
    params
  );
  return rows.length ? publicRevision(rows[0]) : null;
}

export async function expireOpenPathRevisionRecords(userId, planId, options = {}) {
  const params = [userId, planId];
  const clauses = ["user_id = ?", "plan_id = ?", "status = 'proposed'"];
  if (options.triggerType) {
    clauses.push("trigger_type = ?");
    params.push(String(options.triggerType).slice(0, 80));
  }
  if (options.nonLlmOnly) {
    clauses.push("created_by_agent <> ?");
    params.push("LLM 路径重规划智能体");
  }
  const [result] = await getDatabasePool().execute(
    `UPDATE path_revisions
        SET status = 'expired', decided_at = CURRENT_TIMESTAMP(3)
      WHERE ${clauses.join(" AND ")}`,
    params
  );
  return result.affectedRows || 0;
}

export async function listPathRevisionRecords(userId, planId) {
  const [rows] = await getDatabasePool().execute(
    `SELECT *
       FROM path_revisions
      WHERE user_id = ? AND plan_id = ?
      ORDER BY created_at DESC
      LIMIT 30`,
    [userId, planId]
  );
  return rows.map(publicRevision);
}

export async function getPathRevisionRecord(userId, planId, revisionId) {
  const [rows] = await getDatabasePool().execute(
    `SELECT *
       FROM path_revisions
      WHERE id = ? AND user_id = ? AND plan_id = ?
      LIMIT 1`,
    [revisionId, userId, planId]
  );
  return rows.length ? publicRevision(rows[0]) : null;
}

export async function rejectPathRevisionRecord(userId, planId, revisionId) {
  const [result] = await getDatabasePool().execute(
    `UPDATE path_revisions
        SET status = 'rejected', decided_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND user_id = ? AND plan_id = ? AND status = 'proposed'`,
    [revisionId, userId, planId]
  );
  return result.affectedRows > 0;
}

export async function applyPathRevisionRecord(userId, planId, revisionId) {
  return withTransaction(async (connection) => {
    const { planRow, revisionRow } = await selectPlanAndRevisionForUpdate(
      connection,
      userId,
      planId,
      revisionId
    );
    if (!planRow || !revisionRow) return null;
    if (revisionRow.status !== "proposed") {
      const error = new Error("路径修订当前状态不可应用");
      error.statusCode = 409;
      throw error;
    }

    const planData = parseJson(planRow.content_json, {});
    const progress = await loadPlanProgress(connection, planId);
    const revision = publicRevision(revisionRow);
    assertDailyPlanMatches(planData.dailyPlan, revision.beforeSnapshot?.dailyPlan);
    const issues = validateRevisionAgainstProgress(revision, progress);
    if (issues.length) {
      const error = new Error(issues.join("；"));
      error.statusCode = 409;
      throw error;
    }

    const nextData = applyRevisionToPlanData(planData, revision);
    await connection.execute(
      `UPDATE learning_plans
          SET content_json = ?, version = version + 1
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [JSON.stringify(nextData), planId, userId]
    );
    await syncPlanTasks(connection, planId, nextData.dailyPlan, revisionId);
    await connection.execute(
      `UPDATE path_revisions
          SET status = 'applied',
              decided_at = CURRENT_TIMESTAMP(3),
              applied_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
      [revisionId]
    );
    await insertSystemEvent(connection, userId, planId, {
      type: "path_revision_applied",
      eventKey: `path-revision-applied:${revisionId}`,
      payload: { revisionId, summary: revision.summary }
    });
    return {
      ...revision,
      status: "applied",
      decidedAt: new Date().toISOString(),
      appliedAt: new Date().toISOString()
    };
  });
}

export async function undoPathRevisionRecord(userId, planId, revisionId) {
  return withTransaction(async (connection) => {
    const { planRow, revisionRow } = await selectPlanAndRevisionForUpdate(
      connection,
      userId,
      planId,
      revisionId
    );
    if (!planRow || !revisionRow) return null;
    if (revisionRow.status !== "applied") {
      const error = new Error("只有已应用的路径修订可以撤销");
      error.statusCode = 409;
      throw error;
    }

    const planData = parseJson(planRow.content_json, {});
    const revision = publicRevision(revisionRow);
    assertDailyPlanMatches(planData.dailyPlan, revision.afterSnapshot?.dailyPlan);
    const nextData = revertRevisionFromPlanData(planData, revision);
    await connection.execute(
      `UPDATE learning_plans
          SET content_json = ?, version = version + 1
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [JSON.stringify(nextData), planId, userId]
    );
    await syncPlanTasks(connection, planId, nextData.dailyPlan, null);
    await connection.execute(
      `UPDATE path_revisions
          SET status = 'undone', undone_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
      [revisionId]
    );
    await insertSystemEvent(connection, userId, planId, {
      type: "path_revision_undone",
      eventKey: `path-revision-undone:${revisionId}`,
      payload: { revisionId, summary: revision.summary }
    });
    return {
      ...revision,
      status: "undone",
      undoneAt: new Date().toISOString()
    };
  });
}

async function selectPlanAndRevisionForUpdate(connection, userId, planId, revisionId) {
  const [planRows] = await connection.execute(
    `SELECT id, content_json, version
       FROM learning_plans
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      FOR UPDATE`,
    [planId, userId]
  );
  const [revisionRows] = await connection.execute(
    `SELECT *
       FROM path_revisions
      WHERE id = ? AND user_id = ? AND plan_id = ?
      FOR UPDATE`,
    [revisionId, userId, planId]
  );
  return {
    planRow: planRows[0] || null,
    revisionRow: revisionRows[0] || null
  };
}

async function loadPlanProgress(connection, planId) {
  const [rows] = await connection.execute(
    `SELECT task_key, completed
       FROM plan_tasks
      WHERE plan_id = ? AND status = 'active'`,
    [planId]
  );
  return Object.fromEntries(rows.map((row) => [row.task_key, Boolean(row.completed)]));
}

async function syncPlanTasks(connection, planId, dailyPlan, revisionId) {
  const tasks = extractPlanTasksFromDailyPlan(dailyPlan, revisionId);
  for (const task of tasks) {
    await connection.execute(
      `INSERT INTO plan_tasks
         (plan_id, task_uid, task_key, day_number, task_index, content,
          concept_id, revision_id, status, locked, completed, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', FALSE, FALSE, NULL)
       ON DUPLICATE KEY UPDATE
         day_number = VALUES(day_number),
         task_index = VALUES(task_index),
         content = VALUES(content),
         concept_id = VALUES(concept_id),
         revision_id = VALUES(revision_id),
         status = 'active',
         task_uid = COALESCE(task_uid, VALUES(task_uid))`,
      [
        planId,
        crypto.randomUUID(),
        task.taskKey,
        task.dayNumber,
        task.taskIndex,
        task.content,
        task.conceptId,
        task.revisionId
      ]
    );
  }

  if (!tasks.length) {
    await connection.execute(
      "UPDATE plan_tasks SET status = 'deprecated' WHERE plan_id = ? AND completed = FALSE",
      [planId]
    );
    return;
  }

  await connection.execute(
    `UPDATE plan_tasks
        SET status = 'deprecated'
      WHERE plan_id = ?
        AND completed = FALSE
        AND task_key NOT IN (${tasks.map(() => "?").join(",")})`,
    [planId, ...tasks.map((task) => task.taskKey)]
  );
}

async function insertSystemEvent(connection, userId, planId, event) {
  await connection.execute(
    `INSERT IGNORE INTO learning_activity_events
       (id, user_id, plan_id, event_type, event_key, payload_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [
      crypto.randomUUID(),
      userId,
      planId,
      String(event.type || "learning_event").slice(0, 80),
      event.eventKey ? String(event.eventKey).slice(0, 160) : null,
      JSON.stringify(event.payload || {})
    ]
  );
}

function assertDailyPlanMatches(currentDailyPlan, expectedDailyPlan) {
  const current = dailyPlanShapeSignature(currentDailyPlan || []);
  const expected = dailyPlanShapeSignature(expectedDailyPlan || []);
  if (current !== expected) {
    const error = new Error("学习路径已经变化，请刷新后重新生成路径调整建议");
    error.statusCode = 409;
    throw error;
  }
}

function publicRevision(row) {
  return {
    id: row.id,
    planId: row.plan_id,
    basePlanVersion: Number(row.base_plan_version || 1),
    status: row.status,
    triggerType: row.trigger_type,
    triggerEventIds: parseJson(row.trigger_event_ids_json, []),
    evidence: parseJson(row.evidence_json, {}),
    summary: row.summary,
    beforeSnapshot: parseJson(row.before_snapshot_json, {}),
    afterSnapshot: parseJson(row.after_snapshot_json, {}),
    diff: parseJson(row.diff_json, {}),
    actions: parseJson(row.actions_json, []),
    confidence: Number(row.confidence || 0),
    createdByAgent: row.created_by_agent,
    createdAt: toIso(row.created_at),
    decidedAt: row.decided_at ? toIso(row.decided_at) : null,
    appliedAt: row.applied_at ? toIso(row.applied_at) : null,
    undoneAt: row.undone_at ? toIso(row.undone_at) : null
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
