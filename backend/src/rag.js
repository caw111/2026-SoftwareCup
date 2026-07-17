import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SOURCE_TOOL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tools",
  "extract_course_file.py"
);

export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_SOURCE_CHARS = 1_500_000;

export const SUPPORTED_SOURCE_TYPES = Object.freeze({
  ".txt": "纯文本",
  ".md": "Markdown",
  ".csv": "CSV 表格",
  ".json": "JSON 数据",
  ".pdf": "PDF",
  ".docx": "Word",
  ".pptx": "PowerPoint"
});

export function validateSourceUpload(payload) {
  const originalName = path.basename(String(payload?.filename || "").trim()).slice(0, 255);
  const extension = path.extname(originalName).toLowerCase();
  if (!originalName || !SUPPORTED_SOURCE_TYPES[extension]) {
    throw clientError(`仅支持 ${Object.keys(SUPPORTED_SOURCE_TYPES).join("、")} 格式`);
  }
  const contentBase64 = String(payload?.contentBase64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!contentBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
    throw clientError("文件内容不是有效的 Base64 编码");
  }
  const buffer = Buffer.from(contentBase64, "base64");
  if (!buffer.length) throw clientError("不能上传空文件");
  if (buffer.length > MAX_SOURCE_BYTES) throw clientError("单个课程文件不能超过 12 MB");
  return {
    originalName,
    extension,
    mimeType: String(payload?.mimeType || mimeForExtension(extension)).slice(0, 150),
    contentBase64,
    buffer,
    byteSize: buffer.length,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex")
  };
}

export async function parseCourseSource(upload, options = {}) {
  const parsed = [".txt", ".md", ".csv", ".json"].includes(upload.extension)
    ? parseTextSource(upload)
    : await (options.extractStructured || extractStructuredSource)(upload);
  const sections = normalizeSections(parsed.sections, upload.originalName);
  const charCount = sections.reduce((total, section) => total + section.text.length, 0);
  if (!charCount) throw clientError("文档中没有提取到可检索文字；扫描版 PDF 请先进行 OCR");
  if (charCount > MAX_SOURCE_CHARS) throw clientError("文档文字超过 150 万字，请拆分后上传");
  return { sections, charCount };
}

export function chunkCourseSource(sections, { targetChars = 900, overlapChars = 120 } = {}) {
  const chunks = [];
  for (const section of sections) {
    const blocks = splitSemanticBlocks(section.text);
    let current = "";
    let part = 1;
    const emit = (value) => {
      const content = value.trim();
      if (!content) return;
      const tokens = tokenizeForRetrieval(content);
      chunks.push({
        chunkIndex: chunks.length,
        locator: blocks.length > 1 ? `${section.locator} · 片段 ${part}` : section.locator,
        title: section.title,
        content,
        keywords: topKeywords(tokens),
        tokenCount: tokens.length
      });
      part += 1;
    };
    for (const block of blocks) {
      if (block.length > targetChars * 1.7) {
        if (current.trim().length > overlapChars) emit(current);
        current = "";
        const step = Math.max(1, targetChars - overlapChars);
        for (let offset = 0; offset < block.length; offset += step) {
          emit(block.slice(offset, offset + targetChars));
        }
      } else {
        if (current && current.length + block.length + 1 > targetChars) {
          emit(current);
          current = current.trim().slice(Math.max(0, current.trim().length - overlapChars));
        }
        current += `${current ? "\n" : ""}${block}`;
      }
    }
    if (current.trim()) emit(current);
  }
  return chunks.map((chunk, index) => ({ ...chunk, chunkIndex: index }));
}

export function tokenizeForRetrieval(value) {
  const normalized = String(value || "").toLowerCase().normalize("NFKC");
  const latin = normalized.match(/[a-z][a-z0-9_+.#-]{1,30}|\d+(?:\.\d+)?/g) || [];
  const chineseRuns = normalized.match(/[\u3400-\u9fff]{2,}/g) || [];
  const chinese = [];
  for (const run of chineseRuns) {
    if (run.length <= 5) chinese.push(run);
    for (let index = 0; index < run.length - 1; index += 1) chinese.push(run.slice(index, index + 2));
  }
  return [...latin, ...chinese].filter((token) => !STOPWORDS.has(token));
}

export function searchCourseChunks(chunks, query, { limit = 6 } = {}) {
  const queryTokens = [...new Set(tokenizeForRetrieval(query))];
  if (!queryTokens.length || !chunks.length) return [];
  const tokenized = chunks.map((chunk) => tokenizeForRetrieval(`${chunk.title || ""} ${chunk.content || ""}`));
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / tokenized.length || 1;
  const documentFrequency = new Map(queryTokens.map((token) => [
    token,
    tokenized.reduce((count, tokens) => count + (tokens.includes(token) ? 1 : 0), 0)
  ]));
  const queryText = String(query).toLowerCase();
  return chunks.map((chunk, index) => {
    const frequencies = frequencyMap(tokenized[index]);
    let score = 0;
    let matchedTerms = 0;
    for (const token of queryTokens) {
      const frequency = frequencies.get(token) || 0;
      if (!frequency) continue;
      matchedTerms += 1;
      const df = documentFrequency.get(token) || 0;
      const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
      const lengthNormalization = frequency + 1.2 * (0.25 + 0.75 * tokenized[index].length / averageLength);
      score += idf * (frequency * 2.2 / lengthNormalization);
    }
    const contentLower = String(chunk.content || "").toLowerCase();
    if (queryText.length >= 3 && contentLower.includes(queryText)) score += 3;
    score *= 0.7 + 0.3 * (matchedTerms / queryTokens.length);
    return { chunk, score, matchedTerms };
  }).filter((item) => item.matchedTerms > 0)
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)
    .slice(0, Math.max(1, Math.min(12, Number(limit) || 6)))
    .map(({ chunk, score, matchedTerms }, rank) => ({
      sourceId: chunk.sourceId,
      chunkId: chunk.id,
      title: chunk.sourceName || chunk.title,
      sectionTitle: chunk.title,
      locator: chunk.locator,
      quote: buildQuote(chunk.content, queryTokens),
      content: chunk.content,
      score: Number(score.toFixed(4)),
      matchedTerms,
      rank: rank + 1
    }));
}

export function buildRagContext(results, { maxChars = 7000 } = {}) {
  let used = 0;
  const citations = [];
  const blocks = [];
  for (const result of results) {
    const marker = `S${citations.length + 1}`;
    const heading = `[${marker}] ${result.title} · ${result.locator}`;
    const remaining = maxChars - used - heading.length - 2;
    if (remaining < 160) break;
    const content = String(result.content || result.quote || "").slice(0, remaining);
    blocks.push(`${heading}\n${content}`);
    used += heading.length + content.length + 2;
    citations.push({
      id: marker,
      sourceId: result.sourceId,
      chunkId: result.chunkId,
      title: result.title,
      sectionTitle: result.sectionTitle,
      locator: result.locator,
      quote: result.quote,
      score: result.score
    });
  }
  return {
    context: blocks.join("\n\n"),
    citations,
    instruction: citations.length
      ? "仅在资料支持的范围内陈述资料事实；引用时使用 [S1] 这类编号，不得虚构引用。"
      : "当前未检索到足够相关的课程资料，不要虚构资料引用。"
  };
}

function parseTextSource(upload) {
  let text = decodeText(upload.buffer);
  if (upload.extension === ".json") {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      throw clientError("JSON 文件格式无效");
    }
  }
  return { sections: splitTextSections(text, upload.originalName, upload.extension) };
}

function splitTextSections(text, originalName, extension) {
  const normalized = normalizeText(text);
  if (extension === ".md") {
    const sections = [];
    let current = { locator: "文档开头", title: originalName, lines: [] };
    for (const line of normalized.split("\n")) {
      const heading = line.match(/^#{1,4}\s+(.+)$/);
      if (heading && current.lines.some((item) => item.trim())) {
        sections.push({ ...current, text: current.lines.join("\n") });
        current = { locator: `章节：${heading[1].trim()}`, title: heading[1].trim(), lines: [line] };
      } else {
        if (heading) current = { locator: `章节：${heading[1].trim()}`, title: heading[1].trim(), lines: [] };
        current.lines.push(line);
      }
    }
    if (current.lines.some((item) => item.trim())) sections.push({ ...current, text: current.lines.join("\n") });
    return sections;
  }
  return [{ locator: "全文", title: originalName, text: normalized }];
}

function normalizeSections(sections, fallbackTitle) {
  return (Array.isArray(sections) ? sections : []).map((section, index) => ({
    locator: String(section?.locator || `第 ${index + 1} 部分`).slice(0, 255),
    title: String(section?.title || fallbackTitle).slice(0, 500),
    text: normalizeText(section?.text)
  })).filter((section) => section.text);
}

function extractStructuredSource(upload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_COMMAND || "python", [SOURCE_TOOL], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(clientError("文档解析超时，请拆分后重试"));
    }, 60_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(clientError(`无法启动文档解析组件：${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout || "{}");
        if (code !== 0 || result.error) throw new Error(result.error || stderr || "未知解析错误");
        resolve(result);
      } catch (error) {
        reject(clientError(`文档解析失败：${error.message}`));
      }
    });
    child.stdin.end(JSON.stringify({
      extension: upload.extension,
      contentBase64: upload.contentBase64
    }));
  });
}

function decodeText(buffer) {
  let text = buffer.toString("utf8");
  if (text.includes("\uFFFD")) {
    throw clientError("文本文件不是 UTF-8 编码，请转换编码后重新上传");
  }
  return text.replace(/^\uFEFF/, "");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function splitSemanticBlocks(text) {
  return normalizeText(text).split(/\n{2,}|(?<=[。！？；.!?])\s+/u).map((item) => item.trim()).filter(Boolean);
}

function topKeywords(tokens) {
  return [...frequencyMap(tokens).entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 24)
    .map(([token]) => token);
}

function frequencyMap(tokens) {
  const frequencies = new Map();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  return frequencies;
}

function buildQuote(content, queryTokens) {
  const value = String(content || "").replace(/\s+/g, " ").trim();
  const lower = value.toLowerCase();
  const positions = queryTokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0);
  const matchAt = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, matchAt - 70);
  const end = Math.min(value.length, start + 260);
  return `${start > 0 ? "…" : ""}${value.slice(start, end)}${end < value.length ? "…" : ""}`;
}

function mimeForExtension(extension) {
  return {
    ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
    ".json": "application/json", ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  }[extension] || "application/octet-stream";
}

function clientError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

const STOPWORDS = new Set([
  "一个", "一种", "这个", "这些", "以及", "可以", "进行", "通过", "需要", "相关",
  "the", "and", "for", "with", "from", "this", "that", "are", "was", "were"
]);
