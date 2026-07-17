import test from "node:test";
import assert from "node:assert/strict";

import {
  distributeQuizChoiceAnswers,
  durationToDays,
  normalizeDailyPlan,
  normalizeInput,
  redistributeChoiceAnswer,
  runLocalAgents
} from "../src/learning.js";

test("durationToDays converts the configured learning period to calendar days", () => {
  assert.equal(durationToDays("3 天"), 3);
  assert.equal(durationToDays("1 周"), 7);
  assert.equal(durationToDays("2 周"), 14);
  assert.equal(durationToDays("1 个月"), 30);
  assert.equal(durationToDays("3 个月"), 90);
});

test("local daily plan covers the full period and includes learning materials", () => {
  const input = normalizeInput({ topic: "机器学习", duration: "2 周" });
  const plan = runLocalAgents(input);

  assert.equal(plan.dailyPlan.length, 14);
  assert.ok(plan.dailyPlan.every((day) => day.tasks.length === 3));
  assert.ok(plan.dailyPlan.every((day) => day.materials.length === 3));
  assert.ok(plan.dailyPlan.every((day) => day.materials[0].sections.length >= 5));
  assert.ok(plan.dailyPlan.every((day) => day.materials[1].sections.some((section) => section.steps?.length >= 4)));
  assert.ok(plan.dailyPlan.every((day) => day.materials[2].questions.length >= 3));
});

test("generic courses use semantic concept names instead of numbered placeholders", () => {
  const input = normalizeInput({ topic: "项目管理", duration: "3 天" });
  const plan = runLocalAgents(input);
  const visibleText = JSON.stringify({ concepts: plan.knowledgeGraph.concepts, dailyPlan: plan.dailyPlan });

  assert.doesNotMatch(visibleText, /知识点\s*\d+/);
  assert.match(plan.dailyPlan[0].title, /基本术语与问题边界/);
});

test("model-generated daily materials are preserved during plan normalization", () => {
  const fallback = [{
    day: 1,
    title: "本地标题",
    tasks: ["本地任务"],
    materials: [{ title: "本地讲义", content: "本地内容" }]
  }];
  const generated = [{
    day: 1,
    title: "模型标题",
    tasks: ["模型任务 1", "模型任务 2", "模型任务 3"],
    materials: [{ title: "模型讲义", content: "模型生成的针对性内容" }]
  }];

  const [day] = normalizeDailyPlan(generated, fallback);

  assert.equal(day.title, "模型标题");
  assert.deepEqual(day.materials, generated[0].materials);
});

test("daily plan normalization only falls back when model materials are missing", () => {
  const fallback = [{
    day: 1,
    tasks: ["本地任务"],
    materials: [{ title: "本地讲义" }]
  }];

  const [day] = normalizeDailyPlan([{ day: 1, tasks: [] }], fallback);

  assert.deepEqual(day.tasks, fallback[0].tasks);
  assert.deepEqual(day.materials, fallback[0].materials);
});

test("partial model batches are matched by day number instead of array position", () => {
  const fallback = Array.from({ length: 3 }, (_, index) => ({
    day: index + 1,
    title: `本地第 ${index + 1} 天`,
    tasks: ["本地任务"],
    materials: [{ title: "本地讲义" }]
  }));
  const generated = [{
    day: 3,
    title: "模型第 3 天",
    tasks: ["模型任务"],
    materials: [{ title: "模型讲义" }]
  }];

  const normalized = normalizeDailyPlan(generated, fallback);

  assert.equal(normalized[0].title, "本地第 1 天");
  assert.equal(normalized[2].title, "模型第 3 天");
});

test("choice answers can be distributed without changing the correct option", () => {
  const question = {
    type: "choice",
    options: ["正确", "干扰 1", "干扰 2", "干扰 3"],
    answerIndex: 0
  };

  for (const target of [0, 1, 2, 3]) {
    const distributed = redistributeChoiceAnswer(question, target);
    assert.equal(distributed.answerIndex, target);
    assert.equal(distributed.options[target], "正确");
  }
});

test("a quiz distributes its first four choice answers across A through D", () => {
  const quiz = Array.from({ length: 4 }, (_, index) => ({
    id: `choice-${index}`,
    type: "choice",
    options: ["正确", "干扰 1", "干扰 2", "干扰 3"],
    answerIndex: 0
  }));
  const distributed = distributeQuizChoiceAnswers(quiz, "test-round");

  assert.deepEqual(new Set(distributed.map((item) => item.answerIndex)), new Set([0, 1, 2, 3]));
  assert.ok(distributed.every((item) => item.options[item.answerIndex] === "正确"));
});
