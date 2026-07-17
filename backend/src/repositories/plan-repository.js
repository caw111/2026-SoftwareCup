import { databaseDialect, getDatabasePool, withTransaction } from "../db/pool.js";

export async function createPlanRecord(userId, plan) {
  return withTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO learning_plans
         (id, user_id, title, category, content_json, notes,
          mastery_evidence_json, legacy_quiz_history_json, quiz_round, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        plan.id,
        userId,
        plan.title,
        plan.category,
        JSON.stringify(plan.data),
        plan.notes,
        JSON.stringify(plan.masteryEvidence),
        JSON.stringify(plan.quizHistory),
        plan.quizRound,
        new Date(plan.createdAt)
      ]
    );

    for (const task of extractTasks(plan)) {
      await connection.execute(
        `INSERT INTO plan_tasks
           (plan_id, task_key, day_number, task_index, content, completed, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          plan.id,
          task.taskKey,
          task.dayNumber,
          task.taskIndex,
          task.content,
          task.completed,
          task.completed ? new Date() : null
        ]
      );
    }

    await upsertConceptMastery(connection, userId, plan.id, plan.data?.adaptiveState?.concepts || []);
    await insertContentReview(connection, userId, plan.id, plan.data?.governanceReport);
    await insertInsightReport(connection, userId, plan.id, plan.data?.personalInsights);

    await connection.execute(
      workspaceUpsertSql(),
      [userId, plan.id]
    );
    return plan;
  });
}

export async function planExistsForUser(userId, planId) {
  const [rows] = await getDatabasePool().execute(
    `SELECT 1
       FROM learning_plans
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [planId, userId]
  );
  return rows.length > 0;
}

export async function getWorkspaceRecord(userId) {
  const pool = getDatabasePool();
  const [planRows] = await pool.execute(
    `SELECT id, title, category, content_json, notes, mastery_evidence_json,
            legacy_quiz_history_json, quiz_round, version, created_at, updated_at
       FROM learning_plans
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [userId]
  );
  const [workspaceRows] = await pool.execute(
    "SELECT active_plan_id FROM user_workspaces WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (!planRows.length) {
    return { plans: [], currentPlanId: null };
  }

  const planIds = planRows.map((row) => row.id);
  const placeholders = planIds.map(() => "?").join(",");
  const [taskRows] = await pool.execute(
    `SELECT plan_id, task_key, completed
       FROM plan_tasks
      WHERE plan_id IN (${placeholders})
      ORDER BY day_number, task_index`,
    planIds
  );
  const [historyRows] = await pool.execute(
    `SELECT s.plan_id, q.client_question_id, q.question_type, q.dimension,
            q.question_json, a.answer_json, a.is_correct, a.score, a.max_score,
            a.result_json, a.created_at
       FROM quiz_attempts a
       JOIN quiz_questions q ON q.id = a.question_id
       JOIN quiz_sessions s ON s.id = q.session_id
      WHERE s.user_id = ? AND s.plan_id IN (${placeholders})
      ORDER BY a.created_at`,
    [userId, ...planIds]
  );

  const progressByPlan = new Map();
  for (const row of taskRows) {
    if (!progressByPlan.has(row.plan_id)) progressByPlan.set(row.plan_id, {});
    progressByPlan.get(row.plan_id)[row.task_key] = Boolean(row.completed);
  }
  const historyByPlan = new Map(planRows.map((row) => [
    row.id,
    parseJson(row.legacy_quiz_history_json, [])
  ]));
  for (const row of historyRows) {
    if (!historyByPlan.has(row.plan_id)) historyByPlan.set(row.plan_id, []);
    const question = parseJson(row.question_json, {});
    const answer = parseJson(row.answer_json, null);
    const result = parseJson(row.result_json, {});
    historyByPlan.get(row.plan_id).push({
      questionId: row.client_question_id,
      type: row.question_type,
      dimension: row.dimension,
      question: question.question || "",
      options: Array.isArray(question.options) ? question.options : [],
      explanation: question.explanation || "",
      answerIndex: question.answerIndex,
      selectedIndex: question.type === "choice" ? Number(answer) : null,
      answer,
      correct: Boolean(row.is_correct),
      score: Number(row.score),
      maxScore: Number(row.max_score),
      result,
      at: toIso(row.created_at)
    });
  }

  const plans = planRows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: toIso(row.created_at),
    category: row.category,
    data: parseJson(row.content_json, {}),
    progress: progressByPlan.get(row.id) || {},
    notes: row.notes || "",
    masteryEvidence: parseJson(row.mastery_evidence_json, []),
    quizHistory: historyByPlan.get(row.id) || [],
    quizRound: Number(row.quiz_round || 0),
    version: Number(row.version || 1)
  }));
  const requestedActiveId = workspaceRows[0]?.active_plan_id;
  const currentPlanId = plans.some((plan) => plan.id === requestedActiveId)
    ? requestedActiveId
    : plans[0].id;
  return { plans, currentPlanId };
}

export async function setActivePlanRecord(userId, planId) {
  if (planId !== null && !(await planExistsForUser(userId, planId))) return false;
  await getDatabasePool().execute(
    workspaceUpsertSql(),
    [userId, planId]
  );
  return true;
}

export async function softDeletePlanRecord(userId, planId) {
  return withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `UPDATE learning_plans
          SET deleted_at = CURRENT_TIMESTAMP(3), version = version + 1
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [planId, userId]
    );
    if (!result.affectedRows) return false;
    await connection.execute(
      `UPDATE user_workspaces
          SET active_plan_id = NULL, version = version + 1
        WHERE user_id = ? AND active_plan_id = ?`,
      [userId, planId]
    );
    return true;
  });
}

export async function updatePlanNotesRecord(userId, planId, notes) {
  const [result] = await getDatabasePool().execute(
    `UPDATE learning_plans
        SET notes = ?, version = version + 1
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [notes, planId, userId]
  );
  return result.affectedRows > 0;
}

export async function updatePlanContentRecord(userId, planId, payload) {
  return withTransaction(async (connection) => {
    const assignments = ["content_json = ?", "version = version + 1"];
    const values = [JSON.stringify(payload.data || {})];
    if (Array.isArray(payload.masteryEvidence)) {
      assignments.unshift("mastery_evidence_json = ?");
      values.unshift(JSON.stringify(payload.masteryEvidence));
    }
    const [result] = await connection.execute(
      `UPDATE learning_plans
          SET ${assignments.join(", ")}
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [...values, planId, userId]
    );
    if (!result.affectedRows) return false;

    await upsertConceptMastery(connection, userId, planId, payload.data?.adaptiveState?.concepts || []);
    await insertContentReview(connection, userId, planId, payload.data?.governanceReport);
    await insertInsightReport(connection, userId, planId, payload.data?.personalInsights);
    return true;
  });
}

export async function updateTaskProgressRecord(userId, planId, taskKey, completed) {
  if (databaseDialect() === "sqlite") {
    const [result] = await getDatabasePool().execute(
      `UPDATE plan_tasks
          SET completed = ?,
              completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
              updated_at = CURRENT_TIMESTAMP
        WHERE plan_id = ? AND task_key = ?
          AND EXISTS (
            SELECT 1 FROM learning_plans p
             WHERE p.id = plan_tasks.plan_id
               AND p.user_id = ? AND p.deleted_at IS NULL
          )`,
      [completed, completed, planId, taskKey, userId]
    );
    return result.affectedRows > 0;
  }
  const [result] = await getDatabasePool().execute(
    `UPDATE plan_tasks t
       JOIN learning_plans p ON p.id = t.plan_id
        SET t.completed = ?,
            t.completed_at = IF(?, CURRENT_TIMESTAMP(3), NULL)
      WHERE t.plan_id = ?
        AND t.task_key = ?
        AND p.user_id = ?
        AND p.deleted_at IS NULL`,
    [completed, completed, planId, taskKey, userId]
  );
  return result.affectedRows > 0;
}

export async function resetPlanProgressRecord(userId, planId) {
  if (databaseDialect() === "sqlite") {
    const [result] = await getDatabasePool().execute(
      `UPDATE plan_tasks
          SET completed = FALSE, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE plan_id = ?
          AND EXISTS (
            SELECT 1 FROM learning_plans p
             WHERE p.id = plan_tasks.plan_id
               AND p.user_id = ? AND p.deleted_at IS NULL
          )`,
      [planId, userId]
    );
    return result.affectedRows;
  }
  const [result] = await getDatabasePool().execute(
    `UPDATE plan_tasks t
       JOIN learning_plans p ON p.id = t.plan_id
        SET t.completed = FALSE, t.completed_at = NULL
      WHERE t.plan_id = ? AND p.user_id = ? AND p.deleted_at IS NULL`,
    [planId, userId]
  );
  return result.affectedRows;
}

async function upsertConceptMastery(connection, userId, planId, concepts) {
  for (const concept of concepts) {
    await connection.execute(
      conceptMasteryUpsertSql(),
      [
        userId,
        planId,
        String(concept.conceptId || concept.id || "").slice(0, 120),
        String(concept.title || concept.conceptTitle || "").slice(0, 255),
        String(concept.dimension || "").slice(0, 100),
        Number(concept.masteryScore || concept.score || 0),
        JSON.stringify({
          evidence: concept.evidence || "",
          source: concept.source || "adaptive-state"
        })
      ]
    );
  }
}

function workspaceUpsertSql() {
  if (databaseDialect() === "sqlite") {
    return `INSERT INTO user_workspaces (user_id, active_plan_id)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              active_plan_id = excluded.active_plan_id,
              version = user_workspaces.version + 1,
              updated_at = CURRENT_TIMESTAMP`;
  }
  return `INSERT INTO user_workspaces (user_id, active_plan_id)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE
            active_plan_id = VALUES(active_plan_id),
            version = version + 1`;
}

function conceptMasteryUpsertSql() {
  if (databaseDialect() === "sqlite") {
    return `INSERT INTO concept_mastery
              (user_id, plan_id, concept_id, concept_name, dimension, mastery_score, evidence_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(plan_id, concept_id) DO UPDATE SET
              concept_name = excluded.concept_name,
              dimension = excluded.dimension,
              mastery_score = excluded.mastery_score,
              evidence_json = excluded.evidence_json,
              updated_at = CURRENT_TIMESTAMP`;
  }
  return `INSERT INTO concept_mastery
            (user_id, plan_id, concept_id, concept_name, dimension, mastery_score, evidence_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            concept_name = VALUES(concept_name),
            dimension = VALUES(dimension),
            mastery_score = VALUES(mastery_score),
            evidence_json = VALUES(evidence_json),
            updated_at = CURRENT_TIMESTAMP(3)`;
}

async function insertContentReview(connection, userId, planId, report) {
  if (!report || typeof report !== "object") return;
  await connection.execute(
    `INSERT INTO content_reviews
       (user_id, plan_id, reviewer_agent, risk_level, quality_score, checks_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      planId,
      String(report.agent || "内容治理智能体").slice(0, 100),
      String(report.riskLevel || "unknown").slice(0, 20),
      Number(report.score || 0),
      JSON.stringify(report.checks || [])
    ]
  );
}

async function insertInsightReport(connection, userId, planId, report) {
  if (!report || typeof report !== "object") return;
  await connection.execute(
    `INSERT INTO teacher_reports
       (user_id, plan_id, report_json)
     VALUES (?, ?, ?)`,
    [userId, planId, JSON.stringify(report)]
  );
}

function extractTasks(plan) {
  const tasks = [];
  for (const day of plan.data?.dailyPlan || []) {
    (day.tasks || []).forEach((content, taskIndex) => {
      const taskKey = `day-${day.day}-task-${taskIndex}`;
      tasks.push({
        taskKey,
        dayNumber: Number(day.day),
        taskIndex,
        content: String(content),
        completed: Boolean(plan.progress?.[taskKey])
      });
    });
  }
  return tasks;
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
