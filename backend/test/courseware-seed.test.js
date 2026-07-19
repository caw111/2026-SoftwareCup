import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  chunkCourseSource,
  parseCourseSource,
  validateSourceUpload
} from "../src/rag.js";

const root = path.resolve(import.meta.dirname, "..", "..");
const coursewareDir = path.join(root, "courseware", "ai-machine-learning-basics");
const manifest = JSON.parse(fs.readFileSync(path.join(coursewareDir, "manifest.json"), "utf8"));

test("课程知识库包含完整高校课程输入并可被 RAG 解析分块", async () => {
  assert.equal(manifest.id, "ai-machine-learning-basics");
  assert.equal(manifest.sourceFiles.length >= 10, true);
  assert.ok(manifest.sourceFiles.includes("syllabus.md"));
  assert.ok(manifest.sourceFiles.includes("project-brief-campus-energy.md"));
  assert.ok(manifest.sourceFiles.includes("quiz-bank.json"));
  assert.ok(manifest.sourceFiles.includes("reading-list.json"));

  let totalChars = 0;
  let totalChunks = 0;
  for (const filename of manifest.sourceFiles) {
    const buffer = fs.readFileSync(path.join(coursewareDir, filename));
    const upload = validateSourceUpload({
      filename,
      mimeType: mimeTypeFor(filename),
      contentBase64: buffer.toString("base64")
    });
    const parsed = await parseCourseSource(upload);
    const chunks = chunkCourseSource(parsed.sections);
    totalChars += parsed.charCount;
    totalChunks += chunks.length;
    assert.equal(chunks.length > 0, true, `${filename} 应生成可引用片段`);
  }

  assert.equal(totalChars > 9000, true);
  assert.equal(totalChunks >= manifest.sourceFiles.length * 4, true);
  assert.equal(manifest.sourceFiles.filter((file) => file.startsWith("chapter-")).length >= 5, true);
  assert.equal(manifest.sourceFiles.filter((file) => file.startsWith("lab-")).length >= 2, true);
});

test("课程知识库种子脚本复用上传、解析、课程生成和绑定服务", () => {
  const script = fs.readFileSync(path.join(root, "scripts", "seed-course-sources.js"), "utf8");
  assert.match(script, /uploadSourceForUser/);
  assert.match(script, /loadFullSourceContextForUser/);
  assert.match(script, /runLocalAgents/);
  assert.match(script, /createPlanForUser/);
  assert.match(script, /setActivePlanForUser/);
  assert.doesNotMatch(script, /INSERT INTO course_sources|INSERT INTO learning_plans/i);
});

function mimeTypeFor(filename) {
  return {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json"
  }[path.extname(filename).toLowerCase()] || "application/octet-stream";
}
