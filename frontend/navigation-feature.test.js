import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "frontend", "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "frontend", "styles.css"), "utf8");

test("课程侧栏开放完整成熟学习功能并按信息架构分组", () => {
  const nav = html.match(/<nav class="course-mode-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  const views = [
    "daily",
    "resources",
    "mindmap",
    "path-revisions",
    "notes",
    "diagnostic",
    "knowledge",
    "calendar",
    "remediation",
    "practice",
    "mistakes",
    "exam",
    "project",
    "report",
    "governance",
    "agents",
    "settings"
  ];

  assert.match(nav, /核心学习/);
  assert.match(nav, /学情分析/);
  assert.match(nav, /实践评测/);
  assert.match(nav, /成果与系统/);
  assert.match(nav, /data-view="resources">学习资源<\/button>/);
  assert.match(nav, /data-view="mindmap">思维导图<\/button>/);
  assert.match(nav, /data-view="project">项目任务<\/button>/);
  views.forEach((view) => {
    assert.equal((nav.match(new RegExp(`data-view="${view}"`, "g")) || []).length, 1, `${view} 应有且只有一个侧栏入口`);
  });
});

test("移动端课程导航复用同一组入口而不是复制子导航", () => {
  assert.doesNotMatch(html, /class="assessment-subnav"/);
  assert.match(styles, /\.course-nav-section\s*\{[\s\S]*?display:\s*contents/);
  assert.match(styles, /\.course-nav-label\s*\{[\s\S]*?display:\s*none/);
});
