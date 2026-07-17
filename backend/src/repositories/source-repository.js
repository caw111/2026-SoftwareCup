import { getDatabasePool, withTransaction } from "../db/pool.js";

export async function findReadySourceByChecksum(userId, checksum) {
  const [rows] = await getDatabasePool().execute(
    `SELECT id, original_name, mime_type, extension, byte_size, char_count, chunk_count,
            checksum, status, error_message, metadata_json, created_at, updated_at
       FROM course_sources
      WHERE user_id = ? AND checksum = ? AND status = 'ready' AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, checksum]
  );
  return rows[0] ? publicSource(rows[0]) : null;
}

export async function createProcessingSourceRecord(userId, source) {
  await getDatabasePool().execute(
    `INSERT INTO course_sources
       (id, user_id, original_name, mime_type, extension, byte_size, checksum, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?)`,
    [
      source.id,
      userId,
      source.originalName,
      source.mimeType,
      source.extension,
      source.byteSize,
      source.checksum,
      JSON.stringify(source.metadata || {})
    ]
  );
  return getSourceRecord(userId, source.id);
}

export async function markSourceReadyRecord(userId, sourceId, parsed, chunks) {
  return withTransaction(async (connection) => {
    const [ownerRows] = await connection.execute(
      `SELECT id FROM course_sources
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        FOR UPDATE`,
      [sourceId, userId]
    );
    if (!ownerRows.length) return null;
    await connection.execute("DELETE FROM course_source_chunks WHERE source_id = ?", [sourceId]);
    for (const chunk of chunks) {
      await connection.execute(
        `INSERT INTO course_source_chunks
           (id, source_id, chunk_index, locator, title, content, keywords_json, token_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          chunk.id,
          sourceId,
          chunk.chunkIndex,
          chunk.locator,
          chunk.title,
          chunk.content,
          JSON.stringify(chunk.keywords || []),
          chunk.tokenCount
        ]
      );
    }
    await connection.execute(
      `UPDATE course_sources
          SET status = 'ready', char_count = ?, chunk_count = ?, error_message = NULL,
              metadata_json = ?
        WHERE id = ? AND user_id = ?`,
      [parsed.charCount, chunks.length, JSON.stringify(parsed.metadata || {}), sourceId, userId]
    );
    const [rows] = await connection.execute(
      `SELECT id, original_name, mime_type, extension, byte_size, char_count, chunk_count,
              checksum, status, error_message, metadata_json, created_at, updated_at
         FROM course_sources WHERE id = ? AND user_id = ? LIMIT 1`,
      [sourceId, userId]
    );
    return rows[0] ? publicSource(rows[0]) : null;
  });
}

export async function markSourceFailedRecord(userId, sourceId, errorMessage) {
  await getDatabasePool().execute(
    `UPDATE course_sources
        SET status = 'failed', error_message = ?, char_count = 0, chunk_count = 0
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [String(errorMessage || "解析失败").slice(0, 1000), sourceId, userId]
  );
  return getSourceRecord(userId, sourceId);
}

export async function getSourceRecord(userId, sourceId) {
  const [rows] = await getDatabasePool().execute(
    `SELECT id, original_name, mime_type, extension, byte_size, char_count, chunk_count,
            checksum, status, error_message, metadata_json, created_at, updated_at
       FROM course_sources
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [sourceId, userId]
  );
  return rows[0] ? publicSource(rows[0]) : null;
}

export async function listSourceRecords(userId, planId = null) {
  const params = [userId];
  let planJoin = "";
  let linkedSelect = "FALSE AS is_linked";
  if (planId) {
    planJoin = "LEFT JOIN plan_sources ps ON ps.source_id = s.id AND ps.plan_id = ?";
    linkedSelect = "(ps.source_id IS NOT NULL) AS is_linked";
    params.unshift(planId);
  }
  const [rows] = await getDatabasePool().execute(
    `SELECT s.id, s.original_name, s.mime_type, s.extension, s.byte_size,
            s.char_count, s.chunk_count, s.checksum, s.status, s.error_message,
            s.metadata_json, s.created_at, s.updated_at, ${linkedSelect}
       FROM course_sources s
       ${planJoin}
      WHERE s.user_id = ? AND s.deleted_at IS NULL
      ORDER BY s.created_at DESC`,
    params
  );
  return rows.map(publicSource);
}

export async function softDeleteSourceRecord(userId, sourceId) {
  return withTransaction(async (connection) => {
    const [linkedPlans] = await connection.execute(
      `SELECT p.id, p.content_json
         FROM learning_plans p
         JOIN plan_sources ps ON ps.plan_id = p.id
        WHERE ps.source_id = ? AND p.user_id = ? AND p.deleted_at IS NULL
        FOR UPDATE`,
      [sourceId, userId]
    );
    const [result] = await connection.execute(
      `UPDATE course_sources
          SET deleted_at = CURRENT_TIMESTAMP(3)
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [sourceId, userId]
    );
    if (!result.affectedRows) return false;
    for (const row of linkedPlans) {
      const data = parseJson(row.content_json, {});
      const input = data.input || {};
      input.knowledgeSourceIds = (input.knowledgeSourceIds || []).filter((id) => id !== sourceId);
      input.knowledgeSources = (input.knowledgeSources || []).filter((source) => source.id !== sourceId);
      if (input.knowledgeGrounding) {
        input.knowledgeGrounding.citations = (input.knowledgeGrounding.citations || [])
          .filter((citation) => citation.sourceId !== sourceId);
        input.knowledgeGrounding.context = "";
      }
      data.input = input;
      await connection.execute(
        `UPDATE learning_plans SET content_json = ?, version = version + 1
          WHERE id = ? AND user_id = ?`,
        [JSON.stringify(data), row.id, userId]
      );
    }
    await connection.execute("DELETE FROM plan_sources WHERE source_id = ?", [sourceId]);
    return true;
  });
}

export async function replacePlanSourceRecords(userId, planId, sourceIds) {
  return withTransaction(async (connection) => {
    const [planRows] = await connection.execute(
      `SELECT id, content_json FROM learning_plans
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        FOR UPDATE`,
      [planId, userId]
    );
    if (!planRows.length) return null;
    const ownedIds = await selectOwnedReadyIds(connection, userId, sourceIds);
    if (ownedIds.length !== sourceIds.length) {
      const error = new Error("部分课程资料不存在、尚未解析完成或无权访问");
      error.statusCode = 400;
      throw error;
    }
    await connection.execute("DELETE FROM plan_sources WHERE plan_id = ?", [planId]);
    for (const sourceId of ownedIds) {
      await connection.execute(
        "INSERT INTO plan_sources (plan_id, source_id) VALUES (?, ?)",
        [planId, sourceId]
      );
    }
    const [sourceRows] = ownedIds.length
      ? await connection.execute(
        `SELECT id, original_name, mime_type, extension, byte_size, char_count, chunk_count,
                status, created_at, updated_at
           FROM course_sources
          WHERE user_id = ? AND id IN (${ownedIds.map(() => "?").join(",")})`,
        [userId, ...ownedIds]
      )
      : [[]];
    const planData = parseJson(planRows[0].content_json, {});
    planData.input = {
      ...(planData.input || {}),
      knowledgeSourceIds: ownedIds,
      knowledgeSources: sourceRows.map(publicSource),
      knowledgeGrounding: {
        context: "",
        citations: [],
        searchedChunks: 0,
        instruction: "课程资料绑定已更新；将在下一次内容生成或导师问答时按问题实时检索。"
      }
    };
    await connection.execute(
      `UPDATE learning_plans SET content_json = ?, version = version + 1
        WHERE id = ? AND user_id = ?`,
      [JSON.stringify(planData), planId, userId]
    );
    return ownedIds;
  });
}

export async function getSourceChunksForUser(userId, { sourceIds = [], planId = null } = {}) {
  const params = [userId];
  let scopeSql = "";
  if (planId) {
    scopeSql = "AND EXISTS (SELECT 1 FROM plan_sources ps WHERE ps.plan_id = ? AND ps.source_id = s.id)";
    params.push(planId);
  } else if (sourceIds.length) {
    scopeSql = `AND s.id IN (${sourceIds.map(() => "?").join(",")})`;
    params.push(...sourceIds);
  } else {
    return [];
  }
  const [rows] = await getDatabasePool().execute(
    `SELECT c.id, c.source_id, c.chunk_index, c.locator, c.title, c.content,
            c.keywords_json, c.token_count, s.original_name
       FROM course_source_chunks c
       JOIN course_sources s ON s.id = c.source_id
      WHERE s.user_id = ? AND s.status = 'ready' AND s.deleted_at IS NULL
        ${scopeSql}
      ORDER BY s.created_at DESC, c.chunk_index`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.original_name,
    chunkIndex: Number(row.chunk_index),
    locator: row.locator,
    title: row.title,
    content: row.content,
    keywords: parseJson(row.keywords_json, []),
    tokenCount: Number(row.token_count || 0)
  }));
}

export async function assertReadySourcesOwnedByUser(userId, sourceIds) {
  if (!sourceIds.length) return [];
  const ownedIds = await selectOwnedReadyIds(getDatabasePool(), userId, sourceIds);
  return ownedIds.length === sourceIds.length ? ownedIds : null;
}

async function selectOwnedReadyIds(connection, userId, sourceIds) {
  if (!sourceIds.length) return [];
  const [rows] = await connection.execute(
    `SELECT id FROM course_sources
      WHERE user_id = ? AND status = 'ready' AND deleted_at IS NULL
        AND id IN (${sourceIds.map(() => "?").join(",")})`,
    [userId, ...sourceIds]
  );
  const found = new Set(rows.map((row) => row.id));
  return sourceIds.filter((id) => found.has(id));
}

function publicSource(row) {
  return {
    id: row.id,
    name: row.original_name,
    mimeType: row.mime_type,
    extension: row.extension,
    byteSize: Number(row.byte_size || 0),
    charCount: Number(row.char_count || 0),
    chunkCount: Number(row.chunk_count || 0),
    checksum: row.checksum,
    status: row.status,
    errorMessage: row.error_message || null,
    metadata: parseJson(row.metadata_json, {}),
    linked: Boolean(row.is_linked),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
