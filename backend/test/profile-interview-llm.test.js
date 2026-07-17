import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceProfileInterviewWithLlm,
  buildProfileInterviewMessages
} from "../src/services/profile-interview-service.js";

const modelConfig = {
  enabled: true,
  model: "profile-test-model",
  wireApi: "responses"
};

test("画像访谈调用 LLM 并同时更新自然回复、结构化字段与证据", async () => {
  let requestedMessages;
  let requestedOptions;
  const result = await advanceProfileInterviewWithLlm({
    message: "我是软件工程大二学生，想系统学习操作系统，每天可以学一小时，喜欢做项目。",
    draft: {},
    messages: []
  }, {
    modelConfig,
    requestModel: async (messages, options) => {
      requestedMessages = messages;
      requestedOptions = options;
      return JSON.stringify({
        assistantMessage: "我了解到你希望以项目方式系统学习操作系统，并且每天可以投入一小时。你希望在多长时间内完成这一阶段？",
        draft: {
          topic: "操作系统",
          major: "软件工程大二",
          dailyMinutes: "1 小时",
          style: "项目实战"
        },
        confidence: { topic: 0.96, major: 0.91, dailyMinutes: 0.95, style: 0.9 },
        evidence: [
          { field: "topic", quote: "想系统学习操作系统" },
          { field: "dailyMinutes", quote: "每天可以学一小时" }
        ],
        nextField: "duration",
        suggestions: ["2 周", "1 个月", "3 个月"]
      });
    }
  });

  assert.equal(result.mode, "llm");
  assert.equal(result.model, "profile-test-model");
  assert.equal(result.draft.topic, "操作系统");
  assert.equal(result.draft.major, "软件工程大二");
  assert.equal(result.draft.dailyMinutes, "60 分钟");
  assert.equal(result.draft.style, "项目实战");
  assert.match(result.messages.at(-1).content, /多长时间/);
  assert.equal(result.messages.at(-1).field, "duration");
  assert.deepEqual(result.suggestions, ["2 周", "1 个月", "3 个月"]);
  assert.equal(result.extractionEvidence.length, 2);
  assert.equal(requestedMessages[0].role, "system");
  assert.equal(requestedMessages.at(-1).role, "user");
  assert.match(requestedMessages.at(-1).content, /操作系统/);
  assert.equal(requestedOptions.maxTokens, 1200);
});

test("画像 LLM 携带最近上下文并允许学生修正旧字段", async () => {
  const input = {
    message: "时间安排改成每天 90 分钟，周期还是一个月。",
    draft: {
      topic: "机器学习",
      dailyMinutes: "45 分钟",
      duration: "1 个月",
      confidence: { dailyMinutes: 0.8 }
    },
    messages: [
      { role: "assistant", content: "你每天能学习多久？" },
      { role: "student", content: "原来计划每天 45 分钟。" }
    ]
  };
  const prompt = buildProfileInterviewMessages(input, {
    completeness: { missing: ["goal", "level"] }
  });
  assert.deepEqual(prompt.slice(-3).map((item) => item.role), ["assistant", "user", "user"]);
  assert.match(prompt[0].content, /45 分钟/);

  const result = await advanceProfileInterviewWithLlm(input, {
    modelConfig,
    requestModel: async () => JSON.stringify({
      assistantMessage: "好的，每日学习时间已经调整为 90 分钟。你完成课程后最想交付什么成果？",
      draft: { dailyMinutes: "90 分钟", duration: "1 个月", topic: "机器学习" },
      confidence: { dailyMinutes: 0.98 },
      evidence: [{ field: "dailyMinutes", quote: "改成每天 90 分钟" }],
      nextField: "goal",
      suggestions: ["完成预测项目", "通过课程考试"]
    })
  });
  assert.equal(result.draft.dailyMinutes, "90 分钟");
  assert.equal(result.draft.duration, "1 个月");
  assert.equal(result.draft.topic, "机器学习");
  assert.equal(result.draft.confidence.dailyMinutes, 0.98);
});

test("LLM 返回无效内容时明确降级且不丢失学生本轮输入", async () => {
  const result = await advanceProfileInterviewWithLlm({
    message: "我想学数据结构，目前零基础",
    draft: {},
    messages: []
  }, {
    modelConfig,
    requestModel: async () => "这不是 JSON"
  });

  assert.equal(result.mode, "local-fallback");
  assert.equal(result.fallbackReason, "invalid-model-response");
  assert.match(result.warning, /本地规则/);
  assert.equal(result.draft.topic, "数据结构");
  assert.ok(result.messages.some((item) => item.role === "student" && /数据结构/.test(item.content)));
});

test("未配置模型时不发起上游请求并返回可见降级状态", async () => {
  let called = false;
  const result = await advanceProfileInterviewWithLlm({
    message: "我想学计算机网络",
    draft: {},
    messages: []
  }, {
    modelConfig: { enabled: false, model: null, wireApi: "chat" },
    requestModel: async () => {
      called = true;
      return "{}";
    }
  });
  assert.equal(called, false);
  assert.equal(result.mode, "local-fallback");
  assert.equal(result.fallbackReason, "model-not-configured");
});

test("上游短暂 503 时自动重试并恢复 LLM 对话", async () => {
  let calls = 0;
  const result = await advanceProfileInterviewWithLlm({
    message: "我想学数据库系统",
    draft: {},
    messages: []
  }, {
    modelConfig,
    retryDelayMs: 0,
    requestModel: async () => {
      calls += 1;
      if (calls === 1) throw new Error("大模型接口返回 503：Service temporarily unavailable");
      return JSON.stringify({
        assistantMessage: "我知道你想学习数据库系统。你目前有 SQL 基础吗？",
        draft: { topic: "数据库系统" },
        confidence: { topic: 0.95 },
        evidence: [{ field: "topic", quote: "想学数据库系统" }],
        nextField: "level",
        suggestions: ["零基础", "会基础 SQL"]
      });
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.mode, "llm");
  assert.equal(result.llmAttempts, 2);
  assert.equal(result.draft.topic, "数据库系统");
});
