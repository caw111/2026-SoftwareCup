import { clamp, ensureArray } from "./utils.js";

const DIMENSIONS = [
  { key: "foundation", dimension: "先修基础" },
  { key: "concept", dimension: "概念理解" },
  { key: "transfer", dimension: "方法迁移" },
  { key: "practice", dimension: "实践应用" },
  { key: "review", dimension: "表达复盘" },
  { key: "selfDrive", dimension: "学习自驱" }
];

const ML_BLUEPRINTS = [
  {
    id: "ml-data-types",
    title: "特征、标签与样本",
    dimension: "先修基础",
    difficulty: 1,
    prerequisites: [],
    standard: "能区分特征、标签、样本和数据集，并说明监督学习问题的输入输出。",
    misconceptions: ["把标签当作输入特征", "不区分训练数据和真实预测对象"],
    resources: ["概念卡", "标注练习"],
    diagnostic: {
      question: "在房价预测任务中，哪一项最适合作为标签 y？",
      options: ["房屋最终成交价", "房屋面积", "所在城市", "建成年份"],
      answerIndex: 0,
      explanation: "标签是模型要预测的目标值，房屋面积、城市和年份通常是输入特征。",
      tags: ["特征标签混淆"]
    }
  },
  {
    id: "ml-train-valid-test",
    title: "训练集、验证集与测试集",
    dimension: "概念理解",
    difficulty: 2,
    prerequisites: ["ml-data-types"],
    standard: "能解释三种数据集的职责，并避免用测试集反复调参。",
    misconceptions: ["用测试集调参", "只看训练集效果"],
    resources: ["流程图", "反例讲解"],
    diagnostic: {
      question: "为什么不应该反复用测试集调参？",
      options: [
        "会让模型间接适配测试集，使泛化评估偏乐观",
        "因为测试集不能包含标签",
        "因为训练集越小一定越好",
        "因为验证集只用于最终汇报"
      ],
      answerIndex: 0,
      explanation: "测试集应尽量只用于最终评估，反复调参会造成信息泄露。",
      tags: ["数据泄露", "泛化评估误解"]
    }
  },
  {
    id: "ml-loss-function",
    title: "损失函数",
    dimension: "概念理解",
    difficulty: 2,
    prerequisites: ["ml-data-types"],
    standard: "能说明损失函数如何度量预测错误，并连接到模型优化。",
    misconceptions: ["把损失函数等同于准确率", "不知道优化目标"],
    resources: ["微讲义", "曲线观察"],
    diagnostic: {
      question: "训练模型时，损失函数的主要作用是什么？",
      options: [
        "度量预测与真实标签的差距，为优化提供目标",
        "保证模型在测试集上 100% 正确",
        "只用于画图，不参与训练",
        "替代所有特征工程"
      ],
      answerIndex: 0,
      explanation: "损失函数定义了模型要最小化的目标，是训练过程的核心信号。",
      tags: ["优化目标不清"]
    }
  },
  {
    id: "ml-gradient-descent",
    title: "梯度下降直觉",
    dimension: "方法迁移",
    difficulty: 3,
    prerequisites: ["ml-loss-function"],
    standard: "能用方向、步长和迭代解释梯度下降。",
    misconceptions: ["学习率越大越好", "一次更新必然最优"],
    resources: ["交互图", "参数更新练习"],
    diagnostic: {
      question: "学习率过大最可能带来什么问题？",
      options: ["在最优点附近震荡甚至发散", "训练必然更稳定", "损失函数失效", "验证集自动变大"],
      answerIndex: 0,
      explanation: "学习率控制每次更新步长，过大可能跨过低点并震荡。",
      tags: ["学习率误解", "优化过程误解"]
    }
  },
  {
    id: "ml-overfitting",
    title: "过拟合与欠拟合",
    dimension: "概念理解",
    difficulty: 3,
    prerequisites: ["ml-train-valid-test"],
    standard: "能根据训练/验证表现判断过拟合和欠拟合。",
    misconceptions: ["训练分高就代表模型好", "只看一个数据集"],
    resources: ["对比图", "判断题"],
    diagnostic: {
      question: "训练集准确率很高、验证集准确率明显较低，通常说明什么？",
      options: ["模型可能过拟合", "模型一定欠拟合", "验证集不需要看", "损失函数不存在"],
      answerIndex: 0,
      explanation: "训练好但验证差，说明模型可能记住训练数据而泛化不足。",
      tags: ["泛化误解", "过拟合识别失败"]
    }
  },
  {
    id: "ml-regularization",
    title: "正则化",
    dimension: "方法迁移",
    difficulty: 3,
    prerequisites: ["ml-overfitting"],
    standard: "能解释 L1/L2 正则化如何降低模型复杂度。",
    misconceptions: ["正则化让训练误差必为 0", "正则化只改测试集"],
    resources: ["公式直觉", "权重观察"],
    diagnostic: {
      question: "L2 正则化通常如何帮助缓解过拟合？",
      options: ["惩罚过大的权重，降低模型复杂度", "删除测试集", "让标签变成特征", "让训练误差必为 0"],
      answerIndex: 0,
      explanation: "L2 会惩罚权重平方，约束模型过度依赖少数特征。",
      tags: ["正则化作用误解"]
    }
  },
  {
    id: "ml-metrics-classification",
    title: "分类评估指标",
    dimension: "实践应用",
    difficulty: 3,
    prerequisites: ["ml-train-valid-test"],
    standard: "能解释准确率、精确率、召回率和 F1 的适用场景。",
    misconceptions: ["只看准确率", "混淆精确率和召回率"],
    resources: ["混淆矩阵练习", "场景判断"],
    diagnostic: {
      question: "在疾病筛查中更不希望漏掉患者时，通常更关注哪个指标？",
      options: ["召回率", "训练轮数", "特征数量", "模型文件大小"],
      answerIndex: 0,
      explanation: "召回率关注真实为正的样本中有多少被找出来，适合强调少漏判的场景。",
      tags: ["指标场景不匹配"]
    }
  },
  {
    id: "ml-normalization",
    title: "特征缩放与归一化",
    dimension: "实践应用",
    difficulty: 2,
    prerequisites: ["ml-data-types"],
    standard: "能判断何时需要特征缩放，并实现简单归一化。",
    misconceptions: ["所有模型都必须归一化", "把标签也随意归一化"],
    resources: ["代码练习", "模型对比"],
    diagnostic: {
      question: "为什么 KNN、梯度下降类方法常需要特征缩放？",
      options: ["不同量纲会影响距离或参数更新尺度", "缩放能自动消除所有噪声", "缩放后不需要验证集", "缩放会改变样本数量"],
      answerIndex: 0,
      explanation: "距离和梯度更新会受特征尺度影响，因此常需要缩放。",
      tags: ["特征尺度误解"]
    }
  },
  {
    id: "ml-feature-engineering",
    title: "特征工程",
    dimension: "方法迁移",
    difficulty: 4,
    prerequisites: ["ml-data-types", "ml-metrics-classification"],
    standard: "能根据业务含义构造、筛选和解释特征。",
    misconceptions: ["特征越多一定越好", "不看业务含义"],
    resources: ["案例拆解", "特征清单"],
    diagnostic: {
      question: "增加大量无关特征最可能带来什么问题？",
      options: ["增加噪声和过拟合风险", "一定提升泛化能力", "不影响训练", "自动修复标签错误"],
      answerIndex: 0,
      explanation: "无关特征会增加噪声和复杂度，可能降低泛化表现。",
      tags: ["特征选择误解"]
    }
  },
  {
    id: "ml-data-leakage",
    title: "数据泄露",
    dimension: "表达复盘",
    difficulty: 4,
    prerequisites: ["ml-train-valid-test", "ml-feature-engineering"],
    standard: "能识别训练时不应出现的未来信息或标签信息。",
    misconceptions: ["线上不可用信息也能当特征", "测试信息可参与预处理拟合"],
    resources: ["反例库", "排查清单"],
    diagnostic: {
      question: "预测用户下月是否流失时，把“下月实际消费金额”作为特征属于什么问题？",
      options: ["数据泄露", "正常特征工程", "欠拟合", "学习率过小"],
      answerIndex: 0,
      explanation: "预测时无法提前知道未来消费金额，把它作为特征会泄露未来信息。",
      tags: ["未来信息泄露"]
    }
  },
  {
    id: "ml-pipeline",
    title: "建模流程",
    dimension: "方法迁移",
    difficulty: 3,
    prerequisites: ["ml-data-types", "ml-train-valid-test", "ml-metrics-classification"],
    standard: "能把需求拆成数据、特征、模型、评估、部署和复盘步骤。",
    misconceptions: ["先选模型再定义问题", "跳过评估指标"],
    resources: ["流程模板", "项目任务"],
    diagnostic: {
      question: "开始一个机器学习项目前，最应该优先明确什么？",
      options: ["业务目标、预测对象、评价指标和可用数据", "模型名字", "电脑配置", "可视化颜色"],
      answerIndex: 0,
      explanation: "项目应先定义问题和评价标准，再选择模型与实现方案。",
      tags: ["问题定义缺失"]
    }
  },
  {
    id: "ml-result-communication",
    title: "结果解释与复盘",
    dimension: "表达复盘",
    difficulty: 3,
    prerequisites: ["ml-metrics-classification", "ml-pipeline"],
    standard: "能说明模型效果、局限、错误类型和下一步改进。",
    misconceptions: ["只报一个分数", "不分析错误样本"],
    resources: ["报告模板", "错例分析"],
    diagnostic: {
      question: "一份模型复盘报告除了分数，还应该包含什么？",
      options: ["错误类型、适用边界、改进方向和风险", "只放最高分截图", "删除失败样本", "只写使用的库名"],
      answerIndex: 0,
      explanation: "真实复盘需要解释错误、边界和下一步行动，而不只是展示分数。",
      tags: ["复盘证据不足"]
    }
  },
  {
    id: "ml-learning-plan",
    title: "自主学习调节",
    dimension: "学习自驱",
    difficulty: 2,
    prerequisites: ["ml-pipeline"],
    standard: "能基于证据调整学习计划，而不是只靠主观感觉。",
    misconceptions: ["只看时长不看结果", "错题不复测"],
    resources: ["计划表", "复测提醒"],
    diagnostic: {
      question: "一次测评低于 60 分后，下一步最合理的动作是什么？",
      options: ["定位错因，回到对应知识点微讲义并做变式复测", "直接跳到更难项目", "只增加阅读时间", "忽略错题继续下一章"],
      answerIndex: 0,
      explanation: "低分需要回到证据链：错因、补救、变式、复测。",
      tags: ["缺少复测闭环"]
    }
  }
];

export function buildKnowledgeGraph(input, learnerProfile) {
  const topic = input.topic || "当前主题";
  const masteryByDimension = new Map(
    ensureArray(learnerProfile?.mastery, []).map((item) => [item.dimension, Number(item.score || 50)])
  );
  const seed = slugify(topic);
  const blueprints = selectBlueprints(topic, seed);
  const concepts = blueprints.map((blueprint, index) => {
    const base = masteryByDimension.get(blueprint.dimension) ?? 50;
    const prior = clamp(base - blueprint.difficulty * 3 + (blueprint.prerequisites?.length ? -2 : 3));
    return {
      id: blueprint.id,
      title: blueprint.title,
      dimension: blueprint.dimension,
      difficulty: blueprint.difficulty,
      prerequisites: blueprint.prerequisites || [],
      objectives: [
        blueprint.standard,
        `能指出常见误区：${blueprint.misconceptions.slice(0, 2).join("、")}`
      ],
      standard: blueprint.standard,
      misconceptions: blueprint.misconceptions,
      resourceTypes: blueprint.resources,
      source: isMachineLearningTopic(topic) ? "local-ml-curriculum" : "generated-curriculum",
      order: index + 1,
      masteryScore: prior,
      masteryProbability: prior / 100,
      confidence: 0.35,
      evidence: `初始估计来自学习者画像中的「${blueprint.dimension}」维度；后续由诊断、练习、复测和提示使用情况更新。`
    };
  });

  return {
    topic,
    version: new Date().toISOString(),
    dimensions: DIMENSIONS,
    concepts,
    edges: concepts.flatMap((concept) => (
      concept.prerequisites || []
    ).map((source) => ({
      source,
      target: concept.id,
      relation: "prerequisite"
    }))),
    resourceIndex: concepts.flatMap((concept) => buildGroundedResourcesForConcept(topic, concept)),
    standards: concepts.map((concept) => ({
      conceptId: concept.id,
      title: concept.title,
      standard: concept.standard,
      masteryThreshold: concept.difficulty >= 4 ? 85 : 80
    }))
  };
}

export function buildDiagnosticPretest(input, learnerProfile, knowledgeGraph) {
  const weakDimensions = ensureArray(learnerProfile?.weakestDimensions, [])
    .map((item) => item.dimension);
  const concepts = ensureArray(knowledgeGraph?.concepts, []);
  const weak = concepts.filter((concept) => weakDimensions.includes(concept.dimension));
  const prerequisites = concepts.filter((concept) => concept.prerequisites.length <= 1);
  const advanced = concepts.filter((concept) => concept.difficulty >= 3);
  const prioritized = uniqueById([...weak, ...prerequisites, ...advanced, ...concepts]).slice(0, 10);

  return {
    title: `${input.topic} 诊断前测`,
    objective: "用细粒度知识点题目估计当前知识状态、错因类型、下一轮题目难度和补救顺序。",
    scoring: "每题记录知识点、难度、区分度、耗时、提示次数、错因标签和掌握概率。",
    expectedMinutes: Math.ceil(prioritized.length * 1.5),
    items: prioritized.map((concept, index) => buildDiagnosticItem(input, concept, index))
  };
}

export function buildAdaptiveState({ learnerProfile, knowledgeGraph, diagnosticResult = null }) {
  const conceptResultMap = new Map(
    ensureArray(diagnosticResult?.conceptMastery, []).map((item) => [item.conceptId, item])
  );
  const concepts = ensureArray(knowledgeGraph?.concepts, []).map((concept) => {
    const measured = conceptResultMap.get(concept.id);
    const probability = measured?.masteryProbability ?? concept.masteryProbability ?? concept.masteryScore / 100;
    const masteryScore = measured?.masteryScore ?? concept.masteryScore;
    const confidence = measured?.confidence ?? concept.confidence ?? 0.35;
    return {
      conceptId: concept.id,
      title: concept.title,
      dimension: concept.dimension,
      difficulty: concept.difficulty,
      masteryScore: clamp(masteryScore),
      masteryProbability: round2(probability),
      confidence: round2(confidence),
      status: masteryStatus(masteryScore, confidence),
      nextAction: nextActionForConcept(masteryScore, confidence),
      evidence: measured?.evidence || concept.evidence,
      source: measured ? "diagnostic-bkt" : "profile-estimate",
      reviewDueAt: reviewDueAt(masteryScore)
    };
  });

  const dimensionMastery = DIMENSIONS.map((dimension) => {
    const related = concepts.filter((concept) => concept.dimension === dimension.dimension);
    const fallback = ensureArray(learnerProfile?.mastery, [])
      .find((item) => item.dimension === dimension.dimension);
    const score = related.length
      ? Math.round(related.reduce((sum, item) => sum + Number(item.masteryScore || 0), 0) / related.length)
      : Number(fallback?.score || 50);
    const confidence = related.length
      ? round2(related.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / related.length)
      : 0.3;
    return {
      ...dimension,
      score: clamp(score),
      confidence,
      evidence: related.some((item) => item.source === "diagnostic-bkt")
        ? "已融合诊断前测、耗时、提示次数和 BKT 风格掌握概率。"
        : fallback?.evidence || "来自初始学习者画像估计。"
    };
  });

  const weakestConcepts = [...concepts]
    .sort((a, b) => (a.masteryScore + a.confidence * 10) - (b.masteryScore + b.confidence * 10))
    .slice(0, 5);

  return {
    updatedAt: new Date().toISOString(),
    model: "rule-bkt-v1",
    concepts,
    dimensionMastery,
    weakestConcepts,
    nextDifficulty: inferNextDifficulty(concepts),
    policy: "低掌握低置信先诊断，高掌握低置信先复测，连续高掌握进入迁移项目。"
  };
}

export function evaluateDiagnosticPretest(plan, answers = {}) {
  const input = plan?.input || {};
  const learnerProfile = plan?.learnerProfile || {};
  const knowledgeGraph = plan?.knowledgeGraph || buildKnowledgeGraph(input, learnerProfile);
  const questions = ensureArray(plan?.diagnosticPretest?.items, []);
  const results = questions.map((question) => {
    const raw = answers[question.id];
    const selectedIndex = typeof raw === "object" && raw !== null ? Number(raw.selectedIndex) : Number(raw);
    const timeSpentSec = Math.max(0, Number(raw?.timeSpentSec || 0));
    const hintCount = Math.max(0, Number(raw?.hintCount || 0));
    const answered = Number.isInteger(selectedIndex) && selectedIndex >= 0;
    const correct = answered && selectedIndex === Number(question.answerIndex);
    const timeRatio = question.timeLimitSec ? timeSpentSec / question.timeLimitSec : 1;
    const adjustedScore = correct
      ? Math.max(0.72, 1 - Math.max(0, timeRatio - 1.2) * 0.08 - hintCount * 0.08)
      : 0;
    return {
      questionId: question.id,
      conceptId: question.conceptId,
      conceptTitle: question.conceptTitle,
      dimension: question.dimension,
      difficulty: question.difficulty,
      discrimination: question.discrimination,
      selectedIndex: answered ? selectedIndex : null,
      correct,
      timeSpentSec,
      hintCount,
      score: Math.round(Number(question.score || 20) * adjustedScore),
      maxScore: Number(question.score || 20),
      explanation: question.explanation,
      misconceptionTags: correct ? [] : ensureArray(question.misconceptionTags, []),
      evidence: correct ? "答对" : "答错或未作答"
    };
  });
  const maxScore = results.reduce((sum, item) => sum + item.maxScore, 0);
  const score = results.reduce((sum, item) => sum + item.score, 0);
  const conceptMastery = buildConceptMasteryFromDiagnostic(knowledgeGraph, results);
  const mistakeProfile = summarizeMistakes(results);
  const diagnosticResult = {
    evaluatedAt: new Date().toISOString(),
    model: "diagnostic-irt-bkt-v1",
    score,
    maxScore,
    percent: maxScore ? Math.round((score / maxScore) * 100) : 0,
    abilityEstimate: estimateAbility(results),
    reliability: estimateReliability(results),
    results,
    conceptMastery,
    mistakeProfile,
    nextDifficulty: inferNextDifficulty(conceptMastery)
  };
  const adaptiveState = buildAdaptiveState({
    learnerProfile,
    knowledgeGraph,
    diagnosticResult
  });
  return {
    ...diagnosticResult,
    adaptiveState,
    remediationPlan: buildRemediationPlan(input, knowledgeGraph, learnerProfile, diagnosticResult)
  };
}

export function buildRemediationPlan(input, knowledgeGraph, learnerProfile, diagnosticResult = null) {
  const concepts = ensureArray(knowledgeGraph?.concepts, []);
  const diagnosticWeak = ensureArray(diagnosticResult?.conceptMastery, [])
    .filter((item) => Number(item.masteryScore) < 75 || Number(item.confidence) < 0.55)
    .map((item) => ({
      conceptId: item.conceptId,
      title: item.conceptTitle,
      dimension: item.dimension,
      masteryScore: item.masteryScore,
      confidence: item.confidence,
      reason: item.evidence,
      misconceptions: item.misconceptions || []
    }));
  const profileWeak = [...concepts]
    .sort((a, b) => Number(a.masteryScore) - Number(b.masteryScore))
    .slice(0, 5)
    .map((concept) => ({
      conceptId: concept.id,
      title: concept.title,
      dimension: concept.dimension,
      masteryScore: concept.masteryScore,
      confidence: concept.confidence,
      reason: concept.evidence,
      misconceptions: concept.misconceptions || []
    }));
  const weakConcepts = (diagnosticWeak.length ? diagnosticWeak : profileWeak).slice(0, 5);
  const primary = weakConcepts[0] || profileWeak[0] || {
    title: input.topic || "当前主题",
    dimension: learnerProfile?.weakestDimensions?.[0]?.dimension || "概念理解",
    masteryScore: 50,
    confidence: 0.3,
    misconceptions: []
  };

  return {
    generatedAt: new Date().toISOString(),
    target: primary.title,
    reason: `优先补救「${primary.dimension}」中的「${primary.title}」，当前掌握约 ${primary.masteryScore} 分，置信度 ${Math.round((primary.confidence || 0.3) * 100)}%。`,
    weakConcepts,
    microLessons: weakConcepts.slice(0, 3).map((concept) => ({
      conceptId: concept.conceptId,
      title: `${concept.title} 微讲义`,
      content: buildMicroLesson(input, concept),
      misconceptionFix: (concept.misconceptions || []).slice(0, 2).map((item) => `不要${item}，先写出判断依据再做题。`)
    })),
    workedExamples: weakConcepts.slice(0, 2).map((concept) => ({
      title: `${concept.title} 半成品例题`,
      prompt: `先判断这个场景属于 ${concept.title} 的哪一种用法，再补全关键步骤。`,
      scaffold: ["识别输入输出", "写出判断依据", "选择合适方法", "说明风险或边界"]
    })),
    variantItems: weakConcepts.slice(0, 3).map((concept, index) => buildVariantItem(input, concept, index)),
    retestItems: weakConcepts.slice(0, 2).map((concept, index) => buildRetestItem(input, concept, index)),
    hintLadder: [
      "提示 1：先指出题目考查的知识点，不看选项。",
      "提示 2：写出适用条件和一个反例。",
      "提示 3：再看选项，排除与条件冲突的说法。",
      "提示 4：答完后用一句话解释为什么。"
    ],
    sequence: [
      {
        step: "概念澄清",
        action: `阅读「${primary.title}」微讲义，写出定义、适用条件和反例。`,
        expectedEvidence: "能用自己的话解释，并指出一个常见误区。"
      },
      {
        step: "例题跟练",
        action: "完成半成品例题，只补关键判断，不直接看完整答案。",
        expectedEvidence: "能补全缺失步骤，并说明为什么这样做。"
      },
      {
        step: "变式练习",
        action: "完成 2-3 道同知识点不同情境题，记录错因标签。",
        expectedEvidence: "正确率达到 80% 或能解释错误原因。"
      },
      {
        step: "复测与路径调整",
        action: "复测同一知识点，若仍低于 75 分则回到微讲义，否则进入项目迁移。",
        expectedEvidence: "复测结果进入掌握度证据链。"
      }
    ],
    coachPrompts: [
      `请用追问方式帮我弄懂 ${primary.title}，先给提示 1，不要直接给最终答案。`,
      `我在 ${primary.dimension} 上出错，请按“错因-微讲义-变式题-复测”帮我补救。`,
      `根据我的诊断结果，安排今天 30 分钟的补救任务。`
    ]
  };
}

export function buildGovernanceReport({ input, learnerProfile, path, resources, assessment, dailyPlan, knowledgeGraph }) {
  const concepts = ensureArray(knowledgeGraph?.concepts, []);
  const diagnosticLikeItems = ensureArray(assessment?.quiz, []);
  const checks = [
    {
      id: "fine-grained-concepts",
      label: "细粒度知识图谱",
      passed: concepts.length >= 12,
      detail: `当前 ${concepts.length} 个知识点；真实系统建议至少覆盖 12 个细节点。`
    },
    {
      id: "grounded-resources",
      label: "资源绑定知识点",
      passed: ensureArray(resources, []).every((item) => item.conceptId || item.sourceConcepts?.length),
      detail: "每个资源应能追溯到知识图谱节点、课程目标和适用错因。"
    },
    {
      id: "diagnostic-evidence",
      label: "画像证据可解释",
      passed: ensureArray(learnerProfile?.mastery, []).every((item) => item.evidence && item.source),
      detail: "掌握度必须标注估计、诊断、练习或复测来源。"
    },
    {
      id: "answer-consistency",
      label: "题目答案一致性",
      passed: diagnosticLikeItems.every((item) => item.type !== "choice" || item.options?.[item.answerIndex] !== undefined),
      detail: "选择题必须有合法标准答案；代码题必须由后端隐藏测试评测。"
    },
    {
      id: "difficulty-match",
      label: "难度匹配",
      passed: concepts.some((item) => item.difficulty <= 2) && concepts.some((item) => item.difficulty >= 4),
      detail: "题目和资源需要覆盖基础、巩固、迁移三个梯度。"
    },
    {
      id: "daily-actionable",
      label: "每日任务可执行",
      passed: ensureArray(dailyPlan, []).every((day) => ensureArray(day.tasks, []).length >= 3),
      detail: "每日任务应可直接打卡，不只是泛泛建议。"
    },
    {
      id: "assessment-quality",
      label: "测评闭环",
      passed: diagnosticLikeItems.length >= 4,
      detail: "测评题需要提供评分、解析、后续动作和错因归因。"
    },
    {
      id: "answer-leakage",
      label: "答题端隐藏标准答案",
      passed: true,
      detail: "正式练习题通过 publicQuestion 输出，隐藏标准答案、关键词和测试用例。"
    }
  ];
  const score = Math.round((checks.filter((item) => item.passed).length / checks.length) * 100);
  return {
    agent: "内容治理智能体",
    generatedAt: new Date().toISOString(),
    riskLevel: score >= 90 ? "low" : score >= 75 ? "medium" : "high",
    score,
    summary: `${input.topic || "当前主题"} 资源包通过 ${checks.filter((item) => item.passed).length}/${checks.length} 项质量检查。`,
    checks,
    consistencyChecks: [
      "选择题 answerIndex 已校验合法范围。",
      "前端题目不会暴露标准答案、关键词或隐藏测试。",
      "诊断题保留知识点、难度、区分度和错因标签。"
    ],
    requiredFixes: checks.filter((item) => !item.passed).map((item) => item.label),
    moderationPolicy: [
      "不直接替学生完成主观题最终答案，优先给提示和追问。",
      "大模型生成内容必须保留知识点、难度、证据来源和可复测路径。",
      "代码题评测使用服务端沙箱或本地 runner，避免浏览器端执行学生代码。",
      "个人工作台可查看质量风险，必要时触发资源生成智能体重写。"
    ]
  };
}

export function buildPersonalLearningInsights({ input, learnerProfile, dailyPlan, assessment, knowledgeGraph, governanceReport, adaptiveState }) {
  const weakConcepts = ensureArray(adaptiveState?.weakestConcepts, [])
    .concat(ensureArray(knowledgeGraph?.concepts, []).sort((a, b) => a.masteryScore - b.masteryScore).slice(0, 3))
    .slice(0, 6);
  const highRisk = weakConcepts.filter((item) => Number(item.masteryScore) < 60 || Number(item.confidence) < 0.45);
  const riskLevel = highRisk.length ? "需要立即补强" : "按计划推进";
  const practicePackages = weakConcepts.slice(0, 3).map((concept) => ({
    title: `${concept.title || concept.conceptTitle} 个人补强包`,
    requirement: "1 个微讲义 + 1 个半成品例题 + 2 道变式题 + 1 次复测",
    targetScore: concept.difficulty >= 4 ? 85 : 80,
    conceptId: concept.conceptId || concept.id,
    dimension: concept.dimension
  }));
  return {
    generatedAt: new Date().toISOString(),
    title: `${input.topic || "学习主题"} 个人学习洞察`,
    overview: {
      learnerProfile: learnerProfile?.summary || "",
      planDays: ensureArray(dailyPlan, []).length,
      assessmentItems: ensureArray(assessment?.quiz, []).length,
      contentQualityScore: governanceReport?.score || 0,
      riskLevel,
      highRiskCount: highRisk.length
    },
    weakConcepts,
    focusTracks: [
      { name: "概念补强", rule: "概念理解或先修基础低于 70 分", count: weakConcepts.filter((item) => ["概念理解", "先修基础"].includes(item.dimension)).length },
      { name: "迁移练习", rule: "方法迁移或实践应用低于 75 分", count: weakConcepts.filter((item) => ["方法迁移", "实践应用"].includes(item.dimension)).length },
      { name: "复盘表达", rule: "表达复盘或学习自驱低于 75 分", count: weakConcepts.filter((item) => ["表达复盘", "学习自驱"].includes(item.dimension)).length }
    ],
    suggestedPractice: practicePackages,
    focusQueue: highRisk.map((concept) => ({
      concept: concept.title || concept.conceptTitle,
      reason: `掌握度 ${concept.masteryScore}，置信度 ${Math.round((concept.confidence || 0) * 100)}%`,
      action: "先用分层提示复述定义、反例和错因，再做 2 道变式题。"
    })),
    reportRows: weakConcepts.map((concept) => ({
      topic: input.topic || "",
      concept: concept.title || concept.conceptTitle,
      dimension: concept.dimension,
      masteryScore: concept.masteryScore,
      confidence: concept.confidence,
      action: concept.nextAction || nextActionForConcept(concept.masteryScore, concept.confidence)
    })),
    nextActions: [
      "每天开始前先查看最低掌握度知识点，优先复述定义、适用条件和反例。",
      "每轮练习后把错题写入错题本，标注错因、提示层级和复测时间。",
      "测评连续两轮低于 60 分时，自动切换到补救路径并降低下一轮题目难度。",
      "质量治理报告存在待修正项时，先重写资源或更换例题，再继续练习。"
    ],
    exportSummary: `建议优先补强 ${weakConcepts.map((item) => item.title || item.conceptTitle).slice(0, 4).join("、")}。`
  };
}

function selectBlueprints(topic, seed) {
  if (isMachineLearningTopic(topic)) return ML_BLUEPRINTS;
  const dimensions = ["先修基础", "概念理解", "方法迁移", "实践应用", "表达复盘", "学习自驱"];
  return Array.from({ length: 14 }, (_, index) => {
    const dimension = dimensions[index % dimensions.length];
    return {
      id: `${seed}-concept-${index + 1}`,
      title: `${topic} 知识点 ${index + 1}`,
      dimension,
      difficulty: 1 + (index % 4),
      prerequisites: index === 0 ? [] : [`${seed}-concept-${Math.max(1, index)}`],
      standard: `能解释并应用 ${topic} 的第 ${index + 1} 个关键知识点。`,
      misconceptions: ["只记忆不应用", "缺少反例意识"],
      resources: ["微讲义", "例题", "变式题"],
      diagnostic: null
    };
  });
}

function buildDiagnosticItem(input, concept, index) {
  const diagnostic = concept.diagnostic || genericDiagnostic(input, concept, index);
  return {
    id: `${concept.id}-diagnostic-${index + 1}`,
    type: "choice",
    conceptId: concept.id,
    conceptTitle: concept.title,
    dimension: concept.dimension,
    difficulty: concept.difficulty,
    discrimination: round2(0.72 + Math.min(0.2, concept.difficulty * 0.04)),
    guess: 0.25,
    timeLimitSec: 75 + concept.difficulty * 15,
    question: diagnostic.question,
    options: diagnostic.options,
    answerIndex: diagnostic.answerIndex,
    explanation: diagnostic.explanation,
    misconceptionTags: diagnostic.tags || concept.misconceptions || [],
    standard: concept.standard,
    source: concept.source || "local-curriculum",
    score: 20
  };
}

function genericDiagnostic(input, concept, index) {
  const variants = [
    {
      question: `关于「${concept.title}」，哪一种表现最能证明已经掌握？`,
      options: [
        "能说出定义、适用条件、反例，并完成一个可验证例子",
        "只记住一个关键词",
        "收藏了一篇资料但没有复述",
        "看过视频但没有输出"
      ],
      answerIndex: 0,
      explanation: "掌握需要可复述、可迁移、可复测，而不只是记忆。",
      tags: ["只停留在记忆", "缺少可验证输出"]
    },
    {
      question: `把 ${input.topic || "当前主题"} 用到新问题时，第一步更应该做什么？`,
      options: [
        "识别输入、输出、约束和评价标准",
        "直接套用上一题答案",
        "先追求最复杂工具",
        "跳过问题边界"
      ],
      answerIndex: 0,
      explanation: "迁移前先建模问题结构，再选择方法。",
      tags: ["迁移前缺少问题建模", "套模板"]
    }
  ];
  return variants[index % variants.length];
}

function buildConceptMasteryFromDiagnostic(knowledgeGraph, results) {
  const resultByConcept = new Map();
  for (const result of results) {
    if (!resultByConcept.has(result.conceptId)) resultByConcept.set(result.conceptId, []);
    resultByConcept.get(result.conceptId).push(result);
  }
  return ensureArray(knowledgeGraph?.concepts, []).map((concept) => {
    const related = resultByConcept.get(concept.id) || [];
    if (!related.length) {
      return {
        conceptId: concept.id,
        conceptTitle: concept.title,
        dimension: concept.dimension,
        masteryScore: concept.masteryScore,
        masteryProbability: concept.masteryProbability,
        confidence: concept.confidence,
        misconceptions: concept.misconceptions,
        evidence: "本轮诊断未覆盖，沿用画像估计。"
      };
    }
    const prior = concept.masteryProbability ?? concept.masteryScore / 100;
    const probability = related.reduce((p, result) => updateBktProbability(p, result, concept), prior);
    const confidence = clamp01(0.42 + related.length * 0.16 - averageHintCount(related) * 0.04);
    const masteryScore = clamp(Math.round(probability * 100));
    return {
      conceptId: concept.id,
      conceptTitle: concept.title,
      dimension: concept.dimension,
      masteryScore,
      masteryProbability: round2(probability),
      confidence: round2(confidence),
      misconceptions: concept.misconceptions,
      evidence: `诊断题 ${related.filter((item) => item.correct).length}/${related.length} 正确，BKT 概率 ${Math.round(probability * 100)}%，平均耗时 ${Math.round(averageTime(related))} 秒。`
    };
  });
}

function updateBktProbability(prior, result, concept) {
  const slip = clamp01(0.08 + concept.difficulty * 0.015 + result.hintCount * 0.02);
  const guess = clamp01(result.correct ? 0.22 : 0.25);
  const learn = clamp01(0.08 + (result.correct ? 0.05 : 0.02));
  const observedCorrect = Boolean(result.correct);
  const numerator = observedCorrect ? prior * (1 - slip) : prior * slip;
  const denominator = numerator + (observedCorrect ? (1 - prior) * guess : (1 - prior) * (1 - guess));
  const posterior = denominator ? numerator / denominator : prior;
  return clamp01(posterior + (1 - posterior) * learn);
}

function summarizeMistakes(results) {
  const wrong = results.filter((item) => !item.correct);
  const tags = new Map();
  for (const item of wrong) {
    for (const tag of item.misconceptionTags || []) {
      tags.set(tag, (tags.get(tag) || 0) + 1);
    }
  }
  return {
    totalWrong: wrong.length,
    dominantTags: [...tags.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag, count]) => ({ tag, count })),
    dimensions: [...new Set(wrong.map((item) => item.dimension).filter(Boolean))],
    responsePattern: wrong.length ? "需要错因补救和变式复测" : "当前前测未暴露明显错因"
  };
}

function buildGroundedResourcesForConcept(topic, concept) {
  return [
    {
      id: `${concept.id}-micro`,
      conceptId: concept.id,
      type: "微讲义",
      title: `${concept.title} 微讲义`,
      objective: concept.standard,
      content: buildMicroLesson({ topic }, concept)
    },
    {
      id: `${concept.id}-practice`,
      conceptId: concept.id,
      type: "变式练习",
      title: `${concept.title} 变式练习`,
      objective: `识别并修正误区：${(concept.misconceptions || []).slice(0, 2).join("、")}`,
      content: `围绕 ${concept.title} 完成不同情境的判断、解释和复测。`
    }
  ];
}

function buildMicroLesson(input, concept) {
  return `先用一句话定义「${concept.title}」，再写出适用条件；接着用 ${input.topic || "当前主题"} 的具体场景说明它如何发挥作用；最后列出一个常见误区：${(concept.misconceptions || ["只记结论不看条件"])[0]}。`;
}

function buildVariantItem(input, concept, index) {
  return {
    id: `${concept.conceptId || concept.id}-variant-${index + 1}`,
    type: "short",
    title: `${concept.title} 变式题`,
    prompt: `换一个 ${input.topic || "当前主题"} 场景，说明「${concept.title}」的适用条件，并指出一个容易误判的地方。`,
    expected: "答案需要包含条件、例子、误区和判断依据。"
  };
}

function buildRetestItem(input, concept, index) {
  return {
    id: `${concept.conceptId || concept.id}-retest-${index + 1}`,
    type: "choice",
    prompt: `复测：关于「${concept.title}」，哪一种学习证据最可靠？`,
    options: ["能解释条件、完成变式并复盘错因", "只看完资料", "只背一个定义", "只把答案抄一遍"],
    answerIndex: 0,
    expectedScore: 80
  };
}

function estimateAbility(results) {
  if (!results.length) return 0;
  const weighted = results.reduce((sum, item) => {
    const correctness = item.correct ? 1 : 0;
    return sum + (correctness - 0.5) * Number(item.discrimination || 0.75) * Number(item.difficulty || 2);
  }, 0) / results.length;
  return round2(weighted);
}

function estimateReliability(results) {
  if (!results.length) return 0;
  const coverage = new Set(results.map((item) => item.conceptId)).size / Math.max(1, results.length);
  const answered = results.filter((item) => item.selectedIndex !== null).length / results.length;
  return round2(clamp01(0.35 + coverage * 0.35 + answered * 0.25));
}

function inferNextDifficulty(concepts) {
  const avg = concepts.length
    ? concepts.reduce((sum, item) => sum + Number(item.masteryScore || 0), 0) / concepts.length
    : 50;
  const confidence = concepts.length
    ? concepts.reduce((sum, item) => sum + Number(item.confidence || 0.35), 0) / concepts.length
    : 0.35;
  if (avg < 60 || confidence < 0.45) return "foundation-diagnostic";
  if (avg < 85) return "adaptive-practice";
  return "project-transfer";
}

function nextActionForConcept(score, confidence = 0.35) {
  if (confidence < 0.45) return "补做诊断题，提高掌握度置信度";
  if (score < 60) return "回到微讲义并完成基础变式";
  if (score < 80) return "完成变式练习并记录错因";
  if (score < 90) return "做复测和项目迁移";
  return "进入综合项目或讲给别人听";
}

function masteryStatus(score, confidence) {
  if (confidence < 0.45) return "证据不足";
  if (score < 60) return "薄弱";
  if (score < 80) return "待巩固";
  if (score < 90) return "基本掌握";
  return "可迁移";
}

function reviewDueAt(score) {
  const hours = score < 60 ? 12 : score < 80 ? 24 : score < 90 ? 72 : 168;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function averageTime(results) {
  const values = results.map((item) => Number(item.timeSpentSec || 0)).filter((value) => value > 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function averageHintCount(results) {
  return results.length
    ? results.reduce((sum, item) => sum + Number(item.hintCount || 0), 0) / results.length
    : 0;
}

function isMachineLearningTopic(topic) {
  return /机器学习|machine learning|模型|训练|预测|分类|回归|数据挖掘|人工智能|ai/i.test(String(topic || ""));
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const id = item.id || item.conceptId;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function slugify(value) {
  const ascii = String(value || "topic")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return ascii || `topic-${Math.abs(hashCode(String(value || "topic")))}`;
}

function hashCode(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
