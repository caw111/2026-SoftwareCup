import assert from "node:assert/strict";
import test from "node:test";

import { summarizeLearningActivity } from "../src/learning-activity.js";

test("真实连续天数按用户时区自然日和有效学习事件计算", () => {
  const summary = summarizeLearningActivity([
    { id: "e1", planId: "p1", type: "task_completed", occurredAt: "2026-07-15T08:30:00.000Z", payload: { taskKey: "a" } },
    { id: "e2", planId: "p1", type: "daily_materials_generated", occurredAt: "2026-07-16T02:00:00.000Z", payload: {} },
    { id: "e3", planId: "p1", type: "quiz_attempt_evaluated", occurredAt: "2026-07-16T13:00:00.000Z", payload: { score: 8, maxScore: 10 } },
    { id: "e4", planId: "p1", type: "diagnostic_completed", occurredAt: "2026-07-17T03:00:00.000Z", payload: { percent: 78 } }
  ], {
    timeZone: "Asia/Shanghai",
    now: "2026-07-17T12:00:00.000Z"
  });

  assert.equal(summary.streak.current, 3);
  assert.equal(summary.streak.longest, 3);
  assert.equal(summary.streak.todayActive, true);
  assert.equal(summary.heatmap.find((day) => day.date === "2026-07-16").score, 4);
  assert.equal(summary.badges.find((badge) => badge.id === "diagnostic-first").unlocked, true);
  assert.equal(summary.badges.find((badge) => badge.id === "streak-3").unlocked, true);
});

test("仅辅助事件不会伪造成真实连续学习", () => {
  const summary = summarizeLearningActivity([
    { id: "e1", planId: "p1", type: "daily_materials_generated", occurredAt: "2026-07-17T03:00:00.000Z", payload: {} },
    { id: "e2", planId: "p1", type: "learning_report_generated", occurredAt: "2026-07-17T04:00:00.000Z", payload: {} }
  ], {
    timeZone: "Asia/Shanghai",
    now: "2026-07-17T12:00:00.000Z"
  });

  assert.equal(summary.streak.current, 0);
  assert.equal(summary.heatmap.find((day) => day.date === "2026-07-17").eventCount, 2);
  assert.equal(summary.heatmap.find((day) => day.date === "2026-07-17").effectiveEventCount, 0);
});
