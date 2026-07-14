const API_BASE = `${location.protocol}//${location.hostname || "127.0.0.1"}:3000`;
const STORAGE_KEY = "software-cup-learning-workspace-v2";

const state = loadState();
let activeView = location.hash.replace("#", "") || "home";
let flowTimer = null;
let persistTimer = null;
const COURSE_MODES = [
  "daily",
  "diagnostic",
  "knowledge",
  "remediation",
  "practice",
  "mistakes",
  "exam",
  "project",
  "report",
  "coach",
  "settings",
  "governance",
  "agents"
];
let activeCourseMode = COURSE_MODES.includes(activeView) ? activeView : "daily";
const RECOMMENDED_COURSES = [
  {
    topic: "机器学习基础",
    title: "机器学习基础",
    description: "从问题定义、训练流程到入门预测项目。",
    chapters: ["问题与数据", "模型训练", "评估指标"]
  },
  {
    topic: "数据结构与算法",
    title: "数据结构与算法",
    description: "把数组、链表、栈、队列和复杂度串成练习路径。",
    chapters: ["线性表", "栈与队列", "复杂度分析"]
  },
  {
    topic: "英语口语提升",
    title: "英语口语提升",
    description: "围绕真实场景生成表达、跟读和复盘任务。",
    chapters: ["日常表达", "场景对话", "口语复盘"]
  }
];

const els = {
  form: document.querySelector("#learningForm"),
  resultMode: document.querySelector("#resultMode"),
  dailyPanel: document.querySelector("#dailyPanel"),
  progressSummary: document.querySelector("#progressSummary"),
  serviceStatus: document.querySelector("#serviceStatus"),
  modelStatus: document.querySelector("#modelStatus"),
  healthButton: document.querySelector("#healthButton"),
  llmTestButton: document.querySelector("#llmTestButton"),
  agentList: document.querySelector("#agentList"),
  agentCanvas: document.querySelector("#agentCanvas"),
  agentMode: document.querySelector("#agentMode"),
  statusDot: document.querySelector(".status-dot"),
  coachQuestion: document.querySelector("#coachQuestion"),
  coachButton: document.querySelector("#coachButton"),
  coachAnswer: document.querySelector("#coachAnswer"),
  coachMode: document.querySelector("#coachMode"),
  savedPlans: document.querySelector("#savedPlans"),
  myCourses: document.querySelector("#myCourses"),
  planCount: document.querySelector("#planCount"),
  generationFlow: document.querySelector("#generationFlow"),
  topicInput: document.querySelector("#topicInput"),
  courseTitleMini: document.querySelector("#courseTitleMini"),
  courseProgressMini: document.querySelector("#courseProgressMini"),
  courseProgressMeter: document.querySelector("#courseProgressMeter"),
  courseOutline: document.querySelector("#courseOutline"),
  courseHeroCover: document.querySelector("#courseHeroCover"),
  courseHeroTitle: document.querySelector("#courseHeroTitle"),
  courseHeroSummary: document.querySelector("#courseHeroSummary"),
  courseHeroMeta: document.querySelector("#courseHeroMeta"),
  courseHeroStats: document.querySelector("#courseHeroStats"),
  todayLearning: document.querySelector("#todayLearning"),
  todayTitle: document.querySelector("#todayTitle"),
  todayGoal: document.querySelector("#todayGoal"),
  todayMeta: document.querySelector("#todayMeta"),
  continueTodayButton: document.querySelector("#continueTodayButton"),
  overviewProgress: document.querySelector("#overviewProgress"),
  overviewProgressMeter: document.querySelector("#overviewProgressMeter"),
  overviewCompleted: document.querySelector("#overviewCompleted"),
  overviewMastery: document.querySelector("#overviewMastery"),
  overviewStreak: document.querySelector("#overviewStreak"),
  currentAdvice: document.querySelector("#currentAdvice"),
  knowledgePanel: document.querySelector("#knowledgePanel"),
  masteryMode: document.querySelector("#masteryMode"),
  diagnosticPanel: document.querySelector("#diagnosticPanel"),
  diagnosticMode: document.querySelector("#diagnosticMode"),
  remediationPanel: document.querySelector("#remediationPanel"),
  remediationMode: document.querySelector("#remediationMode"),
  practicePanel: document.querySelector("#practicePanel"),
  regenerateQuizButton: document.querySelector("#regenerateQuizButton"),
  judgeStatus: document.querySelector("#judgeStatus"),
  governancePanel: document.querySelector("#governancePanel"),
  governanceMode: document.querySelector("#governanceMode"),
  mistakePanel: document.querySelector("#mistakePanel"),
  mistakeMode: document.querySelector("#mistakeMode"),
  reportPanel: document.querySelector("#reportPanel"),
  reportMode: document.querySelector("#reportMode"),
  examPanel: document.querySelector("#examPanel"),
  examMode: document.querySelector("#examMode"),
  projectPanel: document.querySelector("#projectPanel"),
  projectMode: document.querySelector("#projectMode"),
  settingsPanel: document.querySelector("#settingsPanel"),
  settingsMode: document.querySelector("#settingsMode"),
  tutorMode: document.querySelector("#tutorMode"),
  hintLevel: document.querySelector("#hintLevel")
};

els.healthButton.addEventListener("click", checkHealth);
els.healthButton.addEventListener("click", checkJudgeStatus);
els.llmTestButton.addEventListener("click", testLargeModel);
els.form.addEventListener("submit", generatePlan);
els.coachButton.addEventListener("click", askTutor);
els.regenerateQuizButton.addEventListener("click", () => loadQuiz(true));
els.practicePanel.addEventListener("keydown", handleCodeTextareaKeydown, true);
window.addEventListener("hashchange", syncRoute);
document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => setView(link.dataset.view));
});
document.querySelectorAll("[data-scroll-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(`#${button.dataset.scrollTarget}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
document.querySelectorAll("[data-topic-chip]").forEach((button) => {
  button.addEventListener("click", () => {
    const topic = button.dataset.topicChip;
    const examples = {
      AI: "生成式 AI 应用开发",
      编程: "数据结构与算法",
      考试: "高等数学期末复习",
      语言: "英语口语提升",
      金融: "个人理财基础",
      设计: "产品设计入门",
      项目实战: "用 Node.js 做一个学习助手"
    };
    els.topicInput.value = examples[topic] || topic;
    els.topicInput.focus();
  });
});

boot();

function boot() {
  setView(activeView, { replace: true });
  renderAll();
  renderIdleFlow();
  loadAgents();
  loadDiskState();
  checkHealth();
  checkJudgeStatus();
  if (getCurrentPlan()) {
    els.coachMode.textContent = "已加载学习上下文";
  }
}

async function checkJudgeStatus() {
  if (!els.judgeStatus) return;
  els.judgeStatus.textContent = "服务端判题检测中";
  els.judgeStatus.className = "status-pill";
  try {
    const data = await request("/api/judge/status");
    state.judgeReady = Boolean(data.ok);
    els.judgeStatus.textContent = data.ok ? "服务端判题可用" : data.detail || "服务端判题未就绪";
    els.judgeStatus.classList.toggle("ok", data.ok);
    els.judgeStatus.classList.toggle("bad", !data.ok);
  } catch (error) {
    state.judgeReady = false;
    els.judgeStatus.textContent = "服务端判题未就绪";
    els.judgeStatus.title = error.message;
    els.judgeStatus.classList.add("bad");
  }
}

async function loadDiskState() {
  try {
    let databaseState = await request("/api/workspace");
    if (!databaseState?.plans?.length && state.plans.length) {
      await request("/api/workspace/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serializeState())
      });
      databaseState = await request("/api/workspace");
    }
    applyDatabaseState(databaseState);
    state.databaseReady = true;
  } catch {
    state.databaseReady = false;
  }
}

function applyDatabaseState(databaseState) {
  state.plans = databaseState?.plans || [];
  state.currentPlanId = databaseState?.currentPlanId || state.plans[0]?.id || null;
  state.quiz = databaseState?.quiz || [];
  state.quizResults = databaseState?.quizResults || {};
  saveState();
  renderAll();
}

function syncRoute() {
  setView(location.hash.replace("#", "") || "home", { replace: true });
}

function setView(view, options = {}) {
  const requested = view === "course" ? "daily" : view;
  const isCourseMode = COURSE_MODES.includes(requested);
  activeView = isCourseMode
    ? requested
    : document.querySelector(`#${requested}.view`)
      ? requested
      : "home";
  if (isCourseMode) activeCourseMode = activeView;
  const shellView = isCourseMode ? "course" : activeView;
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === shellView);
  });
  document.querySelectorAll(".course-mode").forEach((section) => {
    section.classList.toggle("active", section.dataset.mode === activeCourseMode);
  });
  const group = courseModeGroup(activeView);
  document.querySelectorAll(".nav-link").forEach((link) => {
    const linkGroup = link.dataset.group;
    link.classList.toggle("active", link.dataset.view === activeView || (linkGroup && linkGroup === group));
  });
  document.body.dataset.view = shellView;
  document.body.dataset.courseMode = isCourseMode ? activeCourseMode : "";
  if (!options.replace) location.hash = activeView;
  renderCourseChrome();
}

function courseModeGroup(view) {
  if (view === "daily") return "path";
  if (view === "knowledge" || view === "remediation") return "mastery";
  if (["practice", "mistakes", "exam", "diagnostic"].includes(view)) return "assessment";
  if (view === "report") return "report";
  return view;
}

async function checkHealth() {
  try {
    const data = await request("/api/health");
    els.serviceStatus.textContent = "后端已连接";
    els.modelStatus.textContent = formatModelStatus(data);
    els.statusDot.classList.add("ok");
  } catch {
    els.serviceStatus.textContent = "后端未连接";
    els.modelStatus.textContent = "请先运行 npm run dev";
    els.statusDot.classList.remove("ok");
  }
}

async function testLargeModel() {
  els.llmTestButton.disabled = true;
  els.llmTestButton.textContent = "测试中";

  try {
    const data = await request("/api/llm-test");
    els.serviceStatus.textContent = data.ok ? "大模型已连接" : "大模型未连接";
    els.modelStatus.textContent = data.ok
      ? `${data.llm.model}：${data.sample || data.message}`
      : `${data.message}${data.detail ? ` ${data.detail}` : ""}`;
    els.statusDot.classList.toggle("ok", data.ok);
  } catch (error) {
    els.serviceStatus.textContent = "大模型测试失败";
    els.modelStatus.textContent = error.message;
    els.statusDot.classList.remove("ok");
  } finally {
    els.llmTestButton.disabled = false;
    els.llmTestButton.textContent = "测试大模型";
  }
}

function formatModelStatus(data) {
  if (!data.llmEnabled) return "本地规则模式，可离线演示";
  return `大模型：${data.llm.model} / ${data.llm.wireApi} / ${data.llm.baseUrl}`;
}

async function loadAgents() {
  try {
    const data = await request("/api/agents");
    state.agents = data.agents || [];
    saveState();
    renderAgents();
  } catch {
    els.agentList.innerHTML = `<p class="warning">暂时无法加载智能体列表。</p>`;
  }
}

async function generatePlan(event) {
  event.preventDefault();
  const submitButtons = [...els.form.querySelectorAll("button[type='submit']")];
  const submitButton = submitButtons[0];
  submitButtons.forEach((button) => {
    button.disabled = true;
  });
  submitButton.textContent = "正在生成课程";

  const payload = Object.fromEntries(new FormData(els.form).entries());
  startFlowSession();
  setView("home");

  try {
    const data = await requestGeneratedPlan(payload);
    const plan = normalizeNewPlan(data);
    const saved = state.databaseReady
      ? await request("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan })
      })
      : { plan };
    state.plans.unshift(saved.plan);
    state.currentPlanId = saved.plan.id;
    state.quiz = [];
    state.quizResults = {};
    recordBehavior("plan-generated", { planId: saved.plan.id, detail: saved.plan.title });
    saveState();
    renderAll();
    renderFlow(data.generationLoop, "done");
    setView("daily");
    els.coachMode.textContent = "已加载学习上下文";
  } catch (error) {
    els.generationFlow.className = "flow-board";
    els.generationFlow.innerHTML = `<p class="warning">生成失败：${escapeHtml(error.message)}</p>`;
  } finally {
    submitButtons.forEach((button) => {
      button.disabled = false;
    });
    submitButton.textContent = "生成课程";
  }
}

function normalizeNewPlan(data) {
  return {
    id: `plan-${Date.now()}`,
    title: data.resourcePackage?.title || `${data.input?.topic || "学习"}课程`,
    createdAt: new Date().toISOString(),
    category: data.input?.outputType || "完整学习课程",
    data,
    progress: {},
    notes: "",
    masteryEvidence: [],
    masteryHistory: [],
    quizHistory: []
  };
}

function renderAll() {
  renderCourseChrome();
  renderSavedPlans();
  renderDailyPlan();
  renderDiagnostic();
  renderKnowledge();
  renderRemediation();
  renderPractice();
  renderMistakes();
  renderExam();
  renderProject();
  renderReport();
  renderSettings();
  renderGovernance();
  renderAgents();
}

function renderCourseChrome() {
  if (!els.courseHeroTitle) return;
  const plan = getCurrentPlan();
  if (!plan) {
    els.courseTitleMini.textContent = "选择一门课程";
    els.courseProgressMini.textContent = "0%";
    els.courseProgressMeter.value = 0;
    els.courseHeroMeta.textContent = "Course";
    els.courseHeroTitle.textContent = "选择一门课程";
    els.courseHeroSummary.textContent = "从首页生成课程，或在“我的课程”中继续学习。";
    els.courseHeroStats.innerHTML = "";
    els.todayTitle.textContent = "等待课程生成";
    els.todayGoal.textContent = "生成课程后，这里会显示当前章节、学习目标和继续学习入口。";
    els.todayMeta.innerHTML = "";
    els.continueTodayButton.disabled = true;
    els.overviewProgress.textContent = "0%";
    els.overviewProgressMeter.value = 0;
    els.overviewCompleted.textContent = "0 / 0";
    els.overviewMastery.textContent = "--";
    els.overviewStreak.textContent = "0 天";
    els.currentAdvice.textContent = "生成课程后，这里会根据进度给出下一步建议。";
    return;
  }

  const summary = progressSummaryFor(plan);
  const current = currentLearningDay(plan);
  const mastery = averageMastery(plan);
  const streak = learningStreak(plan);
  const description = plan.data?.learnerProfile?.summary
    || plan.data?.input?.goal
    || "这门课程会把章节、练习、测验和帮助问答串成一条学习路径。";
  const input = plan.data?.input || {};
  const status = summary.percent >= 100 ? "已完成" : summary.done > 0 ? "进行中" : "未开始";
  els.courseTitleMini.textContent = plan.title;
  els.courseProgressMini.textContent = `${summary.percent}%`;
  els.courseProgressMeter.value = summary.percent;
  els.courseHeroMeta.textContent = `${status} · ${formatDate(plan.createdAt)}`;
  els.courseHeroTitle.textContent = plan.title;
  els.courseHeroSummary.textContent = description;
  els.courseHeroStats.innerHTML = [
    ["难度", input.level || "入门"],
    ["每日时长", input.dailyMinutes || current.day?.estimate || "45 分钟"],
    ["学习方式", input.style || "案例驱动"],
    ["任务进度", `${summary.done}/${summary.total}`]
  ].map(([label, value]) => `<span><b>${label}</b>${escapeHtml(value)}</span>`).join("");

  els.todayTitle.textContent = current.day?.title || plan.title;
  els.todayGoal.textContent = current.day?.checkpoint || current.day?.focus || input.goal || "完成当前章节的核心任务。";
  els.todayMeta.innerHTML = [
    `当前章节：Day ${current.day?.day || 1}`,
    current.day?.estimate || input.dailyMinutes || "45 分钟",
    `${current.day?.tasks?.length || 0} 个任务`
  ].map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  els.continueTodayButton.disabled = false;
  els.continueTodayButton.onclick = () => {
    setView("daily");
    const detail = document.querySelector(`[data-day-id="${cssEscape(current.dayKey)}"]`);
    if (detail) {
      detail.open = true;
      detail.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  els.overviewProgress.textContent = `${summary.percent}%`;
  els.overviewProgressMeter.value = summary.percent;
  els.overviewCompleted.textContent = `${summary.done} / ${summary.total}`;
  els.overviewMastery.textContent = mastery === null ? "--" : `${mastery}%`;
  els.overviewStreak.textContent = `${streak} 天`;
  els.currentAdvice.textContent = buildCurrentAdvice(plan, current, summary);
}

function currentLearningDay(plan) {
  const days = plan?.data?.dailyPlan || [];
  if (!days.length) return { day: null, dayKey: "day-1", index: 0 };
  const progress = plan.progress || {};
  const index = days.findIndex((day) => !isDayComplete(day, progress));
  const safeIndex = index === -1 ? days.length - 1 : index;
  const day = days[safeIndex];
  return { day, dayKey: `day-${day.day}`, index: safeIndex };
}

function isDayComplete(day, progress) {
  const tasks = day?.tasks || [];
  return tasks.length > 0 && tasks.every((_, index) => progress[progressId(day.day, index)]);
}

function averageMastery(plan) {
  const concepts = plan?.data?.adaptiveState?.concepts
    || plan?.data?.knowledgeGraph?.concepts
    || plan?.data?.learnerProfile?.mastery
    || [];
  if (!concepts.length) return null;
  const total = concepts.reduce((sum, item) => sum + Number(item.masteryScore ?? item.score ?? 0), 0);
  return Math.round(total / concepts.length);
}

function learningStreak(plan) {
  const days = plan?.data?.dailyPlan || [];
  const progress = plan?.progress || {};
  let streak = 0;
  for (const day of days) {
    if (!isDayComplete(day, progress)) break;
    streak += 1;
  }
  return streak;
}

function buildCurrentAdvice(plan, current, summary) {
  if (summary.percent >= 100) return "课程任务已完成，可以进入学习报告复盘整体表现。";
  if (plan.data?.remediationPlan?.target) return `优先复习：${plan.data.remediationPlan.target}。`;
  if (current.day?.title) return `先完成「${current.day.title}」中的未完成任务，再生成一次测验。`;
  return "先完成今天的学习任务，再进行测验与复习。";
}

function renderSavedPlans() {
  const countText = `${state.plans.length} 门课程`;
  if (els.planCount) els.planCount.textContent = countText;

  const containers = [els.savedPlans, els.myCourses].filter(Boolean);
  if (!state.plans.length) {
    const recommendations = RECOMMENDED_COURSES.map(renderRecommendedCourseCard).join("");
    containers.forEach((container) => {
      container.className = "course-grid";
      container.innerHTML = recommendations;
      bindRecommendedCourseActions(container);
    });
    return;
  }

  const markup = state.plans.map(renderCourseCard).join("");
  containers.forEach((container) => {
    container.className = "course-grid";
    container.innerHTML = markup;
    bindCourseCardActions(container);
  });
}

function renderCourseCard(plan) {
  const summary = progressSummaryFor(plan);
  const quizStatus = quizStatusFor(plan);
  const active = plan.id === state.currentPlanId;
  const chapters = (plan.data?.dailyPlan || []).slice(0, 3);
  const description = plan.data?.learnerProfile?.summary
    || plan.data?.input?.goal
    || "一门可打卡、可测评、可追问的个性化课程。";
  return `
    <article class="plan-card ${active ? "active" : ""}">
      <div class="plan-card-cover">${escapeHtml(courseInitials(plan.title))}</div>
      <div>
        <span class="tag">${escapeHtml(plan.category || "个性化课程")}</span>
        <h3>${escapeHtml(plan.title)}</h3>
        <p>${escapeHtml(description)}</p>
        <small>${formatDate(plan.createdAt)} · 进度 ${summary.done}/${summary.total} · ${summary.percent}% · ${escapeHtml(quizStatus)}</small>
      </div>
      <div class="chapter-preview">
        ${chapters.map((day) => `<span>${escapeHtml(day.title || `第 ${day.day} 章`)}</span>`).join("")}
      </div>
      <div class="plan-actions">
        <button class="ghost-button" type="button" data-open-plan="${escapeHtml(plan.id)}">${active ? "继续学习" : "进入课程"}</button>
        <button class="text-button" type="button" data-delete-plan="${escapeHtml(plan.id)}">删除</button>
      </div>
    </article>
  `;
}

function renderRecommendedCourseCard(course) {
  return `
    <article class="plan-card recommended-card">
      <div class="plan-card-cover">${escapeHtml(courseInitials(course.title))}</div>
      <div>
        <span class="tag">推荐课程</span>
        <h3>${escapeHtml(course.title)}</h3>
        <p>${escapeHtml(course.description)}</p>
        <small>输入主题后生成章节、Quiz、Tutor 和 Report</small>
      </div>
      <div class="chapter-preview">
        ${course.chapters.map((chapter) => `<span>${escapeHtml(chapter)}</span>`).join("")}
      </div>
      <div class="plan-actions">
        <button class="ghost-button" type="button" data-recommend-topic="${escapeHtml(course.topic)}">用这个主题生成</button>
      </div>
    </article>
  `;
}

function bindRecommendedCourseActions(container) {
  container.querySelectorAll("[data-recommend-topic]").forEach((button) => {
    button.addEventListener("click", () => {
      els.topicInput.value = button.dataset.recommendTopic;
      setView("home");
      els.topicInput.focus();
    });
  });
}

function bindCourseCardActions(container) {
  container.querySelectorAll("[data-open-plan]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await activatePlan(button.dataset.openPlan);
        setView("daily");
      } catch (error) {
        reportPersistenceError(error);
      }
    });
  });
  container.querySelectorAll("[data-delete-plan]").forEach((button) => {
    button.addEventListener("click", () => deletePlan(button.dataset.deletePlan));
  });
}

async function activatePlan(planId) {
  if (state.databaseReady) {
    await request("/api/workspace/current-plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId })
    });
    const databaseState = await request("/api/workspace");
    applyDatabaseState(databaseState);
  } else {
    state.currentPlanId = planId;
    state.quiz = [];
    state.quizResults = {};
    saveState();
    renderAll();
  }
}

function courseInitials(title) {
  const value = String(title || "LM").trim();
  const letters = [...value.replace(/\s+/g, "")].slice(0, 2).join("");
  return letters || "LM";
}

function quizStatusFor(plan) {
  const history = plan.quizHistory || [];
  if (!history.length) return "尚未测评";
  const recent = history.slice(-4);
  const score = recent.reduce((sum, item) => sum + Number(item.score || item.result?.score || 0), 0);
  const max = recent.reduce((sum, item) => sum + Number(item.maxScore || item.result?.maxScore || 0), 0);
  const weak = recent.filter((item) => !item.correct).map((item) => item.dimension).filter(Boolean);
  const weakText = weak.length ? `，待补强：${[...new Set(weak)].slice(0, 2).join("、")}` : "";
  return `最近测评 ${score}/${max}${weakText}`;
}

async function deletePlan(id) {
  try {
    if (state.databaseReady) {
      await request(`/api/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
    }
    state.plans = state.plans.filter((plan) => plan.id !== id);
    if (state.currentPlanId === id) {
      state.currentPlanId = state.plans[0]?.id || null;
      state.quiz = [];
      state.quizResults = {};
      if (state.databaseReady && state.currentPlanId) {
        await request("/api/workspace/current-plan", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId: state.currentPlanId })
        });
      }
    }
    saveState();
    renderAll();
  } catch (error) {
    reportPersistenceError(error);
  }
}

function renderDailyPlan() {
  const plan = getCurrentPlan();
  if (!plan?.data?.dailyPlan?.length) {
    els.dailyPanel.className = "empty-state";
    els.dailyPanel.innerHTML = "<p>生成或选择课程后，这里会出现按顺序展开的学习路径。</p>";
    els.progressSummary.textContent = "等待生成";
    return;
  }

  const data = plan.data;
  const current = currentLearningDay(plan);
  els.dailyPanel.className = "learning-path";
  els.dailyPanel.innerHTML = `
    <div class="timeline-list">
      ${data.dailyPlan.map((day, index) => renderDayCard(day, plan.progress || {}, index, current.index)).join("")}
    </div>
    <section class="study-notes">
      <label>
        学习笔记与错因记录
        <textarea id="studyNotes" rows="5" placeholder="写下今天的卡点、错因、收获。">${escapeHtml(plan.notes || "")}</textarea>
      </label>
      <button class="text-button" type="button" id="resetProgressButton">重置进度</button>
    </section>
  `;

  els.dailyPanel.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", updateProgress);
  });
  els.dailyPanel.querySelectorAll("[data-day-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const details = button.closest("details");
      if (details) details.open = true;
      const firstUnchecked = details?.querySelector(".task-item input:not(:checked)");
      (firstUnchecked || details?.querySelector(".task-item input"))?.focus();
    });
  });
  els.dailyPanel.querySelector("#studyNotes").addEventListener("input", updateNotes);
  els.dailyPanel.querySelector("#resetProgressButton").addEventListener("click", resetProgress);
  updateProgressSummary();
}

function renderDayCard(day, progress, index = 0, currentIndex = 0) {
  const tasks = day.tasks || [];
  const complete = isDayComplete(day, progress);
  const current = index === currentIndex && !complete;
  const locked = index > currentIndex;
  const stateClass = complete ? "completed" : current ? "current" : locked ? "locked" : "pending";
  const actionText = complete ? "复习本节" : current ? "继续学习" : "未解锁";
  return `
    <details class="timeline-day ${stateClass}" data-day-id="day-${day.day}" ${index === currentIndex ? "open" : ""}>
      <summary>
        <span class="timeline-dot" aria-hidden="true"></span>
        <span class="timeline-day-kicker">Day ${day.day}</span>
        <strong>${escapeHtml(day.title)}</strong>
        <small>${escapeHtml(day.estimate || "")} · ${tasks.length} 个任务 · ${locked ? "待解锁" : complete ? "已完成" : "进行中"}</small>
      </summary>
      <div class="timeline-day-body">
        <p class="timeline-focus">${escapeHtml(day.focus || day.checkpoint || "")}</p>
        <div class="task-list">
          ${tasks.map((task, taskIndex) => {
            const id = progressId(day.day, taskIndex);
            return `
              <label class="task-item">
                <input type="checkbox" data-progress-id="${id}" ${progress[id] ? "checked" : ""} ${locked ? "disabled" : ""} />
                <span>${escapeHtml(task)}</span>
              </label>
            `;
          }).join("")}
        </div>
        <p class="checkpoint">${escapeHtml(day.checkpoint || "")}</p>
        <button class="primary-button timeline-action" type="button" data-day-action="${day.day}" ${locked ? "disabled" : ""}>${actionText}</button>
      </div>
    </details>
  `;
}

function progressId(day, index) {
  return `day-${day}-task-${index}`;
}

function updateProgress(event) {
  const plan = getCurrentPlan();
  if (!plan) return;
  plan.progress = plan.progress || {};
  const taskKey = event.target.dataset.progressId;
  const completed = event.target.checked;
  plan.progress[taskKey] = completed;
  state.quiz = [];
  state.quizResults = {};
  saveState();
  if (state.databaseReady) {
    request(
      `/api/plans/${encodeURIComponent(plan.id)}/tasks/${encodeURIComponent(taskKey)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed })
      }
    ).catch(reportPersistenceError);
  }
  renderDailyPlan();
  renderCourseChrome();
  renderSavedPlans();
  renderKnowledge();
  renderPractice();
}

function updateProgressSummary() {
  const plan = getCurrentPlan();
  if (!plan) {
    els.progressSummary.textContent = "等待生成";
    return;
  }
  const summary = progressSummaryFor(plan);
  els.progressSummary.textContent = `已完成 ${summary.done}/${summary.total} 项，进度 ${summary.percent}%`;
}

function updateNotes(event) {
  const plan = getCurrentPlan();
  if (!plan) return;
  plan.notes = event.target.value;
  saveState();
  if (!state.databaseReady) return;
  clearTimeout(persistTimer);
  const planId = plan.id;
  const notes = plan.notes;
  persistTimer = setTimeout(() => {
    request(`/api/plans/${encodeURIComponent(planId)}/notes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes })
    }).catch(reportPersistenceError);
  }, 350);
}

function resetProgress() {
  const plan = getCurrentPlan();
  if (!plan) return;
  plan.progress = {};
  state.quiz = [];
  state.quizResults = {};
  saveState();
  if (state.databaseReady) {
    request(`/api/plans/${encodeURIComponent(plan.id)}/progress`, {
      method: "DELETE"
    }).catch(reportPersistenceError);
  }
  renderAll();
}

function renderDiagnostic() {
  const plan = getCurrentPlan();
  const diagnostic = plan?.data?.diagnosticPretest;
  if (!plan || !diagnostic?.items?.length) {
    els.diagnosticPanel.className = "empty-state";
    els.diagnosticPanel.innerHTML = "<p>生成或选择学习方案后，这里会出现诊断前测。</p>";
    els.diagnosticMode.textContent = "等待方案";
    return;
  }

  const result = plan.data.diagnosticResult;
  state.diagnosticStartedAt = state.diagnosticStartedAt || {};
  state.diagnosticStartedAt[plan.id] = state.diagnosticStartedAt[plan.id] || Date.now();
  els.diagnosticMode.textContent = result
    ? `最近诊断 ${result.score}/${result.maxScore} · ${result.percent}% · 能力 ${result.abilityEstimate ?? 0}`
    : "尚未完成诊断";
  els.diagnosticPanel.className = "diagnostic-board";
  els.diagnosticPanel.innerHTML = `
    <section class="diagnostic-summary">
      <div>
        <strong>${escapeHtml(diagnostic.title)}</strong>
        <p>${escapeHtml(diagnostic.objective || "")}</p>
      </div>
      ${result ? `<span class="score-badge">${result.percent}%</span>` : "<span class=\"score-badge muted\">待测</span>"}
    </section>
    <div class="diagnostic-list">
      ${diagnostic.items.map((item, index) => renderDiagnosticItem(item, index, result)).join("")}
    </div>
    <button id="submitDiagnosticButton" class="primary-button" type="button">提交诊断并更新画像</button>
  `;
  els.diagnosticPanel.querySelector("#submitDiagnosticButton").addEventListener("click", evaluateDiagnostic);
}

function renderDiagnosticItem(item, index, result) {
  const last = result?.results?.find((row) => row.questionId === item.id);
  const selectedIndex = last?.selectedIndex;
  return `
    <article class="diagnostic-item">
      <div class="quiz-head">
        <span>诊断 ${index + 1} · ${escapeHtml(item.dimension)}</span>
        <span>${escapeHtml(item.conceptTitle || "")} · 难度 ${Number(item.difficulty || 1)} · ${Number(item.timeLimitSec || 90)} 秒</span>
      </div>
      <h3>${escapeHtml(item.question)}</h3>
      <div class="option-list">
        ${(item.options || []).map((option, optionIndex) => `
          <label class="option-item">
            <input type="radio" name="diagnostic-${escapeHtml(item.id)}" value="${optionIndex}" ${selectedIndex === optionIndex ? "checked" : ""} />
            <span>${escapeHtml(option)}</span>
          </label>
        `).join("")}
      </div>
      ${last ? `
        <div class="feedback ${last.correct ? "ok-feedback" : "warn-feedback"}">
          ${last.correct ? "诊断正确。" : "诊断未通过。"}${escapeHtml(last.explanation || "")}
        </div>
      ` : ""}
    </article>
  `;
}

async function evaluateDiagnostic() {
  const plan = getCurrentPlan();
  if (!plan?.data?.diagnosticPretest?.items?.length) return;
  const answers = {};
  const startedAt = state.diagnosticStartedAt?.[plan.id] || Date.now();
  const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const perQuestionSeconds = Math.max(1, Math.round(elapsed / plan.data.diagnosticPretest.items.length));
  for (const item of plan.data.diagnosticPretest.items) {
    const selected = els.diagnosticPanel.querySelector(`input[name="diagnostic-${cssEscape(item.id)}"]:checked`);
    if (selected) {
      answers[item.id] = {
        selectedIndex: Number(selected.value),
        timeSpentSec: perQuestionSeconds,
        hintCount: 0
      };
    }
  }
  if (Object.keys(answers).length !== plan.data.diagnosticPretest.items.length) {
    els.diagnosticMode.textContent = "请先完成全部诊断题";
    return;
  }

  const button = els.diagnosticPanel.querySelector("#submitDiagnosticButton");
  button.disabled = true;
  button.textContent = "诊断评分中";
  try {
    const result = await request("/api/diagnostic/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: plan.data, answers })
    });
    plan.data.diagnosticResult = result;
    plan.data.adaptiveState = result.adaptiveState;
    plan.data.remediationPlan = result.remediationPlan;
    plan.masteryEvidence = plan.masteryEvidence || [];
    plan.masteryEvidence.push({
      type: "diagnostic",
      score: result.score,
      maxScore: result.maxScore,
      percent: result.percent,
      at: result.evaluatedAt
    });
    captureMasterySnapshot(plan, "diagnostic");
    recordBehavior("diagnostic-submitted", { planId: plan.id, detail: `${result.percent}%` });
    saveState();
    if (state.databaseReady) {
      await request(`/api/plans/${encodeURIComponent(plan.id)}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: plan.data, masteryEvidence: plan.masteryEvidence })
      });
    }
    renderDiagnostic();
    renderKnowledge();
    renderRemediation();
    renderMistakes();
    renderReport();
    setView("knowledge");
  } catch (error) {
    els.diagnosticMode.textContent = `诊断失败：${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "提交诊断并更新画像";
  }
}

function renderKnowledge() {
  const plan = getCurrentPlan();
  if (!plan) {
    els.knowledgePanel.className = "result-grid empty-state";
    els.knowledgePanel.innerHTML = "<p>暂无学习数据。</p>";
    els.masteryMode.textContent = "等待学习数据";
    return;
  }

  const mastery = computeMastery(plan);
  const summary = progressSummaryFor(plan);
  const concepts = plan.data?.adaptiveState?.concepts || plan.data?.knowledgeGraph?.concepts || [];
  const diagnosticText = plan.data?.diagnosticResult ? `，诊断 ${plan.data.diagnosticResult.percent}%` : "";
  els.masteryMode.textContent = `基于 ${summary.done} 项打卡、${Object.keys(state.quizResults || {}).length} 道测评${diagnosticText}`;
  els.knowledgePanel.className = "result-grid";
  els.knowledgePanel.innerHTML = `
    <article class="result-card radar-card">
      <h3>知识点掌握雷达图</h3>
      <canvas id="masteryRadar" width="360" height="300" aria-label="知识点掌握雷达图"></canvas>
      <p class="hint-text">初始值来自自评；诊断、打卡和测评会共同更新掌握度证据。</p>
    </article>
    <article class="result-card">
      <h3>掌握度证据</h3>
      <div class="mastery-list">
        ${mastery.map((item) => `
          <div>
            <span>${escapeHtml(item.dimension)}</span>
            <strong>${item.score}</strong>
            <small>${escapeHtml(item.evidence)}</small>
          </div>
        `).join("")}
      </div>
    </article>
    <article class="result-card full">
      <h3>知识图谱与先修关系</h3>
      <div class="concept-grid">
        ${concepts.map((concept) => `
          <div class="concept-card">
            <span>${escapeHtml(concept.dimension || "")} · ${escapeHtml(concept.status || "待观察")}</span>
            <strong>${escapeHtml(concept.title || concept.conceptTitle || "")}</strong>
            <meter min="0" max="100" value="${Number(concept.masteryScore || 0)}"></meter>
            <small>掌握度 ${Number(concept.masteryScore || 0)} · 置信度 ${Math.round(Number(concept.confidence || 0) * 100)}% · ${escapeHtml(concept.nextAction || concept.source || "profile-estimate")}</small>
          </div>
        `).join("")}
      </div>
    </article>
    ${plan.data?.diagnosticResult ? `
      <article class="result-card full">
        <h3>诊断错因</h3>
        <div class="tag-list">
          ${(plan.data.diagnosticResult.mistakeProfile?.dominantTags || []).map((item) => `<span class="tag warning-tag">${escapeHtml(item.tag)} × ${item.count}</span>`).join("") || "<span class=\"tag\">暂无明显错因</span>"}
        </div>
      </article>
    ` : ""}
    <article class="result-card full">
      <h3>学习者画像</h3>
      <p>${escapeHtml(plan.data.learnerProfile?.summary || "")}</p>
      <div class="tag-list">
        ${(plan.data.profile?.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    </article>
  `;
  drawRadar("masteryRadar", mastery);
}

function computeMastery(plan) {
  const base = plan.data?.learnerProfile?.mastery || [];
  const adaptiveDimensions = plan.data?.adaptiveState?.dimensionMastery || [];
  const summary = progressSummaryFor(plan);
  const quizResults = Object.values(state.quizResults || {});
  return base.map((item) => {
    const relatedResults = quizResults.filter((result) => result.dimension === item.dimension);
    const avgQuiz = relatedResults.length
      ? Math.round(relatedResults.reduce((sum, result) => sum + scorePercent(result), 0) / relatedResults.length)
      : null;
    const adaptive = adaptiveDimensions.find((dimension) => dimension.dimension === item.dimension);
    const baseScore = Number(adaptive?.score ?? item.score ?? 50);
    const progressBoost = Math.min(18, Math.round(summary.percent * 0.18));
    const quizWeight = avgQuiz === null ? 0 : Math.round((avgQuiz - 60) * 0.35);
    const score = clamp(baseScore + progressBoost + quizWeight);
    const evidence = avgQuiz === null
      ? `${adaptive?.evidence || `自评基础 ${item.score || 50}`} + 打卡进度 ${summary.percent}%`
      : `${adaptive?.evidence || `自评基础 ${item.score || 50}`} + 打卡 ${summary.percent}% + 测评 ${avgQuiz}%`;
    return { ...item, score, evidence };
  });
}

function scorePercent(result) {
  return result.maxScore ? Math.round((Number(result.score || 0) / Number(result.maxScore)) * 100) : Number(result.score || 0);
}

function renderRemediation() {
  const plan = getCurrentPlan();
  const remediation = plan?.data?.remediationPlan;
  if (!plan || !remediation) {
    els.remediationPanel.className = "empty-state";
    els.remediationPanel.innerHTML = "<p>完成诊断或测评后会出现补救建议。</p>";
    els.remediationMode.textContent = "等待诊断";
    return;
  }
  els.remediationMode.textContent = remediation.target ? `优先补救：${remediation.target}` : "已生成补救路径";
  els.remediationPanel.className = "remediation-board";
  els.remediationPanel.innerHTML = `
    <section class="remediation-head">
      <div>
        <strong>${escapeHtml(remediation.target || plan.data.input?.topic || "当前主题")}</strong>
        <p>${escapeHtml(remediation.reason || "")}</p>
      </div>
      <button id="useRemediationPrompt" class="ghost-button" type="button">带入导师</button>
    </section>
    <div class="weak-concept-list">
      ${(remediation.weakConcepts || []).map((concept) => `
        <div>
          <span>${escapeHtml(concept.dimension || "")}</span>
          <strong>${escapeHtml(concept.title || concept.conceptTitle || "")}</strong>
          <small>掌握度 ${Number(concept.masteryScore || 0)} · ${escapeHtml(concept.reason || "")}</small>
        </div>
      `).join("")}
    </div>
    <div class="remediation-steps">
      ${(remediation.sequence || []).map((step, index) => `
        <article class="remediation-step">
          <span>${index + 1}</span>
          <strong>${escapeHtml(step.step)}</strong>
          <p>${escapeHtml(step.action)}</p>
          <small>${escapeHtml(step.expectedEvidence)}</small>
        </article>
      `).join("")}
    </div>
    <article class="result-card full">
      <h3>个性化微讲义</h3>
      <div class="concept-grid">
        ${(remediation.microLessons || []).map((lesson) => `
          <div class="concept-card">
            <span>${escapeHtml(lesson.conceptId || "")}</span>
            <strong>${escapeHtml(lesson.title)}</strong>
            <small>${escapeHtml(lesson.content)}</small>
          </div>
        `).join("")}
      </div>
    </article>
    <article class="result-card full">
      <h3>变式与复测</h3>
      <div class="concept-grid">
        ${(remediation.variantItems || []).concat(remediation.retestItems || []).map((item) => `
          <div class="concept-card">
            <span>${escapeHtml(item.type || "practice")}</span>
            <strong>${escapeHtml(item.title || item.id || "复测题")}</strong>
            <small>${escapeHtml(item.prompt || item.expected || "")}</small>
          </div>
        `).join("")}
      </div>
    </article>
    <article class="result-card full">
      <h3>提示阶梯</h3>
      <ul class="plain-list">
        ${(remediation.hintLadder || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </article>
  `;
  const promptButton = els.remediationPanel.querySelector("#useRemediationPrompt");
  promptButton?.addEventListener("click", () => {
    els.coachQuestion.value = remediation.coachPrompts?.[0] || `请围绕 ${remediation.target} 帮我做补救学习。`;
    els.tutorMode.value = "inquiry";
    setView("coach");
  });
}

function renderGovernance() {
  const plan = getCurrentPlan();
  const report = plan?.data?.governanceReport;
  if (!plan || !report) {
    els.governancePanel.className = "empty-state";
    els.governancePanel.innerHTML = "<p>生成方案后会出现内容治理报告。</p>";
    els.governanceMode.textContent = "等待方案";
    return;
  }
  els.governanceMode.textContent = `质量分 ${report.score} · ${riskLabel(report.riskLevel)}`;
  els.governancePanel.className = "governance-board";
  els.governancePanel.innerHTML = `
    <section class="governance-summary">
      <span class="score-badge ${report.riskLevel === "low" ? "" : "muted"}">${Number(report.score || 0)}</span>
      <div>
        <strong>${escapeHtml(report.agent || "内容治理智能体")}</strong>
        <p>${escapeHtml(report.summary || "")}</p>
      </div>
    </section>
    <div class="check-list">
      ${(report.checks || []).map((check) => `
        <div class="${check.passed ? "passed" : "failed"}">
          <span>${check.passed ? "通过" : "待修正"}</span>
          <strong>${escapeHtml(check.label)}</strong>
          <small>${escapeHtml(check.detail)}</small>
        </div>
      `).join("")}
    </div>
    <article class="result-card full">
      <h3>治理策略</h3>
      <ul class="plain-list">
        ${(report.moderationPolicy || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </article>
    <article class="result-card full">
      <h3>一致性校验</h3>
      <ul class="plain-list">
        ${(report.consistencyChecks || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      ${(report.requiredFixes || []).length ? `<p class="warning">待修正：${escapeHtml(report.requiredFixes.join("、"))}</p>` : "<p class=\"ok-text\">暂无必须修正项。</p>"}
    </article>
  `;
}

function renderMistakes() {
  const plan = getCurrentPlan();
  const mistakes = buildMistakeBook(plan);
  if (!plan) {
    els.mistakePanel.className = "empty-state";
    els.mistakePanel.innerHTML = "<p>先生成或选择一个学习方案。</p>";
    els.mistakeMode.textContent = "等待方案";
    return;
  }
  if (!mistakes.length) {
    els.mistakePanel.className = "empty-state";
    els.mistakePanel.innerHTML = "<p>当前没有错题。完成诊断或练习后会自动沉淀。</p>";
    els.mistakeMode.textContent = "暂无错题";
    return;
  }

  const filters = state.mistakeFilters || { concept: "all", type: "all", reason: "all" };
  const concepts = [...new Set(mistakes.map((item) => item.dimension || item.conceptTitle || "综合").filter(Boolean))];
  const reasons = [...new Set(mistakes.map((item) => item.reasonTag || "未归因").filter(Boolean))];
  const filtered = mistakes.filter((item) => (
    (filters.concept === "all" || filters.concept === (item.dimension || item.conceptTitle))
      && (filters.type === "all" || filters.type === item.type)
      && (filters.reason === "all" || filters.reason === item.reasonTag)
  ));
  els.mistakeMode.textContent = `${filtered.length}/${mistakes.length} 条待复盘`;
  els.mistakePanel.className = "remediation-board";
  els.mistakePanel.innerHTML = `
    <section class="remediation-head">
      <div>
        <strong>错题复盘队列</strong>
        <p>每条错题都可以生成同知识点变式练习，或带入 AI 导师做错因追问。</p>
      </div>
      <span class="score-badge muted">${mistakes.length}</span>
    </section>
    <div class="settings-grid">
      <label>知识点
        <select id="mistakeConceptFilter">
          <option value="all">全部知识点</option>
          ${concepts.map((item) => `<option value="${escapeHtml(item)}" ${filters.concept === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
        </select>
      </label>
      <label>题型
        <select id="mistakeTypeFilter">
          <option value="all">全部题型</option>
          ${["choice", "short", "code", "diagnostic"].map((type) => `<option value="${type}" ${filters.type === type ? "selected" : ""}>${typeLabel(type)}</option>`).join("")}
        </select>
      </label>
      <label>错因
        <select id="mistakeReasonFilter">
          <option value="all">全部错因</option>
          ${reasons.map((item) => `<option value="${escapeHtml(item)}" ${filters.reason === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="concept-grid">
      ${filtered.map((item) => `
        <article class="concept-card">
          <div class="quiz-head">
            <span>${escapeHtml(typeLabel(item.type))} · ${escapeHtml(item.dimension || "综合")}</span>
            <span>${Number(item.score || 0)}/${Number(item.maxScore || 0)}</span>
          </div>
          <h3>${escapeHtml(stripQuestionContext(item.question))}</h3>
          <p>${escapeHtml(item.feedback || item.explanation || "等待复盘。")}</p>
          <small>错因：${escapeHtml(item.reasonTag || "未归因")} · ${formatDate(item.at)}</small>
          <div class="plan-actions">
            <button class="ghost-button" type="button" data-mistake-practice="${escapeHtml(item.dimension || "")}">变式练习</button>
            <button class="text-button" type="button" data-mistake-coach="${escapeHtml(item.id)}">问导师</button>
          </div>
        </article>
      `).join("") || "<p class=\"hint-text\">当前筛选条件下没有错题。</p>"}
    </div>
  `;
  els.mistakePanel.querySelectorAll("#mistakeConceptFilter, #mistakeTypeFilter, #mistakeReasonFilter").forEach((select) => {
    select.addEventListener("change", () => {
      state.mistakeFilters = {
        concept: els.mistakePanel.querySelector("#mistakeConceptFilter").value,
        type: els.mistakePanel.querySelector("#mistakeTypeFilter").value,
        reason: els.mistakePanel.querySelector("#mistakeReasonFilter").value
      };
      saveState();
      renderMistakes();
    });
  });
  els.mistakePanel.querySelectorAll("[data-mistake-practice]").forEach((button) => {
    button.addEventListener("click", () => loadQuiz(true, {
      questionCount: 3,
      typeCounts: { choice: 2, short: 1, code: 0 },
      knowledgeScope: "weak",
      includeSimilar: true,
      focusDimension: button.dataset.mistakePractice
    }));
  });
  els.mistakePanel.querySelectorAll("[data-mistake-coach]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = mistakes.find((mistake) => mistake.id === button.dataset.mistakeCoach);
      els.coachQuestion.value = `我做错了这道题：${stripQuestionContext(item?.question || "")}。请先追问我的错因，再给分层提示。`;
      els.tutorMode.value = "inquiry";
      setView("coach");
    });
  });
}

function renderReport() {
  const plan = getCurrentPlan();
  if (!plan) {
    els.reportPanel.className = "empty-state";
    els.reportPanel.innerHTML = "<p>先生成或选择一个学习方案。</p>";
    els.reportMode.textContent = "等待方案";
    return;
  }
  const reportText = buildLearningReport(plan);
  const mistakes = buildMistakeBook(plan);
  els.reportMode.textContent = `${mistakes.length} 条错题 · ${progressSummaryFor(plan).percent}% 进度`;
  els.reportPanel.className = "remediation-board";
  els.reportPanel.innerHTML = `
    <section class="remediation-head">
      <div>
        <strong>${escapeHtml(plan.title)} 学习报告</strong>
        <p>报告会随诊断、练习、考试、项目提交和行为记录实时更新。</p>
      </div>
      <div class="heading-actions">
        <button class="ghost-button" type="button" data-export-report="copy">复制 Markdown</button>
        <button class="ghost-button" type="button" data-export-report="md">下载 MD</button>
        <button class="ghost-button" type="button" data-export-report="json">下载 JSON</button>
        <button class="ghost-button" type="button" data-export-report="html">下载 HTML</button>
        <button class="ghost-button" type="button" data-export-report="print">打印 PDF</button>
      </div>
    </section>
    <article id="reportText" class="report-text markdown-body" aria-label="Markdown 格式学习报告"></article>
  `;
  els.reportPanel.querySelector("#reportText").innerHTML = renderMarkdown(reportText);
  els.reportPanel.querySelectorAll("[data-export-report]").forEach((button) => {
    button.addEventListener("click", () => exportLearningReport(button.dataset.exportReport, plan, reportText));
  });
}

function renderExam() {
  const plan = getCurrentPlan();
  if (!plan) {
    els.examPanel.className = "empty-state";
    els.examPanel.innerHTML = "<p>先生成或选择一个学习方案。</p>";
    els.examMode.textContent = "等待方案";
    return;
  }
  const exam = state.exam?.planId === plan.id ? state.exam : null;
  const results = Object.values(exam?.results || {});
  const score = results.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const max = results.reduce((sum, item) => sum + Number(item.maxScore || 0), 0);
  const remaining = exam?.status === "running" ? Math.max(0, Number(exam.durationSec || 0) - Math.round((Date.now() - exam.startedAt) / 1000)) : 0;
  els.examMode.textContent = exam?.status === "submitted"
    ? `已提交 ${score}/${max}`
    : exam?.status === "running"
      ? `进行中 · 剩余 ${formatDuration(remaining)}`
      : "未开始";
  els.examPanel.className = "practice-panel";
  els.examPanel.innerHTML = `
    <section class="settings-board">
      <div class="settings-grid">
        <label>总题量<input id="examQuestionCount" type="number" min="1" max="20" value="${Number(state.settings?.examQuestionCount || 6)}" /></label>
        <label>选择题<input id="examChoiceCount" type="number" min="0" max="20" value="${Number(state.settings?.examChoiceCount || 4)}" /></label>
        <label>简答题<input id="examShortCount" type="number" min="0" max="20" value="${Number(state.settings?.examShortCount || 2)}" /></label>
        <label>编程题<input id="examCodeCount" type="number" min="0" max="5" value="${Number(state.settings?.examCodeCount || 0)}" /></label>
        <label>难度
          <select id="examDifficulty">
            ${difficultyOptions(state.settings?.examDifficulty || "medium")}
          </select>
        </label>
        <label>时长(分钟)<input id="examDuration" type="number" min="5" max="180" value="${Number(state.settings?.examDurationMinutes || 30)}" /></label>
      </div>
      <div class="heading-actions">
        <button id="generateExamButton" class="primary-button" type="button">生成考试</button>
        ${exam?.quiz?.length && exam.status === "running" ? "<button id=\"submitExamButton\" class=\"ghost-button\" type=\"button\">提交考试</button>" : ""}
      </div>
    </section>
    ${exam?.quiz?.length ? `
      <div class="score-panel">${exam.status === "submitted" ? `考试得分 ${score}/${max}` : `剩余时间 ${formatDuration(remaining)}`}</div>
      <div class="quiz-list">
        ${exam.quiz.map((item, index) => renderExamQuestion(item, index, exam.results?.[item.id])).join("")}
      </div>
    ` : "<div class=\"empty-state compact\"><p>按上面的配置生成一次模拟考试。</p></div>"}
  `;
  els.examPanel.querySelector("#generateExamButton")?.addEventListener("click", generateExam);
  els.examPanel.querySelector("#submitExamButton")?.addEventListener("click", submitExam);
}

function renderProject() {
  const plan = getCurrentPlan();
  if (!plan) {
    els.projectPanel.className = "empty-state";
    els.projectPanel.innerHTML = "<p>先生成或选择一个学习方案。</p>";
    els.projectMode.textContent = "等待方案";
    return;
  }
  state.projectTasks = state.projectTasks || {};
  const task = state.projectTasks[plan.id] || buildProjectTask(plan);
  state.projectTasks[plan.id] = task;
  const progress = state.projectProgress?.[plan.id] || {};
  const done = Object.values(progress).filter(Boolean).length;
  const submission = state.projectSubmissions?.[plan.id];
  els.projectMode.textContent = `${done}/${task.steps.length} 步 · ${submission ? "已提交" : "未提交"}`;
  els.projectPanel.className = "remediation-board";
  els.projectPanel.innerHTML = `
    <section class="remediation-head">
      <div>
        <strong>${escapeHtml(task.title)}</strong>
        <p>${escapeHtml(task.brief)}</p>
      </div>
      <span class="status-pill">${escapeHtml(task.difficulty)}</span>
    </section>
    <div class="concept-grid">
      ${task.steps.map((step, index) => `
        <article class="concept-card">
          <label class="task-item">
            <input type="checkbox" data-project-step="${index}" ${progress[index] ? "checked" : ""} />
            <span>${escapeHtml(step.title)}</span>
          </label>
          <p>${escapeHtml(step.action)}</p>
          <small>验收：${escapeHtml(step.acceptance)} · 交付：${escapeHtml(step.deliverable)}</small>
        </article>
      `).join("")}
    </div>
    <section class="study-notes">
      <label>
        项目提交说明
        <textarea id="projectSubmissionText" rows="6" placeholder="写下你的方案、关键代码、实验结果或复盘。">${escapeHtml(submission?.content || "")}</textarea>
      </label>
      <button id="saveProjectButton" class="primary-button" type="button">保存项目提交</button>
      ${submission ? `<p class="ok-text">上次提交：${formatDate(submission.at)}</p>` : ""}
    </section>
  `;
  els.projectPanel.querySelectorAll("[data-project-step]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      state.projectProgress = state.projectProgress || {};
      state.projectProgress[plan.id] = state.projectProgress[plan.id] || {};
      state.projectProgress[plan.id][checkbox.dataset.projectStep] = checkbox.checked;
      recordBehavior("project-step", { planId: plan.id, step: checkbox.dataset.projectStep, completed: checkbox.checked });
      saveState();
      renderProject();
    });
  });
  els.projectPanel.querySelector("#saveProjectButton").addEventListener("click", saveProjectSubmission);
}

function renderSettings() {
  const settings = withDefaultSettings(state.settings);
  const events = state.behaviorEvents || [];
  els.settingsMode.textContent = `${events.length} 条行为记录`;
  els.settingsPanel.className = "remediation-board";
  els.settingsPanel.innerHTML = `
    <section class="settings-board">
      <div class="settings-grid">
        <label>默认总题量<input id="settingQuestionCount" type="number" min="1" max="20" value="${settings.questionCount}" /></label>
        <label>选择题<input id="settingChoiceCount" type="number" min="0" max="20" value="${settings.choiceCount}" /></label>
        <label>简答题<input id="settingShortCount" type="number" min="0" max="20" value="${settings.shortCount}" /></label>
        <label>编程题<input id="settingCodeCount" type="number" min="0" max="5" value="${settings.codeCount}" /></label>
        <label>默认难度<select id="settingDifficulty">${difficultyOptions(settings.difficulty)}</select></label>
        <label>知识范围<select id="settingKnowledgeScope">${scopeOptions(settings.knowledgeScope)}</select></label>
        <label>提醒时间<input id="settingReminder" type="time" value="${escapeHtml(settings.reminderTime)}" /></label>
        <label>学习风格<select id="settingLearningStyle">${styleOptions(settings.learningStyle)}</select></label>
      </div>
      <div class="settings-grid">
        <label class="toggle-line"><input id="settingShowHints" type="checkbox" ${settings.showHints ? "checked" : ""} /> 练习显示分层提示</label>
        <label class="toggle-line"><input id="settingPrioritizeWeakness" type="checkbox" ${settings.prioritizeWeakness ? "checked" : ""} /> 优先薄弱知识点</label>
        <label class="toggle-line"><input id="settingStrictMode" type="checkbox" ${settings.strictMode ? "checked" : ""} /> 考试提交前要求全部作答</label>
        <label class="toggle-line"><input id="settingHideAnswers" type="checkbox" ${settings.hideAnswers ? "checked" : ""} /> 评分前隐藏参考答案</label>
      </div>
      <button id="saveSettingsButton" class="primary-button" type="button">保存设置</button>
    </section>
    <article class="result-card full">
      <h3>行为记录</h3>
      <div class="report-table">
        ${events.slice(-12).reverse().map((event) => `
          <div>
            <strong>${escapeHtml(behaviorLabel(event.type))}</strong>
            <span>${formatDate(event.at)}</span>
            <span>${escapeHtml(event.detail || "")}</span>
            <span>${escapeHtml(event.planTitle || "")}</span>
          </div>
        `).join("") || "<p class=\"hint-text\">还没有行为记录。</p>"}
      </div>
    </article>
  `;
  els.settingsPanel.querySelector("#saveSettingsButton").addEventListener("click", saveSettingsFromPanel);
}

function renderPractice() {
  const plan = getCurrentPlan();
  if (!plan) {
    els.practicePanel.className = "empty-state";
    els.practicePanel.innerHTML = "<p>先生成或选择一个学习方案。</p>";
    return;
  }
  if (!state.quiz?.length) {
    els.practicePanel.className = "practice-panel";
    els.practicePanel.innerHTML = `
      ${renderPracticeOptionsPanel()}
      <div class="empty-state compact">
        <p>练习题会根据当前设置、打卡进度和错题记录生成。</p>
        <button id="loadQuizButton" class="primary-button" type="button">按设置生成练习</button>
      </div>
    `;
    document.querySelector("#loadQuizButton").addEventListener("click", () => loadQuiz(false));
    els.practicePanel.querySelector("#applyPracticeSettings")?.addEventListener("click", () => {
      savePracticeSettingsFromPanel();
      loadQuiz(false);
    });
    return;
  }

  els.practicePanel.className = "practice-panel";
  els.practicePanel.innerHTML = `
    ${renderPracticeOptionsPanel()}
    <div class="quiz-list">
      ${state.quiz.map((item, index) => renderQuizItem(item, index)).join("")}
    </div>
    <div class="score-panel">${renderScoreSummary()}</div>
  `;

  els.practicePanel.querySelectorAll("[data-evaluate]").forEach((button) => {
    button.addEventListener("click", () => evaluateQuiz(button.dataset.evaluate));
  });
  els.practicePanel.querySelector("#applyPracticeSettings")?.addEventListener("click", () => {
    savePracticeSettingsFromPanel();
    loadQuiz(true);
  });
}

function handleCodeTextareaKeydown(event) {
  const textarea = event.target.closest?.("textarea.code-answer");
  if (!textarea || event.key !== "Tab") return;
  event.preventDefault();
  event.stopPropagation();

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const indent = "    ";

  if (start !== end && value.slice(start, end).includes("\n")) {
    updateSelectedLinesIndent(textarea, event.shiftKey ? "outdent" : "indent");
    return;
  }

  if (event.shiftKey) {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const removable = value.slice(lineStart, lineStart + indent.length) === indent
      ? indent.length
      : value[lineStart] === "\t"
        ? 1
        : 0;
    if (!removable) return;
    textarea.value = `${value.slice(0, lineStart)}${value.slice(lineStart + removable)}`;
    textarea.selectionStart = Math.max(lineStart, start - removable);
    textarea.selectionEnd = Math.max(lineStart, end - removable);
    return;
  }

  textarea.value = `${value.slice(0, start)}${indent}${value.slice(end)}`;
  textarea.selectionStart = start + indent.length;
  textarea.selectionEnd = start + indent.length;
}

function updateSelectedLinesIndent(textarea, mode) {
  const value = textarea.value;
  const indent = "    ";
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEnd = selectionEnd < value.length && value[selectionEnd - 1] === "\n"
    ? selectionEnd - 1
    : selectionEnd;
  const before = value.slice(0, lineStart);
  const selected = value.slice(lineStart, lineEnd);
  const after = value.slice(lineEnd);
  const lines = selected.split("\n");
  let delta = 0;

  const updated = lines.map((line) => {
    if (mode === "indent") {
      delta += indent.length;
      return `${indent}${line}`;
    }
    if (line.startsWith(indent)) {
      delta -= indent.length;
      return line.slice(indent.length);
    }
    if (line.startsWith("\t")) {
      delta -= 1;
      return line.slice(1);
    }
    return line;
  }).join("\n");

  textarea.value = `${before}${updated}${after}`;
  textarea.selectionStart = mode === "indent"
    ? selectionStart + indent.length
    : Math.max(lineStart, selectionStart + Math.min(0, delta));
  textarea.selectionEnd = Math.max(textarea.selectionStart, selectionEnd + delta);
}

function renderQuizItem(item, index) {
  const result = state.quizResults?.[item.id];
  const answerControl = renderAnswerControl(item, result);
  return `
    <article class="quiz-item">
      <div class="quiz-head">
        <span>第 ${index + 1} 题 · ${typeLabel(item.type)} · ${escapeHtml(item.dimension || "综合")}</span>
        ${result ? `<strong class="${result.correct ? "ok-text" : "bad-text"}">${result.score}/${result.maxScore}</strong>` : ""}
      </div>
      <h3>${escapeHtml(item.question)}</h3>
      ${answerControl}
      <button class="ghost-button" type="button" data-evaluate="${escapeHtml(item.id)}">提交给评分智能体</button>
      ${result ? `<p class="feedback">${escapeHtml(result.feedback)}</p>` : ""}
      ${renderCodeTestDetails(item, result)}
      ${renderReferenceAnswer(item, result)}
    </article>
  `;
}

function renderCodeTestDetails(item, result) {
  if (!result || item.type !== "code") return "";
  const rows = normalizeCodeResultRows(item, result);
  const failedRows = rows.filter((row) => !row.passed);
  if (!failedRows.length) return "";
  return `
    <div class="test-detail-panel">
      <strong>未通过测试样例</strong>
      ${failedRows.map((row) => `
        <section class="test-detail-item">
          <span>用例 ${row.index}</span>
          <dl>
            <div><dt>测试输入</dt><dd>${escapeHtml(formatTestValue(row.input ?? row.args ?? []))}</dd></div>
            <div><dt>正确输出</dt><dd>${escapeHtml(formatTestValue(row.expected))}</dd></div>
            <div><dt>你的输出</dt><dd>${escapeHtml(row.error ? `运行错误：${row.error}` : formatTestValue(row.actual))}</dd></div>
          </dl>
        </section>
      `).join("")}
    </div>
  `;
}

function normalizeCodeResultRows(item, result) {
  const rows = result.detail?.results;
  if (Array.isArray(rows) && rows.length) return rows;
  if (!result.correct && Array.isArray(item.tests) && item.tests.length) {
    return item.tests.map((test, index) => ({
      index: index + 1,
      passed: false,
      input: test.args || [],
      args: test.args || [],
      expected: test.expected,
      actual: result.detail?.actual ?? null,
      error: result.detail?.loadError || result.detail?.reason || result.detail?.localReason || "未返回逐条测试结果"
    }));
  }
  return [];
}

function formatTestValue(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderReferenceAnswer(item, result) {
  if (!result) return "";
  const reference = result.referenceAnswer || item.referenceAnswer || (item.type === "choice" ? item.explanation : "");
  if (!reference) return "";
  return `
    <div class="reference-answer">
      <strong>标准答案</strong>
      <p>${escapeHtml(reference)}</p>
      <small>本题得分：${Number(result.score || 0)}/${Number(result.maxScore || item.score || 0)}</small>
    </div>
  `;
}

function renderAnswerControl(item, result) {
  if (item.type === "choice") {
    return `
      <div class="option-list">
        ${(item.options || []).map((option, optionIndex) => `
          <label class="option-item">
            <input type="radio" name="${escapeHtml(item.id)}" value="${optionIndex}" ${result?.evidence?.selectedIndex === optionIndex ? "checked" : ""} />
            <span>${escapeHtml(option)}</span>
          </label>
        `).join("")}
      </div>
    `;
  }

  if (item.type === "code") {
    return `
      <label class="answer-box">
        ${codeLanguageLabel(item.language)} 代码
        <textarea class="code-answer" data-answer-for="${escapeHtml(item.id)}" rows="9" spellcheck="false">${escapeHtml(item.lastAnswer || item.starterCode || "")}</textarea>
      </label>
      <p class="hint-text">${escapeHtml(item.explanation || "")}</p>
    `;
  }

  return `
    <label class="answer-box">
      我的答案
      <textarea data-answer-for="${escapeHtml(item.id)}" rows="5" placeholder="请写出关键概念、判断依据和例子">${escapeHtml(item.lastAnswer || "")}</textarea>
    </label>
  `;
}

function codeLanguageLabel(language) {
  return {
    python: "Python",
    cpp: "C++",
    java: "Java",
    javascript: "JavaScript"
  }[language] || "代码";
}

function typeLabel(type) {
  return {
    choice: "选择题",
    short: "简答题",
    code: "编程题",
    diagnostic: "诊断题"
  }[type] || "综合题";
}

function renderScoreSummary() {
  const results = Object.values(state.quizResults || {});
  if (!results.length) return "尚未提交答案。";
  const score = results.reduce((sum, result) => sum + Number(result.score || 0), 0);
  const max = results.reduce((sum, result) => sum + Number(result.maxScore || 0), 0);
  return `测评评分智能体已完成 ${results.length}/${state.quiz.length} 题，当前得分 ${score}/${max}。`;
}

async function loadQuiz(regenerate, optionOverrides = {}) {
  const plan = getCurrentPlan();
  if (!plan) return;
  els.practicePanel.className = "empty-state";
  els.practicePanel.innerHTML = "<p>正在根据学习进度重新出题...</p>";
  plan.quizRound = regenerate ? Number(plan.quizRound || 0) + 1 : Number(plan.quizRound || 0);
  const options = quizOptionsFromSettings(optionOverrides);

  try {
    const data = await request("/api/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(state.databaseReady ? { planId: plan.id } : {}),
        input: plan.data.input,
        plan: plan.data,
        progress: plan.progress,
        history: plan.quizHistory || [],
        regenerate,
        variant: plan.quizRound,
        options
      })
    });
    state.quiz = data.quiz || [];
    state.quizResults = {};
    state.lastQuizOptions = data.quizOptions || options;
    recordBehavior("quiz-generated", { planId: plan.id, detail: `${state.quiz.length} 题 · ${state.lastQuizOptions.types?.join("/") || ""}` });
    saveState();
    renderPractice();
    renderMistakes();
  } catch (error) {
    els.practicePanel.innerHTML = `<p class="warning">出题失败：${escapeHtml(error.message)}</p>`;
  }
}

async function evaluateQuiz(questionId) {
  const question = state.quiz.find((item) => item.id === questionId);
  const answer = readQuizAnswer(question);
  if (!question || answer === null || answer === "") return;
  question.lastAnswer = answer;
  const button = els.practicePanel.querySelector(`[data-evaluate="${cssEscape(questionId)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "评测中...";
  }

  try {
    const endpoint = question.databaseId
      ? `/api/quiz-questions/${encodeURIComponent(question.databaseId)}/attempts`
      : "/api/evaluate";
    const result = await request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(question.databaseId ? { answer } : { question, answer })
    });
    state.quizResults[questionId] = result;
    const plan = getCurrentPlan();
    if (plan) {
      plan.quizHistory = plan.quizHistory || [];
      plan.quizHistory.push({
        questionId,
        type: question.type,
        dimension: question.dimension,
        conceptId: question.conceptId,
        question: question.question,
        answer,
        correct: result.correct,
        score: result.score,
        maxScore: result.maxScore,
        result,
        at: new Date().toISOString()
      });
      updateRemediationFromQuiz(plan, question, result);
      captureMasterySnapshot(plan, "quiz");
      recordBehavior("quiz-submitted", { planId: plan.id, detail: `${question.type} · ${result.score}/${result.maxScore}` });
    }
    saveState();
    if (state.databaseReady && plan) {
      request(`/api/plans/${encodeURIComponent(plan.id)}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: plan.data, masteryEvidence: plan.masteryEvidence || [] })
      }).catch(reportPersistenceError);
    }
    renderPractice();
    renderKnowledge();
    renderRemediation();
    renderMistakes();
    renderReport();
    renderSavedPlans();
  } catch (error) {
    alert(`评分失败：${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "提交给评分智能体";
    }
  }
}

function updateRemediationFromQuiz(plan, question, result) {
  if (result.correct) return;
  const remediation = plan.data.remediationPlan || {
    generatedAt: new Date().toISOString(),
    target: question.dimension || "当前薄弱点",
    reason: "根据最近错题自动生成补救路径。",
    weakConcepts: [],
    sequence: [],
    coachPrompts: []
  };
  const conceptTitle = question.progressContext?.learnedTask || question.dimension || "错题知识点";
  remediation.target = conceptTitle;
  remediation.reason = `最近测评在「${question.dimension || "综合能力"}」出现错误，建议立即做错因补救。`;
  remediation.weakConcepts = [
    {
      conceptId: question.id,
      title: conceptTitle,
      dimension: question.dimension,
      masteryScore: scorePercent(result),
      reason: result.feedback || "测评未通过"
    },
    ...(remediation.weakConcepts || []).filter((item) => item.conceptId !== question.id)
  ].slice(0, 4);
  remediation.sequence = [
    { step: "错因定位", action: result.feedback || "先解释为什么选错或代码未通过。", expectedEvidence: "能说出错误发生在哪一步。" },
    { step: "回看讲义", action: `回到 ${question.dimension || "对应维度"} 的微讲义，补齐定义、条件和反例。`, expectedEvidence: "能写出一句自己的解释。" },
    { step: "变式练习", action: "重新生成同知识点变式题，并限制只看提示不看答案。", expectedEvidence: "变式题达到 80% 以上。" },
    { step: "复测", action: "完成下一轮测评，把结果写入掌握度证据链。", expectedEvidence: "复测正确或能清楚复盘错因。" }
  ];
  remediation.coachPrompts = [
    `我刚做错了这道题：${question.question}。请先追问我错因，不要直接给答案。`,
    `围绕 ${question.dimension || "这个知识点"} 给我一道变式题。`
  ];
  plan.data.remediationPlan = remediation;
}

function readQuizAnswer(question) {
  return readQuizAnswerFrom(els.practicePanel, question);
}

function readQuizAnswerFrom(container, question) {
  if (question.type === "choice") {
    const selected = container.querySelector(`input[name="${cssEscape(question.id)}"]:checked`);
    return selected ? Number(selected.value) : null;
  }
  const textarea = container.querySelector(`[data-answer-for="${cssEscape(question.id)}"]`);
  return textarea ? textarea.value.trim() : null;
}

function renderPracticeOptionsPanel() {
  const settings = withDefaultSettings(state.settings);
  return `
    <section class="settings-board compact">
      <div class="settings-grid">
        <label>总题量<input id="practiceQuestionCount" type="number" min="1" max="20" value="${settings.questionCount}" /></label>
        <label>选择题<input id="practiceChoiceCount" type="number" min="0" max="20" value="${settings.choiceCount}" /></label>
        <label>简答题<input id="practiceShortCount" type="number" min="0" max="20" value="${settings.shortCount}" /></label>
        <label>编程题<input id="practiceCodeCount" type="number" min="0" max="5" value="${settings.codeCount}" /></label>
        <label>难度<select id="practiceDifficulty">${difficultyOptions(settings.difficulty)}</select></label>
        <label>范围<select id="practiceKnowledgeScope">${scopeOptions(settings.knowledgeScope)}</select></label>
      </div>
      <div class="heading-actions">
        <label class="toggle-line"><input id="practiceShowHints" type="checkbox" ${settings.showHints ? "checked" : ""} /> 显示提示</label>
        <button id="applyPracticeSettings" class="ghost-button" type="button">保存设置并出题</button>
      </div>
    </section>
  `;
}

function savePracticeSettingsFromPanel() {
  state.settings = withDefaultSettings({
    ...state.settings,
    questionCount: numberFrom("#practiceQuestionCount", 4, els.practicePanel),
    choiceCount: numberFrom("#practiceChoiceCount", 3, els.practicePanel),
    shortCount: numberFrom("#practiceShortCount", 1, els.practicePanel),
    codeCount: numberFrom("#practiceCodeCount", 0, els.practicePanel),
    difficulty: valueFrom("#practiceDifficulty", "adaptive", els.practicePanel),
    knowledgeScope: valueFrom("#practiceKnowledgeScope", "current", els.practicePanel),
    showHints: Boolean(els.practicePanel.querySelector("#practiceShowHints")?.checked)
  });
  recordBehavior("settings-updated", { detail: "练习出题设置" });
  saveState();
}

function quizOptionsFromSettings(overrides = {}) {
  const settings = withDefaultSettings(state.settings);
  const options = {
    questionCount: Number(settings.questionCount || 4),
    typeCounts: {
      choice: Number(settings.choiceCount || 0),
      short: Number(settings.shortCount || 0),
      code: Number(settings.codeCount || 0)
    },
    includeCode: Number(settings.codeCount || 0) > 0,
    difficulty: settings.difficulty,
    knowledgeScope: settings.prioritizeWeakness ? "weak" : settings.knowledgeScope,
    showHints: settings.showHints,
    showAnswerMode: settings.hideAnswers ? "after-submit" : "always",
    includeSimilar: false,
    includeRetest: false,
    ...overrides
  };
  if (overrides.typeCounts) {
    options.typeCounts = { ...options.typeCounts, ...overrides.typeCounts };
    options.includeCode = Number(options.typeCounts.code || 0) > 0;
  }
  return options;
}

function buildMistakeBook(plan) {
  if (!plan) return [];
  const quizMistakes = (plan.quizHistory || [])
    .filter((item) => item && item.correct === false)
    .map((item, index) => ({
      id: `quiz-${item.questionId || index}-${item.at || index}`,
      source: item.source || "practice",
      type: item.type || "short",
      dimension: item.dimension || "综合",
      conceptId: item.conceptId,
      question: item.question || "",
      answer: item.answer,
      score: item.score,
      maxScore: item.maxScore,
      feedback: item.result?.feedback || item.feedback || "",
      referenceAnswer: item.result?.referenceAnswer,
      reasonTag: inferReasonTag(item.result?.feedback || item.feedback || item.dimension),
      at: item.at || new Date().toISOString()
    }));
  const diagnosticItems = plan.data?.diagnosticPretest?.items || [];
  const diagnosticMistakes = (plan.data?.diagnosticResult?.results || [])
    .filter((item) => item && item.correct === false)
    .map((item) => {
      const source = diagnosticItems.find((question) => question.id === item.questionId) || {};
      return {
        id: `diagnostic-${item.questionId}`,
        source: "diagnostic",
        type: "diagnostic",
        dimension: item.dimension || source.dimension || "诊断",
        conceptId: item.conceptId || source.conceptId,
        conceptTitle: item.conceptTitle || source.conceptTitle,
        question: source.question || "",
        score: item.score,
        maxScore: item.maxScore,
        feedback: item.explanation || "",
        referenceAnswer: source.explanation,
        reasonTag: (item.misconceptionTags || source.misconceptionTags || [])[0] || inferReasonTag(item.explanation),
        at: plan.data.diagnosticResult?.evaluatedAt || new Date().toISOString()
      };
    });
  return [...quizMistakes, ...diagnosticMistakes]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function inferReasonTag(text) {
  const value = String(text || "");
  if (/泄漏|leak/i.test(value)) return "数据泄漏";
  if (/指标|precision|recall|F1|accuracy/i.test(value)) return "指标误用";
  if (/过拟合|泛化|正则/i.test(value)) return "泛化不足";
  if (/代码|测试|运行|边界/i.test(value)) return "实现问题";
  if (/概念|定义|条件/i.test(value)) return "概念边界";
  return "未归因";
}

function stripQuestionContext(question) {
  return String(question || "")
    .replace(/【进度：[^\n]+】\n?/g, "")
    .replace(/上一轮[^\n]+\n?/g, "")
    .trim();
}

function buildLearningReport(plan) {
  const progress = progressSummaryFor(plan);
  const mistakes = buildMistakeBook(plan);
  const insights = plan.data?.personalInsights || buildPersonalFallbackInsights(plan);
  const mastery = plan.data?.adaptiveState?.concepts || plan.data?.knowledgeGraph?.concepts || [];
  const latestExam = state.exam?.planId === plan.id ? state.exam : null;
  const project = state.projectSubmissions?.[plan.id];
  return [
    `# ${plan.title}`,
    "",
    `生成时间：${formatDate(plan.createdAt)}`,
    `学习目标：${plan.data?.input?.goal || ""}`,
    `当前进度：${progress.done}/${progress.total} 项，${progress.percent}%`,
    "",
    "## 个人学习洞察",
    insights.exportSummary || "等待更多学习证据。",
    ...(insights.nextActions || []).map((item) => `- ${item}`),
    "",
    "## 掌握度概览",
    ...mastery.slice(0, 8).map((item) => `- ${item.title || item.conceptTitle || item.dimension}：${Number(item.masteryScore || item.score || 0)}，${item.nextAction || ""}`),
    "",
    "## 错题与错因",
    ...(mistakes.length ? mistakes.slice(0, 10).map((item) => `- [${typeLabel(item.type)}] ${item.dimension}：${item.reasonTag}，得分 ${Number(item.score || 0)}/${Number(item.maxScore || 0)}`) : ["- 暂无错题。"]),
    "",
    "## 补救路径",
    ...((plan.data?.remediationPlan?.sequence || []).map((item) => `- ${item.step}：${item.action}`)),
    "",
    "## 考试记录",
    latestExam?.status === "submitted"
      ? `- 最近考试：${examScoreText(latestExam)}`
      : "- 暂无已提交考试。",
    "",
    "## 项目任务",
    project
      ? `- 已提交：${formatDate(project.at)}，${project.content.slice(0, 120)}`
      : "- 暂无项目提交。",
    "",
    "## 行为记录摘要",
    ...((state.behaviorEvents || []).filter((event) => event.planId === plan.id).slice(-8).map((event) => `- ${formatDate(event.at)} ${behaviorLabel(event.type)} ${event.detail || ""}`))
  ].join("\n");
}

function exportLearningReport(format, plan, reportText) {
  const filename = safeFilename(plan.title || "learning-report");
  if (format === "copy") {
    navigator.clipboard?.writeText(reportText).catch(() => {});
    recordBehavior("report-exported", { planId: plan.id, detail: "复制 Markdown" });
    return;
  }
  if (format === "json") {
    downloadBlob(`${filename}.json`, JSON.stringify({
      plan,
      mistakes: buildMistakeBook(plan),
      behaviorEvents: state.behaviorEvents || [],
      exam: state.exam?.planId === plan.id ? state.exam : null,
      projectSubmission: state.projectSubmissions?.[plan.id] || null
    }, null, 2), "application/json");
  } else if (format === "html" || format === "print") {
    const html = buildMarkdownDocument(`${plan.title} 学习报告`, reportText);
    if (format === "print") {
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(html);
        win.document.close();
        win.print();
      }
    } else {
      downloadBlob(`${filename}.html`, html, "text/html");
    }
  } else {
    downloadBlob(`${filename}.md`, reportText, "text/markdown");
  }
  recordBehavior("report-exported", { planId: plan.id, detail: format });
  saveState();
  renderSettings();
}

function renderExamQuestion(item, index, result) {
  return `
    <article class="quiz-item">
      <div class="quiz-head">
        <span>第 ${index + 1} 题 · ${typeLabel(item.type)} · 难度 ${Number(item.difficulty || 1)}</span>
        ${result ? `<strong class="${result.correct ? "ok-text" : "bad-text"}">${result.score}/${result.maxScore}</strong>` : ""}
      </div>
      <h3>${escapeHtml(item.question)}</h3>
      ${renderAnswerControl(item, result)}
      ${result ? `<p class="feedback">${escapeHtml(result.feedback || "")}</p>${renderReferenceAnswer(item, result)}` : ""}
    </article>
  `;
}

async function generateExam() {
  const plan = getCurrentPlan();
  if (!plan) return;
  const durationMinutes = numberFrom("#examDuration", 30, els.examPanel);
  const options = quizOptionsFromSettings({
    questionCount: numberFrom("#examQuestionCount", 6, els.examPanel),
    typeCounts: {
      choice: numberFrom("#examChoiceCount", 4, els.examPanel),
      short: numberFrom("#examShortCount", 2, els.examPanel),
      code: numberFrom("#examCodeCount", 0, els.examPanel)
    },
    difficulty: valueFrom("#examDifficulty", "medium", els.examPanel),
    knowledgeScope: "all",
    showHints: false,
    includeRetest: true,
    timeLimitSec: durationMinutes * 60
  });
  els.examPanel.querySelector("#generateExamButton").disabled = true;
  try {
    const data = await request("/api/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(state.databaseReady ? { planId: plan.id } : {}),
        input: plan.data.input,
        plan: plan.data,
        progress: plan.progress,
        history: plan.quizHistory || [],
        regenerate: true,
        variant: Number(plan.quizRound || 0) + 1,
        options
      })
    });
    state.exam = {
      planId: plan.id,
      quiz: data.quiz || [],
      results: {},
      options: data.quizOptions || options,
      startedAt: Date.now(),
      durationSec: durationMinutes * 60,
      status: "running",
      sessionId: data.sessionId || null
    };
    state.settings = withDefaultSettings({
      ...state.settings,
      examQuestionCount: options.questionCount,
      examChoiceCount: options.typeCounts.choice,
      examShortCount: options.typeCounts.short,
      examCodeCount: options.typeCounts.code,
      examDifficulty: options.difficulty,
      examDurationMinutes: durationMinutes
    });
    recordBehavior("exam-generated", { planId: plan.id, detail: `${state.exam.quiz.length} 题` });
    saveState();
    renderExam();
  } catch (error) {
    alert(`考试生成失败：${error.message}`);
  }
}

async function submitExam() {
  const plan = getCurrentPlan();
  const exam = state.exam?.planId === plan?.id ? state.exam : null;
  if (!plan || !exam?.quiz?.length) return;
  const answers = exam.quiz.map((question) => ({ question, answer: readQuizAnswerFrom(els.examPanel, question) }));
  if (withDefaultSettings(state.settings).strictMode && answers.some((item) => item.answer === null || item.answer === "")) {
    alert("还有题目未作答。");
    return;
  }
  const button = els.examPanel.querySelector("#submitExamButton");
  if (button) {
    button.disabled = true;
    button.textContent = "提交中...";
  }
  try {
    for (const { question, answer } of answers) {
      if (answer === null || answer === "") continue;
      question.lastAnswer = answer;
      const endpoint = question.databaseId
        ? `/api/quiz-questions/${encodeURIComponent(question.databaseId)}/attempts`
        : "/api/evaluate";
      const result = await request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(question.databaseId ? { answer } : { question, answer })
      });
      exam.results[question.id] = result;
      plan.quizHistory = plan.quizHistory || [];
      plan.quizHistory.push({
        source: "exam",
        questionId: question.id,
        type: question.type,
        dimension: question.dimension,
        conceptId: question.conceptId,
        question: question.question,
        answer,
        correct: result.correct,
        score: result.score,
        maxScore: result.maxScore,
        result,
        at: new Date().toISOString()
      });
      updateRemediationFromQuiz(plan, question, result);
    }
    exam.status = "submitted";
    exam.submittedAt = Date.now();
    captureMasterySnapshot(plan, "exam");
    recordBehavior("exam-submitted", { planId: plan.id, detail: examScoreText(exam) });
    await persistPlanContent(plan);
    saveState();
    renderExam();
    renderMistakes();
    renderKnowledge();
    renderReport();
    renderSavedPlans();
  } catch (error) {
    alert(`考试提交失败：${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "提交考试";
    }
  }
}

function buildProjectTask(plan) {
  const concepts = (plan.data?.adaptiveState?.weakestConcepts || plan.data?.knowledgeGraph?.concepts || []).slice(0, 5);
  const topic = plan.data?.input?.topic || plan.title;
  return {
    title: `${topic} 个人项目任务`,
    difficulty: concepts.some((item) => Number(item.difficulty || 1) >= 4) ? "进阶" : "入门",
    brief: "用一个小项目串联概念、数据、方法、评估和复盘，提交后进入学习报告。",
    steps: concepts.map((concept, index) => ({
      title: `${index + 1}. ${concept.title || concept.conceptTitle || concept.dimension}`,
      action: `围绕该知识点完成一个可验证的小产出，并说明它解决了什么问题。`,
      acceptance: concept.standard || concept.nextAction || "能解释关键选择，并给出一个反例或边界条件。",
      deliverable: index % 2 === 0 ? "文字说明 + 例子" : "代码/表格/实验记录"
    })).concat(concepts.length ? [] : [{
      title: "1. 项目目标定义",
      action: `给 ${topic} 设计一个可验证的学习产出。`,
      acceptance: "目标、输入、输出和评价指标清楚。",
      deliverable: "项目说明"
    }])
  };
}

function saveProjectSubmission() {
  const plan = getCurrentPlan();
  if (!plan) return;
  const content = els.projectPanel.querySelector("#projectSubmissionText")?.value.trim() || "";
  if (!content) {
    alert("请先填写项目提交说明。");
    return;
  }
  state.projectSubmissions = state.projectSubmissions || {};
  state.projectSubmissions[plan.id] = { content, at: new Date().toISOString() };
  captureMasterySnapshot(plan, "project");
  recordBehavior("project-submitted", { planId: plan.id, detail: `${content.length} 字` });
  saveState();
  renderProject();
  renderReport();
  renderSettings();
}

function saveSettingsFromPanel() {
  state.settings = withDefaultSettings({
    ...state.settings,
    questionCount: numberFrom("#settingQuestionCount", 4, els.settingsPanel),
    choiceCount: numberFrom("#settingChoiceCount", 3, els.settingsPanel),
    shortCount: numberFrom("#settingShortCount", 1, els.settingsPanel),
    codeCount: numberFrom("#settingCodeCount", 0, els.settingsPanel),
    difficulty: valueFrom("#settingDifficulty", "adaptive", els.settingsPanel),
    knowledgeScope: valueFrom("#settingKnowledgeScope", "current", els.settingsPanel),
    reminderTime: valueFrom("#settingReminder", "20:00", els.settingsPanel),
    learningStyle: valueFrom("#settingLearningStyle", "case", els.settingsPanel),
    showHints: Boolean(els.settingsPanel.querySelector("#settingShowHints")?.checked),
    prioritizeWeakness: Boolean(els.settingsPanel.querySelector("#settingPrioritizeWeakness")?.checked),
    strictMode: Boolean(els.settingsPanel.querySelector("#settingStrictMode")?.checked),
    hideAnswers: Boolean(els.settingsPanel.querySelector("#settingHideAnswers")?.checked)
  });
  recordBehavior("settings-updated", { detail: "学习设置" });
  saveState();
  renderSettings();
}

function withDefaultSettings(settings = {}) {
  return {
    questionCount: 4,
    choiceCount: 3,
    shortCount: 1,
    codeCount: 0,
    difficulty: "adaptive",
    knowledgeScope: "current",
    showHints: true,
    showAnswerMode: "after-submit",
    reminderTime: "20:00",
    learningStyle: "case",
    prioritizeWeakness: true,
    strictMode: true,
    hideAnswers: true,
    examQuestionCount: 6,
    examChoiceCount: 4,
    examShortCount: 2,
    examCodeCount: 0,
    examDifficulty: "medium",
    examDurationMinutes: 30,
    ...settings
  };
}

function difficultyOptions(selected) {
  return [
    ["adaptive", "自适应"],
    ["easy", "基础"],
    ["medium", "中等"],
    ["hard", "挑战"]
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function scopeOptions(selected) {
  return [
    ["current", "当前进度"],
    ["weak", "薄弱优先"],
    ["all", "全范围"]
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function styleOptions(selected) {
  return [
    ["case", "案例驱动"],
    ["visual", "图文讲解"],
    ["project", "项目实战"],
    ["drill", "题目训练"]
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function numberFrom(selector, fallback, root = document) {
  const value = Number(root.querySelector(selector)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function valueFrom(selector, fallback, root = document) {
  return root.querySelector(selector)?.value || fallback;
}

function captureMasterySnapshot(plan, source) {
  if (!plan) return;
  const concepts = plan.data?.adaptiveState?.concepts || plan.data?.knowledgeGraph?.concepts || [];
  plan.masteryHistory = plan.masteryHistory || [];
  plan.masteryHistory.push({
    source,
    at: new Date().toISOString(),
    average: concepts.length
      ? Math.round(concepts.reduce((sum, item) => sum + Number(item.masteryScore || item.score || 0), 0) / concepts.length)
      : 0,
    weakest: concepts.slice().sort((a, b) => Number(a.masteryScore || a.score || 0) - Number(b.masteryScore || b.score || 0)).slice(0, 3)
  });
  plan.masteryHistory = plan.masteryHistory.slice(-30);
}

function recordBehavior(type, payload = {}) {
  const plan = payload.planId ? state.plans.find((item) => item.id === payload.planId) : getCurrentPlan();
  state.behaviorEvents = [
    ...(state.behaviorEvents || []),
    {
      type,
      at: new Date().toISOString(),
      planId: payload.planId || plan?.id || null,
      planTitle: plan?.title || "",
      detail: payload.detail || ""
    }
  ].slice(-100);
}

async function persistPlanContent(plan) {
  if (!state.databaseReady || !plan) return;
  try {
    await request(`/api/plans/${encodeURIComponent(plan.id)}/content`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: plan.data, masteryEvidence: plan.masteryEvidence || [] })
    });
  } catch (error) {
    reportPersistenceError(error);
  }
}

function buildPersonalFallbackInsights(plan) {
  const weak = plan.data?.adaptiveState?.weakestConcepts || plan.data?.knowledgeGraph?.concepts?.slice(0, 3) || [];
  return {
    exportSummary: weak.length ? `建议优先补强 ${weak.map((item) => item.title || item.conceptTitle).join("、")}。` : "等待更多学习证据。",
    nextActions: ["完成一次诊断前测。", "按默认设置生成练习。", "把错题写入复盘记录。"]
  };
}

function examScoreText(exam) {
  const results = Object.values(exam?.results || {});
  const score = results.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const max = results.reduce((sum, item) => sum + Number(item.maxScore || 0), 0);
  return `${score}/${max}`;
}

function behaviorLabel(type) {
  return {
    "plan-generated": "生成方案",
    "diagnostic-submitted": "提交诊断",
    "quiz-generated": "生成练习",
    "quiz-submitted": "提交练习",
    "exam-generated": "生成考试",
    "exam-submitted": "提交考试",
    "project-step": "项目步骤",
    "project-submitted": "提交项目",
    "report-exported": "导出报告",
    "settings-updated": "更新设置"
  }[type] || type;
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(value) {
  return String(value || "learning-report").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
}

function renderAgents() {
  const plan = getCurrentPlan();
  if (plan?.data?.generationLoop) {
    els.agentMode.textContent = plan.data.generationLoop.status || "协作流程已生成";
    renderAgentGraph(plan.data.generationLoop);
  } else {
    els.agentMode.textContent = "等待方案";
    els.agentCanvas.className = "agent-canvas empty-state";
    els.agentCanvas.innerHTML = "<p>生成方案后会展示智能体数据流。</p>";
  }

  const agents = plan?.data?.agents || state.agents || [];
  els.agentList.innerHTML = agents.map((agent) => `
    <article class="agent-item">
      <strong>${escapeHtml(agent.name)}</strong>
      <p>${escapeHtml(agent.role)}</p>
    </article>
  `).join("");
}

async function requestGeneratedPlan(payload) {
  try {
    return await requestGeneratedPlanStream(payload);
  } catch (error) {
    console.warn("stream generation failed, fallback to normal request", error);
    return request("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
}

async function requestGeneratedPlanStream(payload) {
  const response = await fetch(`${API_BASE}/api/generate-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok || !response.body) {
    throw new Error(`流式生成请求失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      updateFlowFromEvent(event);
      if (event.type === "final") finalResult = event.result;
      if (event.type === "fatal") throw new Error(event.message || "生成失败");
    }
  }

  if (!finalResult) throw new Error("生成流结束但没有返回最终方案");
  return finalResult;
}

function startFlowSession() {
  clearInterval(flowTimer);
  state.liveFlow = [];
  els.generationFlow.className = "flow-board running";
  els.generationFlow.innerHTML = `
    <div class="flow-row active">
      <span>1</span>
      <strong>正在规划课程</strong>
      <em>分析主题、目标、水平和薄弱点</em>
    </div>
    <div class="flow-row">
      <span>2</span>
      <strong>生成章节</strong>
      <em>组织每日路径、阅读任务和项目练习</em>
    </div>
    <div class="flow-row">
      <span>3</span>
      <strong>生成测验</strong>
      <em>准备诊断、Quiz 和复习线索</em>
    </div>
    <div class="flow-row">
      <span>4</span>
      <strong>校验质量</strong>
      <em>检查内容边界和课程一致性</em>
    </div>
  `;
}

function updateFlowFromEvent(event) {
  if (event.type === "session-start") {
    state.liveFlow = [{
      agentId: "session",
      agent: "协作会话",
      action: event.message,
      status: "active",
      input: "用户提交的学习需求",
      output: "正在分发任务"
    }];
  }

  if (event.type === "agent-start") {
    state.liveFlow = (state.liveFlow || [])
      .filter((item) => item.agentId !== event.agentId)
      .map((item) => item.status === "active" ? { ...item, status: "done", output: item.output === "执行中" ? "已交接给下一智能体" : item.output } : item);
    state.liveFlow.push({
      agentId: event.agentId,
      agent: event.agent,
      action: event.action,
      status: "active",
      input: event.input,
      output: "执行中",
      startedAt: event.startedAt || event.at
    });
  }

  if (event.type === "agent-done" || event.type === "agent-error") {
    state.liveFlow = (state.liveFlow || []).map((item) => {
      if (item.agentId !== event.agentId) return item;
      return {
        ...item,
        status: event.type === "agent-error" ? "error" : "done",
        output: event.output,
        durationMs: event.durationMs,
        completedAt: event.completedAt || event.at
      };
    });
  }

  if (event.type === "final") {
    state.liveFlow = (state.liveFlow || []).map((item) => (
      item.status === "active" ? { ...item, status: "done", output: "已完成" } : item
    ));
  }

  renderLiveFlow();
}

function renderLiveFlow() {
  const items = state.liveFlow || [];
  const current = [...items].reverse().find((item) => item.status === "active");
  els.generationFlow.className = "flow-board running";
  els.generationFlow.innerHTML = `
    <section class="current-agent-panel ${current ? "working" : ""}">
      <span>${current ? "工作中" : "等待中"}</span>
      <strong>${escapeHtml(current?.agent || "等待智能体接收任务")}</strong>
      <p>${escapeHtml(current?.action || "生成开始后会实时切换到当前正在执行的智能体。")}</p>
      ${current ? `<small>输入：${escapeHtml(current.input)}<br />状态：${escapeHtml(current.output)}</small>` : ""}
    </section>
    ${items.map((item, index) => `
      <div class="flow-row ${item.status === "active" ? "active" : item.status === "done" ? "done" : "error"}">
        <span>${index + 1}</span>
        <strong>${escapeHtml(item.agent)}</strong>
        <em>${flowStatusLabel(item.status)} · ${escapeHtml(item.action)}<br />输入：${escapeHtml(item.input)}<br />输出：${escapeHtml(item.output)}${item.durationMs !== undefined ? ` · ${item.durationMs}ms` : ""}</em>
      </div>
    `).join("")}
  `;
}

function flowStatusLabel(status) {
  return {
    active: "正在工作",
    done: "已完成",
    error: "已失败"
  }[status] || "等待";
}

function renderIdleFlow() {
  els.generationFlow.innerHTML = `
    <div class="flow-row active"><span>1</span><strong>输入学习主题</strong><em>课程会围绕你的主题生成</em></div>
    <div class="flow-row"><span>2</span><strong>规划章节与测验</strong><em>生成后自动进入课程详情</em></div>
  `;
}

function renderFlow(loop, status) {
  clearInterval(flowTimer);
  const flows = loop?.flows || [];
  els.generationFlow.className = `flow-board ${status || ""}`;
  els.generationFlow.innerHTML = flows.map((flow, index) => `
    <div class="flow-row done">
      <span>${index + 1}</span>
      <strong>${escapeHtml(flow.from)} -> ${escapeHtml(flow.to)}</strong>
      <em>${escapeHtml(flow.payload)}</em>
    </div>
  `).join("");
}

function renderAgentGraph(loop) {
  const stages = loop.stages || [];
  const flows = loop.flows || [];
  els.agentCanvas.className = "agent-canvas";
  els.agentCanvas.innerHTML = `
    <div class="agent-node-grid">
      ${stages.map((stage, index) => `
        <article class="agent-node">
          <span>${index + 1}</span>
          <strong>${escapeHtml(stage.agent)}</strong>
          <p>${escapeHtml(stage.action)}</p>
          <small>输入：${escapeHtml(stage.input)}<br />输出：${escapeHtml(stage.output)}</small>
        </article>
      `).join("")}
    </div>
    <div class="data-flow-list">
      ${flows.map((flow) => `
        <div class="data-flow-item">
          <strong>${escapeHtml(flow.from)}</strong>
          <span></span>
          <strong>${escapeHtml(flow.to)}</strong>
          <em>${escapeHtml(flow.payload)}</em>
        </div>
      `).join("")}
    </div>
    <div class="agent-artifact-list">
      ${(loop.artifacts || []).map((artifact) => `
        <article class="agent-item">
          <strong>${escapeHtml(artifact.id)} · v${Number(artifact.version || 1)}</strong>
          <p>${escapeHtml(artifact.owner)} 产出 ${escapeHtml(artifact.type)}，状态：${escapeHtml(artifact.status)}</p>
          <small>审阅：${escapeHtml((artifact.reviewers || []).join("、"))}</small>
        </article>
      `).join("")}
    </div>
    <div class="agent-artifact-list">
      ${(loop.revisionCycles || []).map((cycle) => `
        <article class="agent-item">
          <strong>第 ${Number(cycle.round || 1)} 轮审阅 · ${escapeHtml(cycle.reviewer)}</strong>
          <p>${escapeHtml(cycle.issue)}</p>
          <small>${escapeHtml(cycle.decision)}</small>
        </article>
      `).join("")}
    </div>
  `;
}

async function askTutor() {
  const question = els.coachQuestion.value.trim();
  if (!question) {
    els.coachAnswer.textContent = "请先输入你的问题。";
    return;
  }
  els.coachButton.disabled = true;
  els.coachButton.textContent = "思考中";
  els.coachAnswer.textContent = "学习助手正在结合当前课程、进度和测评结果回答...";

  try {
    const plan = getCurrentPlan();
    const context = plan ? JSON.stringify({
      topic: plan.data.input?.topic,
      profile: plan.data.learnerProfile?.summary,
      progress: progressSummaryFor(plan),
      notes: plan.notes,
      diagnostic: plan.data.diagnosticResult,
      weakestConcepts: plan.data.adaptiveState?.weakestConcepts,
      remediation: plan.data.remediationPlan,
      quizResults: state.quizResults
    }) : "";
    const data = await request("/api/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        context,
        mode: els.tutorMode.value,
        hintLevel: Number(els.hintLevel.value || 1),
        history: state.tutorHistory || []
      })
    });
    els.coachAnswer.innerHTML = renderMarkdown(data.answer);
    state.tutorHistory = [
      ...(state.tutorHistory || []),
      { role: "student", content: question, at: new Date().toISOString() },
      { role: "tutor", content: data.answer, mode: data.tutorMode, hintLevel: data.hintLevel, at: new Date().toISOString() }
    ].slice(-12);
    saveState();
    els.coachMode.textContent = data.mode === "llm"
      ? `大模型回答 · ${tutorModeLabel(data.tutorMode)} · 提示 ${data.hintLevel}`
      : `本地提示 · ${tutorModeLabel(data.tutorMode)} · 提示 ${data.hintLevel}`;
  } catch (error) {
    els.coachAnswer.textContent = `导师回答失败：${error.message}`;
  } finally {
    els.coachButton.disabled = false;
    els.coachButton.textContent = "获得帮助";
  }
}

function drawRadar(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data.length) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2 + 8;
  const radius = Math.min(width, height) * 0.32;
  const step = (Math.PI * 2) / data.length;

  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px Microsoft YaHei, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let ring = 1; ring <= 4; ring += 1) {
    const ringRadius = (radius / 4) * ring;
    ctx.beginPath();
    data.forEach((_, index) => {
      const point = radarPoint(centerX, centerY, ringRadius, step, index);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.strokeStyle = "#d8e2f0";
    ctx.stroke();
  }

  data.forEach((item, index) => {
    const outer = radarPoint(centerX, centerY, radius, step, index);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(outer.x, outer.y);
    ctx.strokeStyle = "#e2e8f0";
    ctx.stroke();

    const label = radarPoint(centerX, centerY, radius + 28, step, index);
    ctx.fillStyle = "#475569";
    ctx.fillText(item.dimension, label.x, label.y);
  });

  ctx.beginPath();
  data.forEach((item, index) => {
    const score = clamp(Number(item.score) || 0);
    const point = radarPoint(centerX, centerY, radius * (score / 100), step, index);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(37, 99, 235, 0.18)";
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
}

function radarPoint(centerX, centerY, radius, step, index) {
  const angle = -Math.PI / 2 + step * index;
  return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
}

function progressSummaryFor(plan) {
  const dailyPlan = plan?.data?.dailyPlan || [];
  const progress = plan?.progress || {};
  const total = dailyPlan.reduce((sum, day) => sum + (day.tasks?.length || 0), 0);
  const done = Object.entries(progress).filter(([, value]) => Boolean(value)).length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

function riskLabel(value) {
  return {
    low: "低风险",
    medium: "中风险",
    high: "高风险"
  }[value] || value || "待评估";
}

function tutorModeLabel(value) {
  return {
    hint: "分层提示",
    inquiry: "追问引导",
    explain: "讲解巩固"
  }[value] || "分层提示";
}

function getCurrentPlan() {
  return state.plans.find((plan) => plan.id === state.currentPlanId) || null;
}

async function request(path, options) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...(options || {})
    });
  } catch (error) {
    throw new Error(`无法连接后端服务 ${API_BASE}。请确认 npm run dev 正在运行，并刷新页面后重试。`);
  }
  if (!response.ok) {
    const data = await response.json().catch(async () => ({ message: await response.text() }));
    throw new Error(data.detail || data.message || `请求失败：${response.status}`);
  }
  return response.json();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
}

function serializeState() {
  return {
    plans: state.plans || [],
    currentPlanId: state.currentPlanId || null,
    quiz: state.quiz || [],
    quizResults: state.quizResults || {},
    agents: state.agents || [],
    tutorHistory: state.tutorHistory || [],
    settings: withDefaultSettings(state.settings),
    behaviorEvents: state.behaviorEvents || [],
    exam: state.exam || null,
    projectTasks: state.projectTasks || {},
    projectProgress: state.projectProgress || {},
    projectSubmissions: state.projectSubmissions || {},
    mistakeFilters: state.mistakeFilters || { concept: "all", type: "all", reason: "all" },
    lastQuizOptions: state.lastQuizOptions || null
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      plans: saved?.plans || [],
      currentPlanId: saved?.currentPlanId || null,
      quiz: saved?.quiz || [],
      quizResults: saved?.quizResults || {},
      agents: saved?.agents || [],
      tutorHistory: saved?.tutorHistory || [],
      settings: withDefaultSettings(saved?.settings || {}),
      behaviorEvents: saved?.behaviorEvents || [],
      exam: saved?.exam || null,
      projectTasks: saved?.projectTasks || {},
      projectProgress: saved?.projectProgress || {},
      projectSubmissions: saved?.projectSubmissions || {},
      mistakeFilters: saved?.mistakeFilters || { concept: "all", type: "all", reason: "all" },
      lastQuizOptions: saved?.lastQuizOptions || null,
      databaseReady: false
    };
  } catch {
    return {
      plans: [],
      currentPlanId: null,
      quiz: [],
      quizResults: {},
      agents: [],
      tutorHistory: [],
      settings: withDefaultSettings({}),
      behaviorEvents: [],
      exam: null,
      projectTasks: {},
      projectProgress: {},
      projectSubmissions: {},
      mistakeFilters: { concept: "all", type: "all", reason: "all" },
      lastQuizOptions: null,
      databaseReady: false
    };
  }
}

function reportPersistenceError(error) {
  els.serviceStatus.textContent = "数据库同步失败";
  els.modelStatus.textContent = error.message;
  els.statusDot.classList.remove("ok");
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cssEscape(value) {
  return String(value).replaceAll('"', '\\"');
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdown(value) {
  return window.markdownRenderer?.toHtml(value)
    || escapeHtml(value).replaceAll("\n", "<br />");
}

function buildMarkdownDocument(title, value) {
  return window.markdownRenderer?.toDocument(title, value)
    || `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(title)}</title><body><pre>${escapeHtml(value)}</pre></body></html>`;
}
