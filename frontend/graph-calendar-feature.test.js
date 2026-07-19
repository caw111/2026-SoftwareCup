import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "frontend", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "frontend", "styles.css"), "utf8");
const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");

test("课程侧栏保留掌握度与学习日历入口并接入资源、导图和项目任务", () => {
  assert.match(html, /data-view="calendar">学习日历<\/button>/);
  assert.match(html, /data-view="knowledge">掌握度<\/button>/);
  assert.match(html, /data-view="resources">学习资源<\/button>/);
  assert.match(html, /data-view="mindmap">思维导图<\/button>/);
  assert.match(html, /data-view="project">项目任务<\/button>/);
  assert.match(html, /id="calendarPanel"/);
  assert.match(html, /id="resourcePanel"/);
  assert.match(html, /id="mindMapPanel"/);
  assert.match(html, /id="projectPanel"/);
});

test("前端掌握度和日历使用真实 API，资源类视图复用课程计划产物", () => {
  assert.match(app, /\/api\/activity\/summary\?planId=/);
  assert.match(app, /\/knowledge-graph\/refine/);
  assert.match(app, /currentKnowledgeGraph\(plan\)/);
  assert.match(app, /renderKnowledgeGraphSvg/);
  assert.match(app, /renderHeatmap/);
  assert.match(app, /真实连续学习/);
  assert.match(app, /resourceArtifactsFor\(plan\)/);
  assert.match(app, /renderResourceStudio/);
  assert.match(app, /renderMindMap/);
  assert.match(app, /renderProjectTasks/);
  assert.doesNotMatch(app, /\/mindmaps|mindMaps|projectSubmissions/);
});

test("后端只暴露掌握度图谱和活动摘要接口，导图与项目来自受治理的课程计划", () => {
  assert.match(server, /\/knowledge-graph/);
  assert.match(server, /refineKnowledgeGraphForUser/);
  assert.match(server, /getLearningActivitySummaryForUser/);
  assert.doesNotMatch(server, /generateMindMapForUser|getMindMapForUser|listMindMapsForUser|projectSubmissions/);
});

test("新增界面沿用纸张式视觉并适配移动端", () => {
  for (const selector of [
    ".knowledge-graph-workbench",
    ".knowledge-graph-svg",
    ".calendar-board",
    ".activity-heatmap",
    ".badge-card",
    ".resource-studio-board",
    ".resource-matrix",
    ".mindmap-workbench",
    ".mindmap-svg",
    ".project-task-grid",
    ".rubric-grid"
  ]) {
    assert.match(styles, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.mindmap-workbench/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.activity-heatmap/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.resource-section-grid/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.project-task-head/);
});

test("学习日历所在课程三栏布局会收缩中间栏以避免压到右栏", () => {
  const redesignStart = styles.lastIndexOf("/* Course detail redesign");
  const redesignedStyles = styles.slice(redesignStart);
  assert.match(redesignedStyles, /grid-template-columns:\s*220px minmax\(0, 1fr\) 300px/);
  assert.match(redesignedStyles, /width:\s*min\(calc\(100% - 48px\), 1260px\)/);
  assert.match(styles, /\.course-mode\[data-mode="calendar"\]\s*{[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /\.calendar-summary\s*{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(190px, 1fr\)\)/);
  assert.match(styles, /\.calendar-board,\s*[\s\S]*?\.calendar-board > \.result-card\s*{[\s\S]*?max-width:\s*100%/);
  assert.match(styles, /\.calendar-two-column\s*{[\s\S]*?grid-template-columns:\s*minmax\(0, 0\.95fr\) minmax\(260px, 0\.8fr\)/);
  assert.match(styles, /\.activity-heatmap\s*{[\s\S]*?width:\s*100%[\s\S]*?overflow-x:\s*auto/);
});
