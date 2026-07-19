import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeInput, runLocalAgents } from "../backend/src/learning.js";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "frontend", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "frontend", "styles.css"), "utf8");
const agents = fs.readFileSync(path.join(root, "backend", "src", "agents.js"), "utf8");

const onlineReadings = [
  {
    title: "Deep Learning",
    authors: ["Ian Goodfellow", "Yoshua Bengio", "Aaron Courville"],
    year: 2016,
    venue: "MIT Press",
    doi: "",
    url: "https://www.deeplearningbook.org/",
    provider: "OfficialBookSite",
    citationCount: 50000,
    reason: "来自在线成熟资料元数据。"
  },
  {
    title: "TensorFlow: Large-Scale Machine Learning on Heterogeneous Distributed Systems",
    authors: ["Martín Abadi"],
    year: 2016,
    venue: "arXiv",
    doi: "10.48550/arXiv.1603.04467",
    url: "https://arxiv.org/abs/1603.04467",
    provider: "arXiv",
    citationCount: 9000,
    reason: "来自在线成熟资料元数据。"
  },
  {
    title: "Scikit-learn: Machine Learning in Python",
    authors: ["Fabian Pedregosa"],
    year: 2011,
    venue: "Journal of Machine Learning Research",
    doi: "",
    url: "https://jmlr.org/papers/v12/pedregosa11a.html",
    provider: "JMLR",
    citationCount: 60000,
    reason: "来自在线成熟资料元数据。"
  }
];

test("本地多智能体生成五类可展示学习资源并使用在线拓展阅读", async () => {
  const plan = await runLocalAgents(normalizeInput({
    subject: "机器学习基础",
    topic: "机器学习基础",
    goal: "能够完成校园能耗预测项目并解释模型评估结果",
    level: "计算机专业大二，Python 入门",
    duration: "4周",
    dailyTime: "60分钟",
    style: "项目实战 + 在线资料",
    resources: "课程讲义、实验任务、测验题库",
    onlineReadingRecommendations: onlineReadings
  }));

  const data = plan.data || plan;
  assert.ok(data.resourcePackage);
  assert.ok(data.resourceStudio);
  assert.ok(data.mindMap?.root);
  assert.ok(data.projectTasks?.length >= 1);
  assert.ok(data.readingRecommendations?.length >= 3);
  assert.equal("multimodalCards" in data, false);
  assert.equal(data.readingRecommendations.every((item) => item.url || item.doi), true);
  assert.equal(data.resourceStudio.matrix.length, 5);
  assert.ok(data.resourceStudio.matrix.filter((item) => item.ready).length >= 5);
  assert.equal(data.generationLoop.peerReview.summary.blockingIssues, 0);
  assert.ok(data.governanceReport.peerReview.summary.artifactCount >= 6);
  assert.ok(data.generationLoop.review.checks.some((item) => item.label === "同行复核闭环" && item.passed));
  assert.ok(data.governanceReport.peerReview.artifacts.some((item) => item.artifactId === "project-task-v1" && item.status === "approved"));
  assert.ok(data.projectTasks[0].starterFiles?.some((file) => file.filename === "src/pipeline.py"));
  assert.ok(data.projectTasks[0].starterFiles?.some((file) => file.filename === "tests/test_pipeline.py"));
  assert.ok(data.projectTasks[0].starterFiles?.some((file) => file.filename === "sample_data.csv"));
  assert.ok(data.projectTasks[0].qualityGates?.some((item) => item.command.includes("unittest")));
  assert.equal(data.projectTasks[0].rubric?.reduce((sum, item) => sum + Number(item.weight || 0), 0), 100);
});

test("资源、导图和项目任务有独立课程视图与可导出交付物", () => {
  assert.match(html, /data-mode="resources"[\s\S]*id="resourcePanel"/);
  assert.match(html, /data-mode="mindmap"[\s\S]*id="mindMapPanel"/);
  assert.match(html, /data-mode="project"[\s\S]*id="projectPanel"/);
  assert.match(app, /function renderResourceStudio\(\)/);
  assert.match(app, /function renderMindMap\(\)/);
  assert.match(app, /function renderProjectTasks\(\)/);
  assert.match(app, /data-zoom-mindmap/);
  assert.match(app, /data-close-mindmap-zoom/);
  assert.match(app, /function toggleMindMapZoom\(canvas, force\)/);
  assert.match(app, /多智能体同行复核/);
  assert.match(app, /同行复核门禁/);
  assert.match(app, /function onlineReadingMarkdown\(readings\)/);
  assert.match(app, /downloadBlob\(`\$\{safeFilename\(mindMap\.title\)\}\.svg`/);
  assert.match(app, /downloadBlob\(`\$\{safeFilename\(task\?\.title\)\}-project-package\.md`/);
  assert.match(app, /starterFiles/);
  assert.match(app, /qualityGates/);
  assert.match(app, /acceptanceCriteria/);
  assert.match(app, /rubric/);
  assert.doesNotMatch(app, /multimodal|多模态|讲解卡|分镜/);
  assert.doesNotMatch(html, /multimodal|多模态|讲解卡|分镜/);
});

test("资源中心样式延续现有纸张式设计并覆盖移动端布局", () => {
  for (const selector of [
    ".resource-studio-board",
    ".resource-section-grid",
    ".reading-recommendation-list",
    ".mindmap-board",
    ".mindmap-toolbar",
    ".mindmap-workbench",
    ".project-board",
    ".project-task-card",
    ".starter-file-list",
    ".rubric-grid",
    ".peer-review-list",
    ".agent-peer-review"
  ]) {
    assert.match(styles, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.resource-matrix/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.mindmap-canvas/);
  assert.match(styles, /\.reading-recommendation-list a/);
  assert.doesNotMatch(styles, /multimodal|多模态|讲解卡|分镜/);
});

test("思维导图画布与大纲采用上下结构并支持浏览器内放大", () => {
  const workbenchRule = styles.match(/\.mindmap-workbench\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(workbenchRule, /display:\s*grid/);
  assert.doesNotMatch(workbenchRule, /grid-template-columns/);
  assert.match(styles, /\.mindmap-canvas\.zoomed/);
  assert.match(styles, /body\.mindmap-zoom-active/);
  assert.doesNotMatch(styles, /:fullscreen|fullscreen-fallback/);
  assert.doesNotMatch(app, /requestFullscreen|exitFullscreen|fullscreenElement/);
});

test("核心生成与展示文件不包含历史乱码片段", () => {
  const files = [
    path.join(root, "frontend", "app.js"),
    path.join(root, "frontend", "index.html"),
    path.join(root, "backend", "src", "learning.js"),
    path.join(root, "backend", "src", "adaptive-learning.js")
  ];
  const mojibakePattern = /瀛︿範|鐢熸垚|璇剧▼|鍙紪|澶х翰|鎬濈淮|椤圭洰|璧勬簮|绛夊緟|鍚庣|浠诲姟|瑙ｉ噴|妯″瀷|棰勬祴|�/;

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8")
      .replace(/function containsLegacyMojibakeClient[\s\S]*?\n}\n/, "");
    assert.doesNotMatch(source, mojibakePattern, file);
  }
});

test("公开智能体目录覆盖实际协作流程角色", () => {
  for (const agentId of [
    "daily-agent",
    "resource-studio-agent",
    "quality-agent",
    "package-agent"
  ]) {
    assert.match(agents, new RegExp(`id: "${agentId}"`));
  }
});
