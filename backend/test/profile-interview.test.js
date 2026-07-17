import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceProfileInterviewLocally,
  buildProfilePreview,
  createProfileInterviewState,
  extractProfileFields
} from "../src/profile-interview.js";

test("对话式画像能从自然语言抽取学习主题、背景、时间和偏好", () => {
  const draft = extractProfileFields(
    "我是计算机专业大二学生，想学机器学习基础，了解一点但数学和模型评估不熟悉，希望一个月完成预测项目，每天1小时，喜欢案例和项目实战。"
  );
  assert.equal(draft.topic, "机器学习基础");
  assert.equal(draft.major, "计算机");
  assert.equal(draft.level, "入门");
  assert.equal(draft.duration, "一个月");
  assert.equal(draft.dailyMinutes, "60 分钟");
  assert.equal(draft.style, "案例驱动");
  assert.match(draft.goal, /一个月完成预测项目/);
  assert.match(draft.weaknesses, /数学和模型评估/);
});

test("画像访谈只追问缺失信息并形成六维证据预览", () => {
  const initial = createProfileInterviewState();
  assert.equal(initial.completeness.percent, 0);
  assert.match(initial.nextQuestion, /课程或主题/);

  const result = advanceProfileInterviewLocally({
    message: "我想学数据结构与算法，目前零基础",
    draft: initial.draft,
    messages: initial.messages
  });
  assert.equal(result.draft.topic, "数据结构与算法");
  assert.equal(result.draft.level, "零基础");
  assert.equal(result.profilePreview.dimensions.length, 6);
  assert.ok(result.completeness.percent >= 32);
  assert.ok(!result.completeness.missing.includes("topic"));
  assert.ok(result.messages.some((item) => item.role === "student"));
});

test("画像预览保留分数、置信度和证据来源", () => {
  const preview = buildProfilePreview({
    topic: "操作系统",
    major: "软件工程",
    level: "进阶",
    style: "项目实战",
    weaknesses: "进程同步和代码实践薄弱"
  });
  assert.equal(preview.dimensions.length, 6);
  preview.dimensions.forEach((item) => {
    assert.ok(item.score >= 0 && item.score <= 100);
    assert.ok(item.confidence > 0);
    assert.equal(item.source, "profile-interview");
    assert.ok(item.evidence.length > 5);
  });
});
