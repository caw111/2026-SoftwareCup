import crypto from "node:crypto";

import {
  buildRagContext,
  chunkCourseSource,
  parseCourseSource,
  searchCourseChunks,
  validateSourceUpload
} from "../rag.js";
import {
  assertReadySourcesOwnedByUser,
  createProcessingSourceRecord,
  findReadySourceByChecksum,
  getSourceChunksForUser,
  listSourceRecords,
  markSourceFailedRecord,
  markSourceReadyRecord,
  replacePlanSourceRecords,
  softDeleteSourceRecord
} from "../repositories/source-repository.js";

export async function uploadSourceForUser(userId, payload) {
  const upload = validateSourceUpload(payload);
  const existing = await findReadySourceByChecksum(userId, upload.checksum);
  if (existing) return { source: existing, deduplicated: true };

  const id = crypto.randomUUID();
  await createProcessingSourceRecord(userId, {
    id,
    ...upload,
    metadata: { parserVersion: 1, formatLabel: upload.extension.slice(1).toUpperCase() }
  });
  try {
    const parsed = await parseCourseSource(upload);
    const chunks = chunkCourseSource(parsed.sections).map((chunk) => ({
      ...chunk,
      id: crypto.randomUUID()
    }));
    const source = await markSourceReadyRecord(userId, id, {
      charCount: parsed.charCount,
      metadata: {
        parserVersion: 1,
        formatLabel: upload.extension.slice(1).toUpperCase(),
        sectionCount: parsed.sections.length,
        locators: parsed.sections.slice(0, 30).map((section) => section.locator)
      }
    }, chunks);
    return { source, deduplicated: false };
  } catch (error) {
    const source = await markSourceFailedRecord(userId, id, error instanceof Error ? error.message : String(error));
    const wrapped = new Error(error instanceof Error ? error.message : String(error));
    wrapped.statusCode = Number(error?.statusCode) || 422;
    wrapped.source = source;
    throw wrapped;
  }
}

export async function listSourcesForUser(userId, planId = null) {
  return listSourceRecords(userId, planId || null);
}

export async function deleteSourceForUser(userId, sourceId) {
  const deleted = await softDeleteSourceRecord(userId, sourceId);
  if (!deleted) throw notFound("课程资料不存在");
  return { ok: true, sourceId };
}

export async function replacePlanSourcesForUser(userId, planId, values) {
  const sourceIds = normalizeSourceIds(values);
  const linked = await replacePlanSourceRecords(userId, planId, sourceIds);
  if (linked === null) throw notFound("学习方案不存在");
  return { ok: true, planId, sourceIds: linked };
}

export async function assertSourcesForUser(userId, values) {
  const sourceIds = normalizeSourceIds(values);
  const owned = await assertReadySourcesOwnedByUser(userId, sourceIds);
  if (owned === null) {
    const error = new Error("部分课程资料不存在、尚未解析完成或无权访问");
    error.statusCode = 400;
    throw error;
  }
  return owned;
}

export async function searchSourcesForUser(userId, payload) {
  const sourceIds = normalizeSourceIds(payload?.sourceIds);
  const planId = String(payload?.planId || "").slice(0, 64) || null;
  if (!sourceIds.length && !planId) {
    const error = new Error("请选择课程资料或提供学习方案 ID");
    error.statusCode = 400;
    throw error;
  }
  if (sourceIds.length) await assertSourcesForUser(userId, sourceIds);
  const query = String(payload?.query || "").trim().slice(0, 2000);
  if (!query) {
    const error = new Error("检索问题不能为空");
    error.statusCode = 400;
    throw error;
  }
  const chunks = await getSourceChunksForUser(userId, { sourceIds, planId });
  const results = searchCourseChunks(chunks, query, { limit: payload?.limit });
  const grounding = buildRagContext(results, { maxChars: payload?.maxChars || 7000 });
  return {
    query,
    sourceIds: [...new Set(results.map((result) => result.sourceId))],
    searchedChunks: chunks.length,
    results: results.map(({ content, ...result }) => result),
    ...grounding
  };
}

export function normalizeSourceIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^[a-f0-9-]{8,64}$/i.test(value)))]
    .slice(0, 30);
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}
