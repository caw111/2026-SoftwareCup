import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdaptiveState,
  buildDiagnosticPretest,
  buildGovernanceReport,
  buildKnowledgeGraph,
  buildRemediationPlan,
  buildPersonalLearningInsights,
  evaluateDiagnosticPretest
} from "../src/adaptive-learning.js";

const input = {
  topic: "机器学习基础",
  goal: "完成一个入门预测项目",
  level: "入门",
  dailyMinutes: "45 分钟"
};

const learnerProfile = {
  summary: "测试画像",
  mastery: [
    { dimension: "先修基础", score: 42, evidence: "自评", source: "estimated" },
    { dimension: "概念理解", score: 46, evidence: "自评", source: "estimated" },
    { dimension: "方法迁移", score: 55, evidence: "自评", source: "estimated" },
    { dimension: "实践应用", score: 58, evidence: "自评", source: "estimated" },
    { dimension: "表达复盘", score: 60, evidence: "自评", source: "estimated" },
    { dimension: "学习自驱", score: 62, evidence: "自评", source: "estimated" }
  ],
  weakestDimensions: [
    { dimension: "先修基础", score: 42 },
    { dimension: "概念理解", score: 46 }
  ]
};

test("知识图谱、诊断前测和补救路径可生成并评分", () => {
  const graph = buildKnowledgeGraph(input, learnerProfile);
  const diagnostic = buildDiagnosticPretest(input, learnerProfile, graph);
  const answers = Object.fromEntries(diagnostic.items.map((item, index) => [
    item.id,
    index === 0 ? item.answerIndex : 1
  ]));
  const result = evaluateDiagnosticPretest({
    input,
    learnerProfile,
    knowledgeGraph: graph,
    diagnosticPretest: diagnostic
  }, answers);

  assert.equal(graph.concepts.length >= 12, true);
  assert.equal(graph.resourceIndex.length >= graph.concepts.length, true);
  assert.equal(diagnostic.items.length >= 8, true);
  assert.equal(diagnostic.items.every((item) => item.conceptId && item.discrimination && item.timeLimitSec), true);
  assert.equal(result.maxScore > 0, true);
  assert.equal(result.score < result.maxScore, true);
  assert.equal(result.model, "diagnostic-irt-bkt-v1");
  assert.equal(typeof result.abilityEstimate, "number");
  assert.equal(result.adaptiveState.weakestConcepts.length > 0, true);
  assert.equal(result.adaptiveState.concepts.every((item) => item.confidence !== undefined && item.nextAction), true);
  assert.equal(result.remediationPlan.sequence.length, 4);
  assert.equal(result.remediationPlan.microLessons.length > 0, true);
  assert.equal(result.remediationPlan.variantItems.length > 0, true);
  assert.equal(result.remediationPlan.retestItems.length > 0, true);
});

test("治理报告和个人学习洞察包含可展示的核心字段", () => {
  const graph = buildKnowledgeGraph(input, learnerProfile);
  const adaptiveState = buildAdaptiveState({ learnerProfile, knowledgeGraph: graph });
  const remediationPlan = buildRemediationPlan(input, graph, learnerProfile);
  const governanceReport = buildGovernanceReport({
    input,
    learnerProfile,
    path: [{}, {}, {}, {}],
    resources: [{}, {}, {}, {}],
    assessment: { quiz: [{}, {}, {}, {}] },
    dailyPlan: [{ tasks: ["a", "b", "c"] }],
    knowledgeGraph: graph
  });
  const personalInsights = buildPersonalLearningInsights({
    input,
    learnerProfile,
    dailyPlan: [{ tasks: ["a", "b", "c"] }],
    assessment: { quiz: [{}, {}, {}, {}] },
    knowledgeGraph: graph,
    governanceReport,
    adaptiveState
  });

  assert.equal(remediationPlan.sequence.length, 4);
  assert.equal(governanceReport.checks.length >= 8, true);
  assert.equal(governanceReport.score > 0, true);
  assert.equal(personalInsights.suggestedPractice.length > 0, true);
  assert.equal(personalInsights.focusTracks.length, 3);
  assert.equal(Array.isArray(personalInsights.reportRows), true);
});
