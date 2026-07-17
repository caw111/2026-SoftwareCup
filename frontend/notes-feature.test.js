import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const frontendDir = path.resolve(import.meta.dirname);
const html = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
const app = fs.readFileSync(path.join(frontendDir, "app.js"), "utf8");
const styles = fs.readFileSync(path.join(frontendDir, "styles.css"), "utf8");

test("课程侧栏提供 Markdown 笔记视图", () => {
  assert.match(html, /data-view="notes">我的笔记<\/button>/);
  assert.match(html, /data-mode="notes"/);
  assert.doesNotMatch(html, /class="mode-toolbar"/);
  assert.match(app, /plan\.notes = event\.target\.value;[\s\S]*?saveState\(\);[\s\S]*?renderNotes\(\);/);
  assert.match(app, /class="notes-markdown markdown-body"[\s\S]*?renderMarkdown\(notes\)/);
});

test("重置学习进度必须先通过确认弹窗", () => {
  assert.match(html, /id="confirmResetProgressDialog" class="confirm-dialog"/);
  assert.match(app, /if \(!\(await requestResetProgressConfirmation\(plan\)\)\) return;[\s\S]*?plan\.progress = \{\};/);
  assert.match(app, /confirmResetProgressDialog\.addEventListener\("cancel"/);
});

test("测验与项目入口统一收纳在课程侧栏的实践评测分组", () => {
  assert.match(html, /class="course-nav-label">实践评测<\/span>[\s\S]*?data-view="practice">随堂测验<\/button>[\s\S]*?data-view="mistakes">错题复习<\/button>[\s\S]*?data-view="exam">综合考试<\/button>[\s\S]*?data-view="project">项目任务<\/button>/);
  assert.doesNotMatch(html, /class="assessment-subnav"/);
  assert.doesNotMatch(html, /id="regenerateQuizButton"/);
  assert.doesNotMatch(app, /regenerateQuizButton/);
  assert.match(styles, /\.course-nav-section/);
});
