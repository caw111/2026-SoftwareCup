import { MODEL_CONFIG } from "./config.js";
import { parseJsonFromModel, requestChatCompletion } from "./llm.js";
import { clean } from "./utils.js";

export function buildKnowledgeGraphView(plan, options = {}) {
  const data = plan?.data || plan || {};
  const graph = data.knowledgeGraph || {};
  const adaptiveConcepts = asArray(data.adaptiveState?.concepts);
  const graphConcepts = asArray(graph.concepts);
  const profileMastery = asArray(data.learnerProfile?.mastery);
  const concepts = mergeConcepts(graphConcepts, adaptiveConcepts, profileMastery);
  const edges = normalizeEdges(graph.edges, concepts);
  const taskEvidence = buildTaskEvidence(data.dailyPlan, concepts, plan?.progress || {});
  const resourceEvidence = buildResourceEvidence(data, concepts);
  const quizEvidence = buildQuizEvidence(plan, concepts);
  const nodes = concepts.map((concept) => {
    const tasks = taskEvidence.get(concept.id) || [];
    const resources = resourceEvidence.get(concept.id) || [];
    const quizzes = quizEvidence.get(concept.id) || [];
    return {
      id: concept.id,
      type: "concept",
      title: concept.title,
      dimension: concept.dimension,
      difficulty: concept.difficulty,
      masteryScore: concept.masteryScore,
      confidence: concept.confidence,
      status: concept.status || masteryStatus(concept.masteryScore, concept.confidence),
      nextAction: concept.nextAction || nextActionForConcept(concept),
      evidence: concept.evidence || evidenceFrom(tasks, quizzes),
      objectives: concept.objectives,
      misconceptions: concept.misconceptions,
      reviewDueAt: concept.reviewDueAt || null,
      source: concept.source || "course-plan",
      tasks,
      resources,
      quizzes,
      layout: { x: 0, y: 0 }
    };
  });
  const laidOutNodes = applyLayout(nodes, edges, options.layout);
  const coverage = calculateCoverage(laidOutNodes);
  return {
    id: options.versionId || `graph-${plan?.id || "course"}-${graph.version || "current"}`,
    planId: plan?.id || null,
    title: `${data.input?.topic || plan?.title || graph.topic || "当前课程"} 知识图谱`,
    topic: data.input?.topic || graph.topic || plan?.title || "当前课程",
    generatedAt: new Date().toISOString(),
    source: options.source || "course-plan",
    llm: options.llm || { used: false },
    coverage,
    filters: {
      dimensions: [...new Set(laidOutNodes.map((node) => node.dimension).filter(Boolean))],
      statuses: [...new Set(laidOutNodes.map((node) => node.status).filter(Boolean))]
    },
    nodes: laidOutNodes,
    edges,
    listView: laidOutNodes.map((node) => ({
      id: node.id,
      title: node.title,
      dimension: node.dimension,
      masteryScore: node.masteryScore,
      confidence: node.confidence,
      nextAction: node.nextAction,
      taskCount: node.tasks.length,
      resourceCount: node.resources.length,
      quizCount: node.quizzes.length
    }))
  };
}

export async function refineKnowledgeGraphWithLlm(plan, baseGraph) {
  if (!MODEL_CONFIG.apiKey) {
    return {
      graph: baseGraph,
      llm: { used: false, reason: "未配置大模型，保留课程生成阶段的真实知识图谱。" }
    };
  }
  const compactGraph = {
    topic: baseGraph.topic,
    nodes: baseGraph.nodes.slice(0, 80).map((node) => ({
      id: node.id,
      title: node.title,
      dimension: node.dimension,
      masteryScore: node.masteryScore,
      confidence: node.confidence,
      nextAction: node.nextAction,
      taskCount: node.tasks.length,
      quizCount: node.quizzes.length
    })),
    edges: baseGraph.edges.slice(0, 120)
  };
  const content = await requestChatCompletion([
    {
      role: "system",
      content: [
        "你是中文学习系统的知识图谱治理智能体。",
        "只能基于输入中的节点和边补充摘要、行动建议和少量缺失先修边。",
        "不得发明不存在的课程主题，不得输出 Markdown，只能输出 JSON。"
      ].join("")
    },
    {
      role: "user",
      content: `请增强下面的课程知识图谱。输出 JSON：
{
  "summary": "图谱整体说明",
  "nodeUpdates": [{"id":"已有节点ID","summary":"节点摘要","nextAction":"下一步动作","misconception":"高频误区"}],
  "edgeSuggestions": [{"source":"已有节点ID","target":"已有节点ID","relation":"prerequisite","reason":"为什么需要"}],
  "focusConceptIds": ["最值得优先学习的已有节点ID"]
}

硬性规则：
1. nodeUpdates.id、edgeSuggestions.source、edgeSuggestions.target 必须来自已有节点。
2. nextAction 必须结合掌握度、任务或测验证据。
3. 不要返回空泛模板句。

图谱：${JSON.stringify(compactGraph)}`
    }
  ], { temperature: 0.25, maxTokens: 1800 });
  const parsed = parseJsonFromModel(content);
  const graph = mergeGraphEnhancement(baseGraph, parsed);
  return {
    graph: {
      ...graph,
      source: "llm-enhanced",
      llm: { used: true, model: MODEL_CONFIG.model, summary: clean(parsed.summary, 800) }
    },
    llm: { used: true, model: MODEL_CONFIG.model, summary: clean(parsed.summary, 800) }
  };
}

function mergeConcepts(graphConcepts, adaptiveConcepts, profileMastery) {
  const byId = new Map();
  for (const concept of graphConcepts) {
    const id = normalizeConceptId(concept);
    byId.set(id, normalizeConcept(concept, id));
  }
  for (const concept of adaptiveConcepts) {
    const id = normalizeConceptId(concept);
    byId.set(id, { ...(byId.get(id) || {}), ...normalizeConcept(concept, id) });
  }
  if (!byId.size) {
    for (const item of profileMastery) {
      const id = stableId(item.dimension || item.title || "mastery");
      byId.set(id, normalizeConcept({
        id,
        title: item.dimension,
        dimension: item.dimension,
        masteryScore: item.score,
        confidence: 0.3,
        evidence: item.evidence,
        source: item.source || "learner-profile"
      }, id));
    }
  }
  return [...byId.values()].filter((concept) => concept.title);
}

function normalizeConcept(concept, id) {
  const title = clean(concept.title || concept.conceptTitle || concept.dimension || id, 120);
  const masteryScore = clampScore(concept.masteryScore ?? concept.score ?? 50);
  return {
    id,
    title,
    dimension: clean(concept.dimension || "综合能力", 80),
    difficulty: Math.max(1, Math.min(5, Number(concept.difficulty || 2))),
    masteryScore,
    confidence: Math.max(0, Math.min(1, Number(concept.confidence ?? 0.35))),
    status: clean(concept.status || masteryStatus(masteryScore, concept.confidence), 40),
    nextAction: clean(concept.nextAction || "", 220),
    evidence: clean(concept.evidence || "", 500),
    objectives: asArray(concept.objectives).map((item) => clean(item, 220)).slice(0, 4),
    misconceptions: asArray(concept.misconceptions).map((item) => clean(item, 120)).slice(0, 4),
    reviewDueAt: concept.reviewDueAt || null,
    source: clean(concept.source || "", 80),
    prerequisites: asArray(concept.prerequisites).map((item) => clean(item, 120)).filter(Boolean)
  };
}

function normalizeEdges(edges, concepts) {
  const ids = new Set(concepts.map((concept) => concept.id));
  const fromGraph = asArray(edges)
    .map((edge) => ({
      source: clean(edge.source || edge.from, 120),
      target: clean(edge.target || edge.to, 120),
      relation: clean(edge.relation || "prerequisite", 60),
      reason: clean(edge.reason || "", 200)
    }))
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target);
  const fromPrerequisites = concepts.flatMap((concept) => concept.prerequisites.map((source) => ({
    source,
    target: concept.id,
    relation: "prerequisite",
    reason: "来自课程图谱先修关系"
  }))).filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target);
  return uniqueEdges([...fromGraph, ...fromPrerequisites]);
}

function buildTaskEvidence(dailyPlan, concepts, progress = {}) {
  const ids = new Set(concepts.map((concept) => concept.id));
  const byConcept = new Map();
  for (const day of asArray(dailyPlan)) {
    asArray(day.tasks).forEach((task, index) => {
      const conceptId = day.conceptIds?.[index] || day.conceptId || inferConceptId(task, concepts);
      if (!conceptId || !ids.has(conceptId)) return;
      if (!byConcept.has(conceptId)) byConcept.set(conceptId, []);
      byConcept.get(conceptId).push({
        day: Number(day.day || 0),
        taskKey: day.taskKeys?.[index] || `day-${day.day}-task-${index}`,
        title: clean(task, 220),
        completed: Boolean(progress[day.taskKeys?.[index] || `day-${day.day}-task-${index}`])
      });
    });
  }
  return byConcept;
}

function buildResourceEvidence(data, concepts) {
  const byConcept = new Map();
  const citations = asArray(data.input?.knowledgeGrounding?.citations)
    .concat(asArray(data.resourcePackage?.sourceCitations));
  for (const concept of concepts) {
    const matched = citations.filter((citation) => {
      const text = `${citation.title || ""} ${citation.quote || ""} ${citation.locator || ""}`;
      return text.includes(concept.title);
    }).slice(0, 4).map((citation) => ({
      title: clean(citation.title || citation.sourceName || "课程资料", 160),
      locator: clean(citation.locator || citation.id || "", 120),
      quote: clean(citation.quote || "", 260),
      sourceId: citation.sourceId || null
    }));
    if (matched.length) byConcept.set(concept.id, matched);
  }
  return byConcept;
}

function buildQuizEvidence(plan, concepts) {
  const byConcept = new Map();
  const ids = new Set(concepts.map((concept) => concept.id));
  for (const item of asArray(plan?.quizHistory)) {
    const conceptId = item.conceptId || inferConceptId(item.dimension || item.question, concepts);
    if (!conceptId || !ids.has(conceptId)) continue;
    if (!byConcept.has(conceptId)) byConcept.set(conceptId, []);
    byConcept.get(conceptId).push({
      questionId: item.questionId,
      type: item.type,
      dimension: item.dimension,
      correct: item.correct,
      score: Number(item.score || 0),
      maxScore: Number(item.maxScore || 0),
      at: item.at || null
    });
  }
  return byConcept;
}

function inferConceptId(text, concepts) {
  const value = String(text || "");
  return concepts.find((concept) => value.includes(concept.title) || value.includes(concept.dimension))?.id || null;
}

function applyLayout(nodes, edges, savedLayout = null) {
  const positions = savedLayout?.positions && typeof savedLayout.positions === "object"
    ? savedLayout.positions
    : {};
  const levels = graphLevels(nodes, edges);
  const grouped = groupBy(nodes, (node) => levels.get(node.id) || 0);
  const result = [];
  for (const [level, items] of [...grouped.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    items
      .sort((left, right) => left.dimension.localeCompare(right.dimension, "zh-CN") || left.title.localeCompare(right.title, "zh-CN"))
      .forEach((node, index) => {
        const saved = positions[node.id];
        result.push({
          ...node,
          layout: saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))
            ? { x: Number(saved.x), y: Number(saved.y), pinned: true }
            : { x: 120 + Number(level) * 220, y: 90 + index * 96 }
        });
      });
  }
  return result;
}

function graphLevels(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    incoming.get(edge.target).push(edge.source);
  }
  const memo = new Map();
  const visit = (id, stack = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return 0;
    stack.add(id);
    const level = Math.max(0, ...incoming.get(id).map((source) => visit(source, stack) + 1));
    stack.delete(id);
    memo.set(id, level);
    return level;
  };
  for (const node of nodes) visit(node.id);
  return memo;
}

function mergeGraphEnhancement(baseGraph, parsed) {
  const ids = new Set(baseGraph.nodes.map((node) => node.id));
  const updates = new Map(asArray(parsed.nodeUpdates)
    .filter((item) => ids.has(String(item.id)))
    .map((item) => [String(item.id), item]));
  const nodes = baseGraph.nodes.map((node) => {
    const update = updates.get(node.id);
    if (!update) return node;
    return {
      ...node,
      summary: clean(update.summary, 500),
      nextAction: clean(update.nextAction || node.nextAction, 220),
      misconceptions: [...new Set([...asArray(node.misconceptions), clean(update.misconception, 120)].filter(Boolean))].slice(0, 4)
    };
  });
  const suggested = asArray(parsed.edgeSuggestions)
    .map((edge) => ({
      source: clean(edge.source, 120),
      target: clean(edge.target, 120),
      relation: clean(edge.relation || "prerequisite", 60),
      reason: clean(edge.reason || "LLM 图谱治理建议", 200)
    }))
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target);
  return {
    ...baseGraph,
    nodes,
    edges: uniqueEdges([...baseGraph.edges, ...suggested]),
    focusConceptIds: asArray(parsed.focusConceptIds).map(String).filter((id) => ids.has(id)).slice(0, 8)
  };
}

function calculateCoverage(nodes) {
  const withTasks = nodes.filter((node) => node.tasks.length).length;
  const withEvidence = nodes.filter((node) => node.evidence || node.quizzes.length || node.resources.length).length;
  return {
    nodeCount: nodes.length,
    taskCoverageRate: nodes.length ? Math.round((withTasks / nodes.length) * 100) : 0,
    evidenceCoverageRate: nodes.length ? Math.round((withEvidence / nodes.length) * 100) : 0
  };
}

function evidenceFrom(tasks, quizzes) {
  if (quizzes.length) {
    const latest = quizzes.at(-1);
    return `最近测评 ${latest.score}/${latest.maxScore}，${latest.correct ? "已通过" : "仍需复测"}。`;
  }
  if (tasks.length) return `已绑定 ${tasks.length} 个学习任务。`;
  return "";
}

function nextActionForConcept(concept) {
  if (concept.masteryScore < 60) return "先补齐概念边界，再完成一次低门槛复测。";
  if (concept.confidence < 0.55) return "用诊断题或随堂测验提高掌握度置信度。";
  if (concept.masteryScore < 80) return "完成迁移练习，并记录错因。";
  return "进入综合应用巩固。";
}

function masteryStatus(score, confidence = 0.35) {
  if (score >= 82 && confidence >= 0.65) return "已掌握";
  if (score >= 65) return "巩固中";
  if (confidence < 0.45) return "待验证";
  return "薄弱";
}

function normalizeConceptId(concept) {
  return clean(concept.conceptId || concept.id || stableId(concept.title || concept.dimension || "concept"), 120);
}

function stableId(value) {
  const text = String(value || "node");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return `node-${Math.abs(hash).toString(36)}`;
}

function uniqueEdges(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.source}->${edge.target}:${edge.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function average(values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value));
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
