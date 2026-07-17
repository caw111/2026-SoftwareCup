import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "frontend", "index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "frontend", "app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "frontend", "styles.css"), "utf8");
const server = fs.readFileSync(path.join(ROOT, "backend", "server.js"), "utf8");

test("课程资料库提供成熟上传、选择、状态和检索验证界面", () => {
  assert.match(html, /id="sourceFileInput"[^>]+multiple/);
  assert.match(html, /\.pdf,\.docx,\.pptx,\.md,\.txt,\.csv,\.json/);
  assert.match(html, /id="sourceLibrary"/);
  assert.match(html, /id="sourceSearchQuery"/);
  assert.match(html, /id="sourceSearchResults"/);
  assert.match(app, /uploadCourseFiles/);
  assert.match(app, /validateSourceFileInBrowser/);
  assert.match(app, /requestSourceRemoval/);
  assert.match(app, /renderCitationCard/);
});

test("课程生成、导师问答和已有课程绑定均携带真实资料范围", () => {
  assert.match(app, /payload\.knowledgeSourceIds\s*=/);
  assert.match(app, /credentials:\s*"include"/);
  assert.match(app, /planId:\s*state\.databaseReady/);
  assert.match(app, /sourceIds:\s*plan\?\.data\?\.input\?\.knowledgeSourceIds/);
  assert.match(app, /api\/plans\/\$\{encodeURIComponent\(plan\.id\)\}\/sources/);
  assert.match(server, /\/api\/sources\/search/);
  assert.match(server, /knowledgeGrounding/);
});

test("资料与引用沿用现有纸张卡片视觉并完整适配移动端", () => {
  for (const selector of [
    ".course-source-workspace",
    ".source-dropzone",
    ".source-item",
    ".citation-card",
    ".course-grounding-card",
    ".tutor-citations"
  ]) assert.match(css, new RegExp(selector.replace(".", "\\.")));
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.course-source-workspace/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.course-citation-grid/);
});
