import crypto from "node:crypto";

import { databaseDialect, getDatabasePool, withTransaction } from "../db/pool.js";

export async function createQuizSessionRecord(userId, planId, payload) {
  return withTransaction(async (connection) => {
    const [plans] = await connection.execute(
      `SELECT id FROM learning_plans
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        FOR UPDATE`,
      [planId, userId]
    );
    if (!plans.length) return null;

    const sessionId = crypto.randomUUID();
    await connection.execute(
      `INSERT INTO quiz_sessions
         (id, user_id, plan_id, round_number, generation_mode, summary_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        userId,
        planId,
        Number(payload.roundNumber || 0),
        payload.mode || null,
        payload.summary ? JSON.stringify(payload.summary) : null
      ]
    );

    const questions = [];
    for (const [position, question] of (payload.quiz || []).entries()) {
      const databaseId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO quiz_questions
           (id, session_id, client_question_id, question_type, dimension,
            question_json, position, max_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          databaseId,
          sessionId,
          String(question.id || databaseId),
          String(question.type || "short"),
          question.dimension || null,
          JSON.stringify(question),
          position,
          Number(question.score || 0)
        ]
      );
      questions.push(publicQuestion(question, databaseId));
    }
    await connection.execute(
      `UPDATE learning_plans
          SET quiz_round = ?, version = version + 1
        WHERE id = ?`,
      [Number(payload.roundNumber || 0), planId]
    );
    return { sessionId, quiz: questions };
  });
}

export async function getQuizQuestionForUser(userId, questionId) {
  const [rows] = await getDatabasePool().execute(
    `SELECT q.id, q.client_question_id, q.question_json, q.max_score,
            s.plan_id, s.id AS session_id
       FROM quiz_questions q
       JOIN quiz_sessions s ON s.id = q.session_id
      WHERE q.id = ? AND s.user_id = ?
      LIMIT 1`,
    [questionId, userId]
  );
  if (!rows.length) return null;
  return {
    ...rows[0],
    question: parseJson(rows[0].question_json, {})
  };
}

export async function createQuizAttemptRecord(userId, questionId, answer, result) {
  const attemptId = crypto.randomUUID();
  await getDatabasePool().execute(
    `INSERT INTO quiz_attempts
       (id, question_id, user_id, answer_json, is_correct, score,
        max_score, feedback, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attemptId,
      questionId,
      userId,
      JSON.stringify(answer),
      Boolean(result.correct),
      Number(result.score || 0),
      Number(result.maxScore || 0),
      result.feedback || null,
      JSON.stringify(result)
    ]
  );
  return attemptId;
}

export async function getLatestQuizStateRecord(userId, planId) {
  if (!planId) return { quiz: [], quizResults: {} };
  const pool = getDatabasePool();
  const [sessions] = await pool.execute(
    latestQuizSessionSql(),
    [userId, planId, planId]
  );
  if (!sessions.length) return { quiz: [], quizResults: {} };

  const [questionRows] = await pool.execute(
    `SELECT id, client_question_id, question_json
       FROM quiz_questions
      WHERE session_id = ?
      ORDER BY position`,
    [sessions[0].id]
  );
  const questionIds = questionRows.map((row) => row.id);
  if (!questionIds.length) return { quiz: [], quizResults: {} };
  const placeholders = questionIds.map(() => "?").join(",");
  const [attemptRows] = await pool.execute(
    `SELECT question_id, result_json
       FROM quiz_attempts
      WHERE user_id = ? AND question_id IN (${placeholders})
      ORDER BY created_at DESC`,
    [userId, ...questionIds]
  );
  const latestResults = new Map();
  for (const row of attemptRows) {
    if (!latestResults.has(row.question_id)) {
      latestResults.set(row.question_id, parseJson(row.result_json, {}));
    }
  }

  const quiz = questionRows.map((row) => {
    const question = parseJson(row.question_json, {});
    return publicQuestion(question, row.id);
  });
  const quizResults = {};
  for (const row of questionRows) {
    const result = latestResults.get(row.id);
    if (result) quizResults[row.client_question_id] = result;
  }
  return { quiz, quizResults };
}

function latestQuizSessionSql() {
  const fallback = databaseDialect() === "sqlite"
    ? "'1970-01-01 00:00:00'"
    : "CAST('1970-01-01 00:00:00' AS DATETIME)";
  return `SELECT id
            FROM quiz_sessions
           WHERE user_id = ? AND plan_id = ?
             AND created_at >= COALESCE(
               (SELECT MAX(updated_at) FROM plan_tasks WHERE plan_id = ?),
               ${fallback}
             )
           ORDER BY created_at DESC
           LIMIT 1`;
}

export function publicQuestion(question, databaseId) {
  const {
    answerIndex,
    keywords,
    referenceAnswer,
    tests,
    ...safeQuestion
  } = question;
  return { ...safeQuestion, databaseId };
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
