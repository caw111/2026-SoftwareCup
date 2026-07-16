import test from "node:test";
import assert from "node:assert/strict";

import { distributeQuizChoiceAnswers, durationToDays, normalizeInput, redistributeChoiceAnswer, runLocalAgents } from "../src/learning.js";

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
