import crypto from "node:crypto";

import { RAG_CONFIG } from "../config.js";
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

export async function loadFullSourceContextForUser(userId, payload = {}) {
  const sourceIds = normalizeSourceIds(payload?.sourceIds);
  const planId = String(payload?.planId || "").slice(0, 64) || null;
  if (!sourceIds.length && !planId) {
    const error = new Error("请选择课程资料或提供学习方案 ID");
    error.statusCode = 400;
    throw error;
  }
  if (sourceIds.length) await assertSourcesForUser(userId, sourceIds);
  const chunks = await getSourceChunksForUser(userId, { sourceIds, planId });
  return buildFullSourceContext(chunks, {
    maxChars: RAG_CONFIG.fullContextMaxChars
  });
}

export function buildFullSourceContext(chunks, options = {}) {
  const maxChars = Math.max(10000, Number(options.maxChars || RAG_CONFIG.fullContextMaxChars));
  const readableChunks = (Array.isArray(chunks) ? chunks : [])
    .map((chunk) => ({ ...chunk, content: String(chunk?.content || "").trim() }))
    .filter((chunk) => chunk.content);
  if (!readableChunks.length) {
    const error = new Error("所选文件没有可供大模型阅读的已解析内容，请重新解析或上传其他文件");
    error.statusCode = 422;
    throw error;
  }

  const citations = [];
  const blocks = readableChunks.map((chunk, index) => {
    const id = `S${index + 1}`;
    const sourceName = String(chunk.sourceName || "课程资料").trim();
    const locator = String(chunk.locator || chunk.title || `片段 ${index + 1}`).trim();
    const title = [sourceName, locator].filter(Boolean).join(" · ");
    citations.push({
      id,
      sourceId: String(chunk.sourceId || ""),
      chunkId: String(chunk.id || ""),
      title,
      locator,
      quote: excerpt(chunk.content, 800),
      score: 1
    });
    return `[${id}] ${title}\n${chunk.content}`;
  });
  const context = blocks.join("\n\n");
  if (context.length > maxChars) {
    const error = new Error(
      `所选文件的完整解析内容共 ${context.length.toLocaleString("zh-CN")} 个字符，超过当前单次模型上下文上限 ${maxChars.toLocaleString("zh-CN")}。请减少所选文件后重试；系统不会截断或遗漏文件内容。`
    );
    error.statusCode = 413;
    error.code = "FULL_CONTEXT_TOO_LARGE";
    error.contextChars = context.length;
    error.maxContextChars = maxChars;
    throw error;
  }

  return {
    mode: "full-context",
    context,
    citations,
    sourceIds: [...new Set(readableChunks.map((chunk) => String(chunk.sourceId || "")).filter(Boolean))],
    sourceCount: new Set(readableChunks.map((chunk) => String(chunk.sourceId || "")).filter(Boolean)).size,
    loadedChunks: readableChunks.length,
    fullContextChars: context.length,
    searchedChunks: 0,
    instruction: "以下是所选文件的全部已解析内容。回答和课程生成只能依据这些完整文件内容，并使用对应的 [S编号] 标注依据。"
  };
}

function excerpt(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text;
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
