import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "frontend", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "frontend", "styles.css"), "utf8");
const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");

test("课程侧栏保留掌握度与学习日历入口并移除导图和项目任务", () => {
  assert.match(html, /data-view="calendar">学习日历<\/button>/);
  assert.match(html, /data-view="knowledge">掌握度<\/button>/);
  assert.match(html, /id="calendarPanel"/);
  assert.doesNotMatch(html, /data-view="mindmap">思维导图<\/button>/);
  assert.doesNotMatch(html, /data-view="project">项目任务<\/button>/);
  assert.doesNotMatch(html, /id="mindMapPanel"|id="projectPanel"/);
});

test("前端掌握度和日历使用真实 API 与事件摘要", () => {
  assert.match(app, /\/api\/activity\/summary\?planId=/);
  assert.match(app, /\/knowledge-graph\/refine/);
  assert.match(app, /currentKnowledgeGraph\(plan\)/);
  assert.match(app, /renderKnowledgeGraphSvg/);
  assert.match(app, /renderHeatmap/);
  assert.match(app, /真实连续学习/);
  assert.doesNotMatch(app, /\/mindmaps|renderMindMap|mindMaps|projectTasks|projectSubmissions/);
});

test("后端只暴露掌握度图谱和活动摘要接口", () => {
  assert.match(server, /\/knowledge-graph/);
  assert.match(server, /refineKnowledgeGraphForUser/);
  assert.match(server, /getLearningActivitySummaryForUser/);
  assert.doesNotMatch(server, /mindmaps|generateMindMapForUser|getMindMapForUser|listMindMapsForUser/);
});

test("新增界面沿用纸张卡片视觉并适配移动端", () => {
  for (const selector of [
    ".knowledge-graph-workbench",
    ".knowledge-graph-svg",
    ".calendar-board",
    ".activity-heatmap",
    ".badge-card"
  ]) {
    assert.match(styles, new RegExp(selector.replace(".", "\\.")));
  }
  assert.doesNotMatch(styles, /mindmap-/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.knowledge-graph-workbench/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.activity-heatmap/);
});
