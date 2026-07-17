import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "frontend", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "frontend", "styles.css"), "utf8");
const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");

test("首页以对话访谈作为画像主入口并保留结构化精调", () => {
  assert.match(html, /id="profileMessageForm"[\s\S]*?id="profileMessageInput"/);
  assert.match(html, /id="profileMessages"/);
  assert.match(html, /id="profileRadar"/);
  assert.match(html, /id="profileFieldChecklist"/);
  assert.match(html, /精调画像与课程输出/);
  assert.match(html, /name="major"/);
  assert.match(html, /name="learningHistory"/);
});

test("对话结果会自动回填课程生成字段并持久化访谈", () => {
  assert.match(app, /request\("\/api\/profile\/interview"/);
  assert.match(app, /applyProfileDraftToForm\(result\.draft \|\| \{\}\)/);
  assert.match(app, /profileInterview: state\.profileInterview \|\| null/);
  assert.match(server, /POST" && url\.pathname === "\/api\/profile\/interview"/);
});

test("画像布局沿用现有卡片体系并提供桌面与移动响应式布局", () => {
  assert.match(styles, /\.profile-interview \{[\s\S]*?grid-template-columns:/);
  assert.match(styles, /\.profile-message\.student/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.profile-interview \{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(styles, /\.profile-confirm-form/);
});
