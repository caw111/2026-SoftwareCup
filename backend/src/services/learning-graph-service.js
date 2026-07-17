import {
  buildKnowledgeGraphView,
  refineKnowledgeGraphWithLlm
} from "../learning-graph.js";
import {
  createKnowledgeGraphVersionRecord,
  getKnowledgeGraphLayoutRecord,
  getLatestKnowledgeGraphVersionRecord,
  upsertKnowledgeGraphLayoutRecord
} from "../repositories/learning-graph-repository.js";
import { createLearningEventRecord } from "../repositories/path-revision-repository.js";
import { getWorkspaceForUser } from "./plan-service.js";

export async function getKnowledgeGraphForUser(userId, planId) {
  const plan = await findPlanForUser(userId, planId);
  const layout = await getKnowledgeGraphLayoutRecord(userId, planId);
  const stored = await getLatestKnowledgeGraphVersionRecord(userId, planId);
  const graph = stored || buildKnowledgeGraphView(plan, {
    layout: layout?.layout,
    source: "course-plan"
  });
  return {
    ok: true,
    graph: stored && layout?.layout ? applyLayoutToGraph(stored, layout.layout) : graph,
    layout: layout?.layout || null
  };
}

export async function refineKnowledgeGraphForUser(userId, planId) {
  const plan = await findPlanForUser(userId, planId);
  const layout = await getKnowledgeGraphLayoutRecord(userId, planId);
  const baseGraph = buildKnowledgeGraphView(plan, {
    layout: layout?.layout,
    source: "course-plan"
  });
  const result = await refineKnowledgeGraphWithLlm(plan, baseGraph);
  const stored = result.llm.used
    ? await createKnowledgeGraphVersionRecord(userId, planId, result.graph, {
      source: "llm-enhanced",
      model: result.llm.model
    })
    : result.graph;
  if (result.llm.used) {
    await createLearningEventRecord(userId, planId, {
      type: "knowledge_graph_refined",
      eventKey: `knowledge-graph-refined:${stored.id}`,
      payload: {
        graphVersionId: stored.id,
        model: result.llm.model,
        nodeCount: stored.nodes?.length || 0
      }
    });
  }
  return { ok: true, graph: stored, llm: result.llm };
}

export async function saveKnowledgeGraphLayoutForUser(userId, planId, body) {
  await findPlanForUser(userId, planId);
  const positions = body?.positions && typeof body.positions === "object" ? body.positions : {};
  const safePositions = Object.fromEntries(Object.entries(positions).slice(0, 500).map(([id, position]) => [
    String(id).slice(0, 120),
    {
      x: clampCoordinate(position?.x),
      y: clampCoordinate(position?.y)
    }
  ]));
  const layout = {
    positions: safePositions,
    zoom: Number.isFinite(Number(body?.zoom)) ? Math.max(0.25, Math.min(2.5, Number(body.zoom))) : 1,
    savedAt: new Date().toISOString()
  };
  const saved = await upsertKnowledgeGraphLayoutRecord(userId, planId, {
    graphVersionId: body?.graphVersionId || null,
    layout
  });
  return { ok: true, layout: saved.layout };
}

async function findPlanForUser(userId, planId) {
  const workspace = await getWorkspaceForUser(userId);
  const plan = workspace.plans.find((item) => item.id === planId);
  if (!plan) {
    const error = new Error("学习方案不存在");
    error.statusCode = 404;
    throw error;
  }
  return plan;
}

function clampCoordinate(value) {
  return Math.max(-5000, Math.min(5000, Number(value || 0)));
}

function applyLayoutToGraph(graph, layout) {
  const positions = layout?.positions && typeof layout.positions === "object" ? layout.positions : {};
  return {
    ...graph,
    nodes: (graph.nodes || []).map((node) => {
      const position = positions[node.id];
      if (!position) return node;
      return {
        ...node,
        layout: {
          ...(node.layout || {}),
          x: clampCoordinate(position.x),
          y: clampCoordinate(position.y),
          pinned: true
        }
      };
    })
  };
}
