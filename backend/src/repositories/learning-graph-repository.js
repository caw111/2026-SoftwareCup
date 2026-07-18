import crypto from "node:crypto";

import { getDatabasePool } from "../db/pool.js";

export async function createKnowledgeGraphVersionRecord(userId, planId, graph, meta = {}) {
  const id = meta.id || crypto.randomUUID();
  await getDatabasePool().execute(
    `INSERT INTO knowledge_graph_versions
       (id, user_id, plan_id, source, model, coverage_json, graph_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      planId,
      String(meta.source || graph.source || "course-plan").slice(0, 60),
      meta.model || graph.llm?.model || null,
      JSON.stringify(graph.coverage || {}),
      JSON.stringify({ ...graph, id })
    ]
  );
  return { ...graph, id };
}

export async function getLatestKnowledgeGraphVersionRecord(userId, planId) {
  const [rows] = await getDatabasePool().execute(
    `SELECT id, source, model, coverage_json, graph_json, created_at
       FROM knowledge_graph_versions
      WHERE user_id = ? AND plan_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, planId]
  );
  return rows.length ? publicGraphVersion(rows[0]) : null;
}

export async function getKnowledgeGraphLayoutRecord(userId, planId) {
  const [rows] = await getDatabasePool().execute(
    `SELECT graph_version_id, layout_json, updated_at
       FROM knowledge_graph_layouts
      WHERE user_id = ? AND plan_id = ?
      LIMIT 1`,
    [userId, planId]
  );
  if (!rows.length) return null;
  return {
    graphVersionId: rows[0].graph_version_id,
    layout: parseJson(rows[0].layout_json, {}),
    updatedAt: toIso(rows[0].updated_at)
  };
}

export async function upsertKnowledgeGraphLayoutRecord(userId, planId, value) {
  const graphVersionId = value?.graphVersionId || null;
  const layout = value?.layout && typeof value.layout === "object" ? value.layout : {};
  await getDatabasePool().execute(
    `INSERT INTO knowledge_graph_layouts
       (user_id, plan_id, graph_version_id, layout_json)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       graph_version_id = VALUES(graph_version_id),
       layout_json = VALUES(layout_json),
       updated_at = CURRENT_TIMESTAMP(3)`,
    [userId, planId, graphVersionId, JSON.stringify(layout)]
  );
  return { graphVersionId, layout };
}

function publicGraphVersion(row) {
  const graph = parseJson(row.graph_json, {});
  return {
    ...graph,
    id: row.id,
    source: row.source,
    model: row.model,
    coverage: parseJson(row.coverage_json, graph.coverage || {}),
    createdAt: toIso(row.created_at)
  };
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
