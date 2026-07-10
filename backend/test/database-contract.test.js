import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { publicQuestion } from "../src/repositories/quiz-repository.js";
import { splitSqlStatements } from "../../scripts/migrate.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

test("数据库迁移包含全部核心业务表", () => {
  const migrationDir = path.join(ROOT, "database", "migrations");
  const sql = fs.readdirSync(migrationDir)
    .sort()
    .map((file) => fs.readFileSync(path.join(migrationDir, file), "utf8"))
    .join("\n");
  for (const table of [
    "users",
    "user_sessions",
    "user_workspaces",
    "learning_plans",
    "plan_tasks",
    "quiz_sessions",
    "quiz_questions",
    "quiz_attempts",
    "legacy_imports"
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.doesNotMatch(
    fs.readFileSync(path.join(ROOT, "backend", "src", "storage.js"), "utf8"),
    /CREATE TABLE/i
  );
});

test("SQL 迁移拆分器按语句执行", () => {
  assert.deepEqual(
    splitSqlStatements("CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);\n"),
    ["CREATE TABLE a (id INT)", "CREATE TABLE b (id INT)"]
  );
});

test("发给浏览器的题目不包含答案和隐藏测试", () => {
  const safe = publicQuestion({
    id: "q1",
    type: "choice",
    question: "测试题",
    options: ["A", "B"],
    answerIndex: 1,
    keywords: ["秘密"],
    referenceAnswer: "B",
    tests: [{ expected: 42 }]
  }, "database-question-id");

  assert.equal(safe.databaseId, "database-question-id");
  assert.equal(safe.question, "测试题");
  assert.equal("answerIndex" in safe, false);
  assert.equal("keywords" in safe, false);
  assert.equal("referenceAnswer" in safe, false);
  assert.equal("tests" in safe, false);
});
