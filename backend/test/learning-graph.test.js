import assert from "node:assert/strict";
import test from "node:test";

import { buildKnowledgeGraphView } from "../src/learning-graph.js";

const plan = {
  id: "plan-graph",
  title: "机器学习基础",
  progress: { "day-1-task-0": true },
  quizHistory: [{
    questionId: "q1",
    conceptId: "ml-loss",
    type: "choice",
    dimension: "概念理解",
    correct: false,
    score: 4,
    maxScore: 10,
    at: "2026-07-17T08:00:00.000Z"
  }],
  data: {
    input: { topic: "机器学习基础", goal: "掌握训练流程" },
    knowledgeGraph: {
      concepts: [
        {
          id: "ml-pipeline",
          title: "训练流程",
          dimension: "先修基础",
          masteryScore: 72,
          confidence: 0.6
        },
        {
          id: "ml-loss",
          title: "损失函数",
          dimension: "概念理解",
          masteryScore: 42,
          confidence: 0.7,
          prerequisites: ["ml-pipeline"]
        }
      ],
      edges: [{ source: "ml-pipeline", target: "ml-loss", relation: "prerequisite" }]
    },
    adaptiveState: {
      concepts: [
        {
          conceptId: "ml-loss",
          title: "损失函数",
          dimension: "概念理解",
          masteryScore: 38,
          confidence: 0.72,
          nextAction: "用反例区分损失函数和评价指标。"
        }
      ]
    },
    dailyPlan: [
      {
        day: 1,
        title: "训练流程",
        tasks: ["画出训练流程图", "解释损失函数"],
        conceptIds: ["ml-pipeline", "ml-loss"]
      }
    ]
  }
};

test("知识图谱视图连接真实概念、任务、测评和先修关系", () => {
  const graph = buildKnowledgeGraphView(plan);
  const loss = graph.nodes.find((node) => node.id === "ml-loss");

  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(loss.masteryScore, 38);
  assert.equal(loss.tasks[0].title, "解释损失函数");
  assert.equal(loss.quizzes[0].score, 4);
  assert.match(loss.nextAction, /反例区分/);
});
