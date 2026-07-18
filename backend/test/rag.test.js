import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRagContext,
  chunkCourseSource,
  parseCourseSource,
  searchCourseChunks,
  tokenizeForRetrieval,
  validateSourceUpload
} from "../src/rag.js";
import {
  assertModelUsesGrounding,
  buildRagGenerationMetadata,
  runLocalAgents
} from "../src/learning.js";

function upload(filename, content, mimeType = "text/plain") {
  return validateSourceUpload({
    filename,
    mimeType,
    contentBase64: Buffer.from(content, "utf8").toString("base64")
  });
}

test("课程资料上传校验限制格式、空文件和危险路径", () => {
  const valid = upload("../../机器学习讲义.md", "# 第一章\n梯度下降通过损失函数的梯度更新参数。");
  assert.equal(valid.originalName, "机器学习讲义.md");
  assert.equal(valid.extension, ".md");
  assert.equal(valid.byteSize > 0, true);
  assert.match(valid.checksum, /^[a-f0-9]{64}$/);

  assert.throws(() => upload("demo.exe", "bad"), /仅支持/);
  assert.throws(() => validateSourceUpload({ filename: "empty.txt", contentBase64: "" }), /空文件|Base64/);
});

test("Markdown 按章节解析并形成带定位信息的语义分块", async () => {
  const source = upload("神经网络课程.md", [
    "# 反向传播",
    "反向传播利用链式法则计算每层参数的梯度。损失函数衡量预测与标签的差异。",
    "",
    "## 学习率",
    "学习率决定每次参数更新的步长。学习率过大会震荡，过小会收敛缓慢。",
    "",
    "## 正则化",
    "L2 正则化通过惩罚过大的权重降低过拟合风险。"
  ].join("\n"));
  const parsed = await parseCourseSource(source);
  const chunks = chunkCourseSource(parsed.sections, { targetChars: 70, overlapChars: 10 });

  assert.equal(parsed.sections.length, 3);
  assert.equal(parsed.sections[1].title, "学习率");
  assert.equal(parsed.charCount > 50, true);
  assert.equal(chunks.length >= 3, true);
  assert.equal(chunks.every((chunk, index) => chunk.chunkIndex === index), true);
  assert.equal(chunks.some((chunk) => chunk.locator.includes("学习率")), true);
  assert.equal(chunks.some((chunk) => chunk.keywords.includes("学习率")), true);
});

test("中文与英文混合检索按相关性排序并生成可核验引用", () => {
  assert.deepEqual(tokenizeForRetrieval("梯度下降 gradient descent"), [
    "gradient", "descent", "梯度下降", "梯度", "度下", "下降"
  ]);
  const chunks = [
    {
      id: "c1", sourceId: "s1", sourceName: "优化方法.pdf", chunkIndex: 0,
      title: "梯度下降", locator: "第 12 页",
      content: "梯度下降沿损失函数的负梯度方向更新参数，学习率控制每一步的长度。"
    },
    {
      id: "c2", sourceId: "s2", sourceName: "评估指南.docx", chunkIndex: 0,
      title: "分类指标", locator: "正文 · 片段 1",
      content: "准确率、精确率和召回率用于评估分类模型。"
    },
    {
      id: "c3", sourceId: "s1", sourceName: "优化方法.pdf", chunkIndex: 1,
      title: "学习率", locator: "第 13 页",
      content: "学习率过大会导致梯度下降震荡，过小则会让收敛速度变慢。"
    }
  ];
  const results = searchCourseChunks(chunks, "梯度下降的学习率应该如何设置？", { limit: 2 });
  assert.equal(results.length, 2);
  assert.equal(results[0].sourceId, "s1");
  assert.match(results[0].quote, /梯度|学习率/);
  assert.equal(results[0].score >= results[1].score, true);

  const grounding = buildRagContext(results);
  assert.equal(grounding.citations.length, 2);
  assert.equal(grounding.citations[0].id, "S1");
  assert.match(grounding.context, /\[S1\] 优化方法\.pdf/);
  assert.match(grounding.instruction, /不得虚构引用/);
});

test("结构化文件解析器的结果仍经过统一净化和空内容检查", async () => {
  const source = upload("课件.pptx", "placeholder", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  const parsed = await parseCourseSource(source, {
    extractStructured: async () => ({
      sections: [
        { locator: "第 1 页", title: "课程导入", text: "\r\n 监督学习\t \r\n\r\n分类与回归  " },
        { locator: "第 2 页", title: "空白", text: "  " }
      ]
    })
  });
  assert.deepEqual(parsed.sections, [
    { locator: "第 1 页", title: "课程导入", text: "监督学习\n\n分类与回归" }
  ]);

  await assert.rejects(
    () => parseCourseSource(source, { extractStructured: async () => ({ sections: [] }) }),
    /没有提取到可检索文字/
  );
});

test("离线课程也把检索片段写入资源与每日任务而不是只展示文件名", () => {
  const citation = {
    id: "S1",
    sourceId: "source-1",
    chunkId: "chunk-1",
    title: "优化方法讲义.pdf",
    locator: "第 12 页",
    quote: "学习率过大会导致震荡，过小会导致收敛缓慢。"
  };
  const plan = runLocalAgents({
    topic: "梯度下降",
    goal: "能够解释学习率选择",
    level: "入门",
    duration: "3 天",
    dailyMinutes: "45 分钟",
    style: "案例驱动",
    weaknesses: "参数调优",
    knowledgeSources: [{ id: "source-1", name: citation.title }],
    knowledgeGrounding: { citations: [citation] }
  });
  assert.equal(plan.resources[0].type, "课程资料引用");
  assert.match(plan.resources[0].content, /\[S1\]/);
  assert.match(plan.dailyPlan[0].tasks[0], /第 12 页/);
  assert.match(plan.dailyPlan[0].tasks[0], /\[S1\]/);
});

test("课程生成只有真正使用有效引用时才标记为 LLM 全文资料", () => {
  const input = {
    knowledgeGrounding: {
      mode: "full-context",
      sourceCount: 1,
      loadedChunks: 2,
      fullContextChars: 128,
      citations: [{ id: "S1" }, { id: "S2" }]
    }
  };
  assert.deepEqual(assertModelUsesGrounding({ resources: [{ content: "结论 [S2]" }] }, input), ["S2"]);
  assert.throws(() => assertModelUsesGrounding({ resources: [{ content: "没有引用" }] }, input), /没有实际使用/);
  assert.throws(() => assertModelUsesGrounding({ resources: [{ content: "未知 [S9]" }] }, input), /未知/);

  assert.deepEqual(buildRagGenerationMetadata(input, { path: [{ task: "阅读 [S1]" }] }, true), {
    enabled: true,
    llmUsed: true,
    grounded: true,
    mode: "full-context",
    sourceCount: 1,
    loadedChunks: 2,
    fullContextChars: 128,
    searchedChunks: 0,
    candidateCitationIds: ["S1", "S2"],
    usedCitationIds: ["S1"]
  });
});
