import assert from "node:assert/strict";
import test from "node:test";

import { MODEL_CONFIG } from "../src/config.js";
import { generateAdaptiveQuiz, runLocalAgents } from "../src/learning.js";

test("自适应练习支持题量、题型和难度配置", async () => {
  MODEL_CONFIG.apiKey = "";
  const input = {
    topic: "机器学习基础",
    goal: "理解训练验证测试划分和评估指标",
    level: "入门",
    duration: "2 周",
    dailyMinutes: "45 分钟",
    style: "题目训练",
    weaknesses: "对评估指标和数据泄漏不熟",
    outputType: "偏重练习和测试"
  };
  const plan = runLocalAgents(input);
  const result = await generateAdaptiveQuiz(input, plan, {}, 2, [], {
    questionCount: 6,
    typeCounts: { choice: 4, short: 2, code: 0 },
    includeCode: false,
    difficulty: "medium",
    knowledgeScope: "weak",
    showHints: true,
    timeLimitSec: 120
  });

  assert.equal(result.mode, "local-bank");
  assert.equal(result.quiz.length, 6);
  assert.equal(result.quiz.filter((item) => item.type === "choice").length, 4);
  assert.equal(result.quiz.filter((item) => item.type === "short").length, 2);
  assert.equal(result.quiz.some((item) => item.type === "code"), false);
  assert.equal(result.quizOptions.questionCount, 6);
  assert.equal(result.quiz.every((item) => item.timeLimitSec === 120), true);
});
