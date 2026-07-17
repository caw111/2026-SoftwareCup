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

test("三个测验入口在测验子页面共用同一组常驻导航", () => {
  assert.match(html, /class="assessment-subnav"[\s\S]*?data-view="practice">随堂测验<\/button>[\s\S]*?data-view="mistakes">错题复习<\/button>[\s\S]*?data-view="exam">综合考试<\/button>/);
  assert.doesNotMatch(html, /id="regenerateQuizButton"/);
  assert.doesNotMatch(app, /regenerateQuizButton/);
  assert.match(styles, /\.assessment-subnav \{[\s\S]*?position: sticky;/);
  assert.match(styles, /body\[data-course-mode="practice"\] \.assessment-subnav,[\s\S]*?body\[data-course-mode="mistakes"\] \.assessment-subnav,[\s\S]*?body\[data-course-mode="exam"\] \.assessment-subnav/);
});
