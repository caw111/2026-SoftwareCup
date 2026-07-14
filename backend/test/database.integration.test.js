import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";

import {
  closeDatabasePool,
  getDatabasePool,
  isDatabaseConfigured
} from "../src/db/pool.js";
import { createAnonymousUserSession } from "../src/repositories/user-repository.js";
import {
  createPlanForUser,
  getWorkspaceForUser,
  updateTaskProgressForUser
} from "../src/services/plan-service.js";
import {
  evaluateStoredQuestionForUser,
  saveGeneratedQuizForUser
} from "../src/services/quiz-service.js";
import { migrateDatabase } from "../../scripts/migrate.js";
import { saveApplicationStateForUser } from "../src/services/application-state-service.js";

const configured = isDatabaseConfigured();
let testUserId;

test("MySQL 可持久化完整学习工作区", { skip: !configured }, async () => {
  await migrateDatabase({ log: () => {} });
  const tokenHash = crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex");
  const session = await createAnonymousUserSession(
    tokenHash,
    new Date(Date.now() + 60_000)
  );
  testUserId = session.userId;

  const plan = await createPlanForUser(testUserId, {
    id: `test-plan-${crypto.randomUUID()}`,
    title: "数据库集成测试",
    category: "测试",
    data: {
      input: { topic: "测试" },
      dailyPlan: [{ day: 1, tasks: ["完成任务"] }]
    }
  });
  await updateTaskProgressForUser(testUserId, plan.id, "day-1-task-0", true);

  const quiz = await saveGeneratedQuizForUser(testUserId, plan.id, {
    mode: "test",
    source: { done: 1, total: 1 },
    quiz: [{
      id: "test-question",
      type: "choice",
      dimension: "测试",
      question: "正确选项是 B",
      options: ["A", "B"],
      answerIndex: 1,
      explanation: "B 正确",
      score: 10
    }]
  }, 1);
  const result = await evaluateStoredQuestionForUser(
    testUserId,
    quiz.quiz[0].databaseId,
    1
  );
  await saveApplicationStateForUser(testUserId, {
    tutorHistory: [{ role: "tutor", content: "持久化回答" }],
    settings: { strictMode: true },
    behaviorEvents: [{ type: "quiz-submitted" }],
    exam: { planId: plan.id, status: "submitted" },
    projectSubmissions: { [plan.id]: { content: "项目结果" } }
  });
  const workspace = await getWorkspaceForUser(testUserId);

  assert.equal(result.correct, true);
  assert.equal(workspace.plans.length, 1);
  assert.equal(workspace.plans[0].progress["day-1-task-0"], true);
  assert.equal(workspace.quizResults["test-question"].correct, true);
  assert.equal(workspace.applicationState.tutorHistory[0].content, "持久化回答");
  assert.equal(workspace.applicationState.settings.strictMode, true);
  assert.equal(workspace.applicationState.exam.status, "submitted");
  assert.equal(workspace.applicationState.projectSubmissions[plan.id].content, "项目结果");
});

after(async () => {
  if (!configured) return;
  if (testUserId) {
    await getDatabasePool().execute("DELETE FROM users WHERE id = ?", [testUserId]);
  }
  await closeDatabasePool();
});
