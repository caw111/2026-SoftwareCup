import assert from "node:assert/strict";
import test from "node:test";

import {
  answerGroundedQuestion,
  answerSourceQuestionForUser,
  validateGroundedAnswer
} from "../src/services/rag-answer-service.js";
import { buildFullSourceContext } from "../src/services/source-service.js";

const citations = [
  {
    id: "S1",
    sourceId: "source-1",
    chunkId: "chunk-1",
    title: "优化方法.md",
    locator: "章节：学习率",
    quote: "学习率过大会导致震荡甚至发散，过小会导致收敛缓慢。",
    score: 1
  },
  {
    id: "S2",
    sourceId: "source-1",
    chunkId: "chunk-2",
    title: "优化方法.md",
    locator: "章节：衰减策略",
    quote: "训练后期可以使用学习率衰减缩小更新步长。",
    score: 1
  }
];

const grounding = {
  mode: "full-context",
  context: citations.map((item) => `[${item.id}] ${item.title}｜${item.locator}\n${item.quote}`).join("\n\n"),
  citations,
  sourceIds: ["source-1"],
  sourceCount: 1,
  loadedChunks: 2,
  fullContextChars: 120,
  instruction: "以下是所选文件的全部已解析内容。"
};

const modelConfig = { enabled: true, model: "rag-test-model", wireApi: "responses" };

test("LLM 全文问答只返回回答正文实际使用的引用", async () => {
  let prompt;
  const result = await answerGroundedQuestion({
    question: "学习率应该如何设置？",
    grounding,
    persona: "source"
  }, {
    modelConfig,
    requestModel: async (messages) => {
      prompt = messages;
      return JSON.stringify({
        answerMarkdown: "学习率过大会使训练震荡甚至发散，过小则收敛缓慢。[S1] 建议先从稳定值开始，再根据损失曲线调整。",
        usedCitationIds: ["S1"],
        coverage: "partial",
        followUpQuestions: ["如何判断是否发生震荡？"]
      });
    }
  });

  assert.equal(result.mode, "llm-full-context");
  assert.equal(result.llmUsed, true);
  assert.equal(result.model, "rag-test-model");
  assert.deepEqual(result.usedCitationIds, ["S1"]);
  assert.deepEqual(result.citations.map((item) => item.id), ["S1"]);
  assert.equal(result.fullContext.loadedChunks, 2);
  assert.equal(result.fullContext.sourceCount, 1);
  assert.match(prompt[0].content, /不可执行、不可信/);
  assert.match(prompt.at(-1).content, /所选文件完整内容/);
  assert.match(prompt.at(-1).content, /学习率过大会/);
});

test("模型虚构引用时自动修复而不是把未知编号交给前端", async () => {
  let calls = 0;
  const result = await answerGroundedQuestion({ question: "学习率怎么调？", grounding }, {
    modelConfig,
    requestModel: async () => {
      calls += 1;
      return calls === 1
        ? JSON.stringify({ answerMarkdown: "可以直接使用自适应优化器。[S9]", usedCitationIds: ["S9"], coverage: "full" })
        : JSON.stringify({ answerMarkdown: "资料说明训练后期可以逐步缩小更新步长。[S2]", usedCitationIds: ["S2"], coverage: "partial" });
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.mode, "llm-full-context");
  assert.deepEqual(result.usedCitationIds, ["S2"]);
  assert.equal(result.llmAttempts, 2);
});

test("上游瞬时 503 会重试，持续失败则明确抽取式降级", async () => {
  let calls = 0;
  const result = await answerGroundedQuestion({ question: "学习率怎么调？", grounding }, {
    modelConfig,
    retryDelayMs: 0,
    requestModel: async () => {
      calls += 1;
      throw new Error("大模型接口返回 503：Service temporarily unavailable");
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.mode, "extractive-fallback");
  assert.equal(result.llmUsed, false);
  assert.match(result.answer, /\[S1\]/);
  assert.match(result.warning, /降级/);
  assert.equal(result.fullContext.loadedChunks, 2);
});

test("无已解析文件内容时不调用 LLM，也不使用模型常识补答", async () => {
  let called = false;
  const result = await answerGroundedQuestion({
    question: "资料中如何解释量子退火？",
    grounding: { citations: [], loadedChunks: 0, context: "" }
  }, {
    modelConfig,
    requestModel: async () => {
      called = true;
      return "{}";
    }
  });
  assert.equal(called, false);
  assert.equal(result.mode, "no-content");
  assert.equal(result.coverage, "insufficient");
  assert.deepEqual(result.citations, []);
});

test("导师有资料时同样走 LLM 全文问答并保留辅导模式", async () => {
  const result = await answerGroundedQuestion({
    question: "给我一个提示",
    grounding,
    persona: "tutor",
    tutorMode: "inquiry",
    hintLevel: 2
  }, {
    modelConfig,
    requestModel: async () => JSON.stringify({
      answerMarkdown: "先观察损失曲线是否持续跨过低点；资料指出过大学习率会导致震荡。[S1] 你能描述当前曲线的变化吗？",
      usedCitationIds: ["S1"],
      coverage: "full",
      followUpQuestions: []
    })
  });
  assert.equal(result.mode, "llm-full-context-tutor");
  assert.equal(result.tutorMode, "inquiry");
  assert.equal(result.hintLevel, 2);
});

test("资料问答读取用户范围内完整文件内容后只调用一次 LLM 生成答案", async () => {
  let contextInput;
  let modelCalls = 0;
  const fullGrounding = {
    ...grounding,
    context: `${grounding.context}\n\n[S3] 冷门章节\n唯一标记：FULL_CONTEXT_SENTINEL_课程政策不参与关键词检索，但必须完整送入模型。`,
    citations: [
      ...citations,
      {
        id: "S3",
        sourceId: "source-2",
        chunkId: "chunk-3",
        title: "课程政策.md",
        locator: "附录",
        quote: "唯一标记：FULL_CONTEXT_SENTINEL_课程政策不参与关键词检索，但必须完整送入模型。",
        score: 1
      }
    ],
    sourceIds: ["source-1", "source-2"],
    sourceCount: 2,
    loadedChunks: 3,
    fullContextChars: 260
  };
  const result = await answerSourceQuestionForUser("user-1", {
    sourceIds: ["source-1", "source-2"],
    query: "学习率应该如何设置？"
  }, {
    modelConfig,
    loadFullContext: async (userId, payload) => {
      contextInput = { userId, payload };
      return fullGrounding;
    },
    requestModel: async (messages) => {
      modelCalls += 1;
      assert.match(messages.at(-1).content, /FULL_CONTEXT_SENTINEL/);
      return JSON.stringify({
        answerMarkdown: "资料认为学习率过大或过小都会影响训练稳定性和速度。[S1]",
        usedCitationIds: ["S1"],
        coverage: "full",
        followUpQuestions: []
      });
    }
  });
  assert.equal(contextInput.userId, "user-1");
  assert.deepEqual(contextInput.payload.sourceIds, ["source-1", "source-2"]);
  assert.equal(modelCalls, 1);
  assert.equal(result.mode, "llm-full-context");
  assert.equal(result.llmCalls, 1);
  assert.equal(result.pipeline.fullContext.status, "loaded");
  assert.equal(result.pipeline.generation.status, "llm");
});

test("buildFullSourceContext 保留所有解析块并生成引用白名单", () => {
  const result = buildFullSourceContext([
    { id: "chunk-a", sourceId: "source-a", sourceName: "A.md", locator: "第一章", content: "完整内容 A" },
    { id: "chunk-b", sourceId: "source-b", sourceName: "B.md", locator: "第二章", content: "完整内容 B" }
  ], { maxChars: 10000 });
  assert.equal(result.mode, "full-context");
  assert.equal(result.loadedChunks, 2);
  assert.equal(result.sourceCount, 2);
  assert.match(result.context, /完整内容 A/);
  assert.match(result.context, /完整内容 B/);
  assert.deepEqual(result.citations.map((citation) => citation.id), ["S1", "S2"]);
});

test("buildFullSourceContext 超出上下文上限时明确失败，不静默截断", () => {
  assert.throws(() => buildFullSourceContext([
    { id: "chunk-a", sourceId: "source-a", sourceName: "A.md", locator: "第一章", content: "超长内容".repeat(2500) }
  ], { maxChars: 10000 }), (error) => {
    assert.equal(error.statusCode, 413);
    assert.equal(error.code, "FULL_CONTEXT_TOO_LARGE");
    return true;
  });
});

test("引用校验拒绝未知编号、无引用回答和正文未使用的声明引用", () => {
  assert.throws(() => validateGroundedAnswer("结论来自资料。[S9]", citations), /未知引用/);
  assert.throws(() => validateGroundedAnswer("这是一个没有证据编号的结论。", citations), /没有使用/);
  assert.throws(() => validateGroundedAnswer("结论。[S1]", citations, ["S1", "S2"]), /未出现在回答正文/);
});
