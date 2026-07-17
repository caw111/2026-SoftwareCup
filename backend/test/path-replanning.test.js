import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLearningEvidence,
  buildRevisionFromModelProposal,
  dailyPlanShapeSignature,
  shouldProposeReplanning,
  validateRevisionAgainstProgress
} from "../src/path-replanning.js";

const basePlan = {
  id: "plan-a",
  version: 3,
  createdAt: new Date().toISOString(),
  progress: {
    "day-1-task-0": true,
    "day-1-task-1": true,
    "day-1-task-2": true
  },
  quizHistory: [],
  data: {
    input: {
      topic: "机器学习基础",
      dailyMinutes: "45 分钟"
    },
    dailyPlan: [
      {
        day: 1,
        title: "第 1 天：特征与标签",
        focus: "先修基础",
        tasks: ["读讲义", "跟案例", "做练习"]
      },
      {
        day: 2,
        title: "第 2 天：训练集与测试集",
        focus: "概念理解",
        tasks: ["读讲义", "跟案例", "做练习"]
      }
    ],
    diagnosticResult: {
      percent: 42,
      score: 42,
      maxScore: 100,
      conceptMastery: [
        {
          conceptId: "ml-loss",
          conceptTitle: "损失函数",
          dimension: "概念理解",
          masteryScore: 38,
          confidence: 0.62,
          evidence: "诊断未通过"
        }
      ],
      adaptiveState: {
        weakestConcepts: [
          {
            conceptId: "ml-loss",
            title: "损失函数",
            dimension: "概念理解",
            masteryScore: 38,
            confidence: 0.62
          }
        ]
      }
    }
  }
};

test("诊断低分会触发 LLM 路径重规划门控", () => {
  const evidence = buildLearningEvidence(basePlan, {
    triggerType: "diagnostic_completed"
  });
  const decision = shouldProposeReplanning(evidence);

  assert.equal(decision.propose, true);
  assert.match(decision.reason, /诊断得分 42%/);
  assert.equal(evidence.diagnostic.percent, 42);
});

test("证据不足时不会自动触发 LLM 路径重规划", () => {
  const evidence = buildLearningEvidence({
    ...basePlan,
    progress: {},
    quizHistory: [],
    data: {
      ...basePlan.data,
      diagnosticResult: null
    }
  }, {
    triggerType: "quiz_attempt_evaluated"
  });
  const decision = shouldProposeReplanning(evidence);

  assert.equal(decision.propose, false);
  assert.match(decision.reason, /证据不足|无需调整|不足以触发/);
});

test("学习路径签名只比较可执行结构，忽略资料内容变化", () => {
  const left = [{
    day: 1,
    title: "第 1 天：概念",
    focus: "概念理解",
    tasks: ["任务"],
    taskKeys: ["stable-task"],
    materials: [{ title: "旧资料" }]
  }];
  const right = [{
    day: 1,
    title: "第 1 天：概念",
    focus: "概念理解",
    tasks: ["任务"],
    taskKeys: ["stable-task"],
    materials: [{ title: "新资料", content: "重生成讲义" }]
  }];

  assert.equal(dailyPlanShapeSignature(left), dailyPlanShapeSignature(right));
});

test("学习路径签名会归一化默认任务 key 和标题天数前缀", () => {
  const currentPlanShape = [{
    day: 1,
    title: "第1天：概念",
    focus: "概念理解",
    tasks: ["任务 A", "任务 B"]
  }];
  const revisionSnapshotShape = [{
    day: 1,
    title: "第 1 天：概念",
    focus: "概念理解",
    tasks: ["任务 A", "任务 B"],
    taskKeys: ["day-1-task-0", "day-1-task-1"]
  }];

  assert.equal(dailyPlanShapeSignature(currentPlanShape), dailyPlanShapeSignature(revisionSnapshotShape));
});

test("LLM 路径建议会按模型返回内容生成修订，而不是使用固定补救模板", () => {
  const revision = buildRevisionFromModelProposal(basePlan, {
    shouldReplan: true,
    reason: "诊断显示损失函数掌握不足，需要先补齐概念边界。",
    summary: "先插入一日损失函数校准，并把后续训练集任务改成带对比实验的版本。",
    confidence: 0.88,
    insertDays: [{
      afterDay: 1,
      title: "损失函数概念校准",
      estimate: "45 分钟",
      focus: "用反例区分损失函数与评价指标",
      tasks: [
        "画出平方损失、交叉熵和准确率三者的输入输出差异表。",
        "用一个二分类样例解释为什么准确率不能直接作为训练损失。",
        "完成 3 道损失函数选择题，并写下每题排除依据。"
      ],
      checkpoint: "能独立说明训练目标和评估指标的差异。",
      knowledgePoints: ["损失函数", "评价指标"],
      conceptIds: ["ml-loss"],
      reason: "低诊断分集中在损失函数。"
    }],
    updateDays: [{
      day: 2,
      title: "训练集、验证集与对比实验",
      focus: "通过小实验理解数据划分",
      tasks: [
        "比较 7:3 与 8:2 划分对验证分数波动的影响。",
        "记录一次数据泄漏案例，并标出泄漏发生的位置。",
        "用自己的话写出训练集、验证集、测试集的边界。"
      ],
      checkpoint: "能判断一个评估流程是否发生数据泄漏。",
      reason: "后续任务需要承接补强后的损失函数理解。"
    }]
  }, {
    revisionId: "revision-llm-1",
    triggerType: "diagnostic_completed",
    evidence: {
      triggerType: "diagnostic_completed",
      progress: { done: 3, total: 6, percent: 50 },
      current: { day: 2, index: 1, completedDays: 1 },
      diagnostic: { percent: 42 },
      recentWrong: [],
      wrongByDimension: {},
      weakConcepts: [{ conceptId: "ml-loss", title: "损失函数" }]
    },
    model: "unit-test-model"
  });

  assert.equal(revision.createdByAgent, "LLM 路径重规划智能体");
  assert.match(revision.summary, /损失函数校准/);
  assert.equal(revision.diff.insertedDays.length, 1);
  assert.equal(revision.diff.updatedDays.length, 1);
  assert.match(revision.diff.insertedDays[0].tasks[0], /平方损失、交叉熵/);
  assert.match(revision.diff.updatedDays[0].tasks[0], /7:3 与 8:2/);
  assert.doesNotMatch(revision.diff.insertedDays[0].tasks.join("\n"), /回看/);
  assert.deepEqual(validateRevisionAgainstProgress(revision, basePlan.progress), []);
});

test("LLM 路径建议不能改写已完成任务", () => {
  assert.throws(() => buildRevisionFromModelProposal(basePlan, {
    shouldReplan: true,
    summary: "尝试改写已完成第一天",
    confidence: 0.8,
    updateDays: [{
      day: 1,
      tasks: ["把已完成任务改成新内容"]
    }]
  }, {
    revisionId: "revision-unsafe-1",
    evidence: {
      triggerType: "manual",
      progress: { done: 3, total: 6, percent: 50 },
      current: { day: 2, index: 1, completedDays: 1 }
    }
  }), /未返回可执行|安全校验|已完成/);
});

test("用户强制要求 LLM 重新检查时，不接受空建议", () => {
  assert.throws(() => buildRevisionFromModelProposal(basePlan, {
    shouldReplan: false,
    reason: "当前无需调整",
    summary: "不调整",
    confidence: 0.6,
    insertDays: [],
    updateDays: []
  }, {
    revisionId: "revision-force-empty",
    requireOperationalProposal: true,
    evidence: {
      triggerType: "manual",
      progress: { done: 3, total: 6, percent: 50 },
      current: { day: 2, index: 1, completedDays: 1 }
    }
  }), /必须返回至少一个可执行路径建议/);
});
