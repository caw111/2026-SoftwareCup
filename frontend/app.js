const API_BASE = `${location.protocol}//${location.hostname || "127.0.0.1"}:3000`;
const STORAGE_KEY = "software-cup-learning-workspace-v2";

const state = loadState();
let activeView = location.hash.replace("#", "") || "home";
let flowTimer = null;
let persistTimer = null;

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
  planCount: document.querySelector("#planCount"),
  generationFlow: document.querySelector("#generationFlow"),
  knowledgePanel: document.querySelector("#knowledgePanel"),
  masteryMode: document.querySelector("#masteryMode"),
  practicePanel: document.querySelector("#practicePanel"),
  regenerateQuizButton: document.querySelector("#regenerateQuizButton"),
  judgeStatus: document.querySelector("#judgeStatus")
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
    const diskState = await request("/api/workspace-state");
    if (diskState?.plans?.length) {
      state.plans = diskState.plans;
      state.currentPlanId = diskState.currentPlanId || diskState.plans[0]?.id || null;
      state.quiz = diskState.quiz || [];
      state.quizResults = diskState.quizResults || {};
      state.agents = diskState.agents || state.agents || [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
      renderAll();
    }
    state.diskReady = true;
  } catch {
    state.diskReady = false;
  }
}

function syncRoute() {
  setView(location.hash.replace("#", "") || "home", { replace: true });
}

function setView(view, options = {}) {
  activeView = document.querySelector(`#${view}.view`) ? view : "home";
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === activeView);
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.view === activeView);
  });
  if (!options.replace) location.hash = activeView;
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
  const submitButton = els.form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "正在生成学习工作台";

  const payload = Object.fromEntries(new FormData(els.form).entries());
  startFlowSession();
  setView("home");

  try {
    const data = await requestGeneratedPlan(payload);
    const plan = normalizeNewPlan(data);
    state.plans.unshift(plan);
    state.currentPlanId = plan.id;
    state.quiz = [];
    state.quizResults = {};
    saveState();
    renderAll();
    renderFlow(data.generationLoop, "done");
    setView("plans");
    els.coachMode.textContent = "已加载学习上下文";
  } catch (error) {
    els.generationFlow.className = "flow-board";
    els.generationFlow.innerHTML = `<p class="warning">生成失败：${escapeHtml(error.message)}</p>`;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "生成并保存学习方案";
  }
}

function normalizeNewPlan(data) {
  return {
    id: `plan-${Date.now()}`,
    title: data.resourcePackage?.title || `${data.input?.topic || "学习"}方案`,
    createdAt: new Date().toISOString(),
    category: data.input?.outputType || "完整学习方案",
    data,
    progress: {},
    notes: "",
    masteryEvidence: [],
    quizHistory: []
  };
}

function renderAll() {
  renderSavedPlans();
  renderDailyPlan();
  renderKnowledge();
  renderPractice();
  renderAgents();
}

function renderSavedPlans() {
  els.planCount.textContent = `${state.plans.length} 个方案`;
  if (!state.plans.length) {
    els.savedPlans.className = "plan-list empty-state";
    els.savedPlans.innerHTML = "<p>还没有保存的学习方案。</p>";
    return;
  }

  els.savedPlans.className = "plan-list";
  els.savedPlans.innerHTML = state.plans.map((plan) => {
    const summary = progressSummaryFor(plan);
    const quizStatus = quizStatusFor(plan);
    const active = plan.id === state.currentPlanId;
    return `
      <article class="plan-card ${active ? "active" : ""}">
        <div>
          <span class="tag">${escapeHtml(plan.category)}</span>
          <h3>${escapeHtml(plan.title)}</h3>
          <p>${escapeHtml(plan.data?.learnerProfile?.summary || "")}</p>
          <small>${formatDate(plan.createdAt)} · 已完成 ${summary.done}/${summary.total} 项 · ${summary.percent}% · ${escapeHtml(quizStatus)}</small>
        </div>
        <div class="plan-actions">
          <button class="ghost-button" type="button" data-open-plan="${plan.id}">${active ? "当前使用" : "使用方案"}</button>
          <button class="text-button" type="button" data-delete-plan="${plan.id}">删除</button>
        </div>
      </article>
    `;
  }).join("");

  els.savedPlans.querySelectorAll("[data-open-plan]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentPlanId = button.dataset.openPlan;
      state.quiz = [];
      state.quizResults = {};
      saveState();
      renderAll();
      setView("daily");
    });
  });
  els.savedPlans.querySelectorAll("[data-delete-plan]").forEach((button) => {
    button.addEventListener("click", () => deletePlan(button.dataset.deletePlan));
  });
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

function deletePlan(id) {
  state.plans = state.plans.filter((plan) => plan.id !== id);
  if (state.currentPlanId === id) {
    state.currentPlanId = state.plans[0]?.id || null;
    state.quiz = [];
    state.quizResults = {};
  }
  saveState();
  renderAll();
}

function renderDailyPlan() {
  const plan = getCurrentPlan();
  if (!plan?.data?.dailyPlan?.length) {
    els.dailyPanel.className = "empty-state";
    els.dailyPanel.innerHTML = "<p>生成或选择学习方案后，这里会出现每日任务。</p>";
    els.progressSummary.textContent = "等待生成";
    return;
  }

  const data = plan.data;
  els.dailyPanel.className = "daily-board";
  els.dailyPanel.innerHTML = `
    <section class="daily-overview">
      <div>
        <strong>${escapeHtml(plan.title)}</strong>
        <p>${escapeHtml(data.learnerProfile?.summary || "")}</p>
      </div>
      <button class="ghost-button" type="button" id="resetProgressButton">重置进度</button>
    </section>
    <div class="daily-grid">
      ${data.dailyPlan.map((day) => renderDayCard(day, plan.progress || {})).join("")}
    </div>
    <section class="study-notes">
      <label>
        学习笔记与错因记录
        <textarea id="studyNotes" rows="5" placeholder="写下今天的卡点、错因、收获。">${escapeHtml(plan.notes || "")}</textarea>
      </label>
    </section>
  `;

  els.dailyPanel.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", updateProgress);
  });
  els.dailyPanel.querySelector("#studyNotes").addEventListener("input", updateNotes);
  els.dailyPanel.querySelector("#resetProgressButton").addEventListener("click", resetProgress);
  updateProgressSummary();
}

function renderDayCard(day, progress) {
  const tasks = day.tasks || [];
  return `
    <article class="day-card">
      <div class="day-card-head">
        <span>Day ${day.day}</span>
        <strong>${escapeHtml(day.title)}</strong>
        <em>${escapeHtml(day.estimate || "")} · ${escapeHtml(day.focus || "")}</em>
      </div>
      <div class="task-list">
        ${tasks.map((task, index) => {
          const id = progressId(day.day, index);
          return `
            <label class="task-item">
              <input type="checkbox" data-progress-id="${id}" ${progress[id] ? "checked" : ""} />
              <span>${escapeHtml(task)}</span>
            </label>
          `;
        }).join("")}
      </div>
      <p class="checkpoint">${escapeHtml(day.checkpoint || "")}</p>
    </article>
  `;
}

function progressId(day, index) {
  return `day-${day}-task-${index}`;
}

function updateProgress(event) {
  const plan = getCurrentPlan();
  if (!plan) return;
  plan.progress = plan.progress || {};
  plan.progress[event.target.dataset.progressId] = event.target.checked;
  state.quiz = [];
  state.quizResults = {};
  saveState();
  updateProgressSummary();
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
}

function resetProgress() {
  const plan = getCurrentPlan();
  if (!plan) return;
  plan.progress = {};
  state.quiz = [];
  state.quizResults = {};
  saveState();
  renderAll();
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
  els.masteryMode.textContent = `基于 ${summary.done} 项打卡和 ${Object.keys(state.quizResults || {}).length} 道测评`;
  els.knowledgePanel.className = "result-grid";
  els.knowledgePanel.innerHTML = `
    <article class="result-card radar-card">
      <h3>知识点掌握雷达图</h3>
      <canvas id="masteryRadar" width="360" height="300" aria-label="知识点掌握雷达图"></canvas>
      <p class="hint-text">初始值来自自评；打卡提供学习证据，测评正确率提供掌握证据。</p>
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
  const summary = progressSummaryFor(plan);
  const quizResults = Object.values(state.quizResults || {});
  return base.map((item) => {
    const relatedResults = quizResults.filter((result) => result.dimension === item.dimension);
    const avgQuiz = relatedResults.length
      ? Math.round(relatedResults.reduce((sum, result) => sum + scorePercent(result), 0) / relatedResults.length)
      : null;
    const progressBoost = Math.min(18, Math.round(summary.percent * 0.18));
    const quizWeight = avgQuiz === null ? 0 : Math.round((avgQuiz - 60) * 0.35);
    const score = clamp(Number(item.score || 50) + progressBoost + quizWeight);
    const evidence = avgQuiz === null
      ? `自评基础 ${item.score || 50} + 打卡进度 ${summary.percent}%`
      : `自评基础 ${item.score || 50} + 打卡 ${summary.percent}% + 测评 ${avgQuiz}%`;
    return { ...item, score, evidence };
  });
}

function scorePercent(result) {
  return result.maxScore ? Math.round((Number(result.score || 0) / Number(result.maxScore)) * 100) : Number(result.score || 0);
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
      <div class="empty-state compact">
        <p>练习题会根据当前打卡进度生成。</p>
        <button id="loadQuizButton" class="primary-button" type="button">生成进度匹配练习</button>
      </div>
    `;
    document.querySelector("#loadQuizButton").addEventListener("click", () => loadQuiz(false));
    return;
  }

  els.practicePanel.className = "practice-panel";
  els.practicePanel.innerHTML = `
    <div class="quiz-list">
      ${state.quiz.map((item, index) => renderQuizItem(item, index)).join("")}
    </div>
    <div class="score-panel">${renderScoreSummary()}</div>
  `;

  els.practicePanel.querySelectorAll("[data-evaluate]").forEach((button) => {
    button.addEventListener("click", () => evaluateQuiz(button.dataset.evaluate));
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
    code: "编程题"
  }[type] || "综合题";
}

function renderScoreSummary() {
  const results = Object.values(state.quizResults || {});
  if (!results.length) return "尚未提交答案。";
  const score = results.reduce((sum, result) => sum + Number(result.score || 0), 0);
  const max = results.reduce((sum, result) => sum + Number(result.maxScore || 0), 0);
  return `测评评分智能体已完成 ${results.length}/${state.quiz.length} 题，当前得分 ${score}/${max}。`;
}

async function loadQuiz(regenerate) {
  const plan = getCurrentPlan();
  if (!plan) return;
  els.practicePanel.className = "empty-state";
  els.practicePanel.innerHTML = "<p>正在根据学习进度重新出题...</p>";
  plan.quizRound = regenerate ? Number(plan.quizRound || 0) + 1 : Number(plan.quizRound || 0);

  try {
    const data = await request("/api/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: plan.data.input,
        plan: plan.data,
        progress: plan.progress,
        history: plan.quizHistory || [],
        regenerate,
        variant: plan.quizRound
      })
    });
    state.quiz = data.quiz || [];
    state.quizResults = {};
    saveState();
    renderPractice();
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
    const result = await request("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer })
    });
    state.quizResults[questionId] = result;
    const plan = getCurrentPlan();
    if (plan) {
      plan.quizHistory = plan.quizHistory || [];
      plan.quizHistory.push({
        questionId,
        type: question.type,
        dimension: question.dimension,
        question: question.question,
        correct: result.correct,
        score: result.score,
        maxScore: result.maxScore,
        result,
        at: new Date().toISOString()
      });
    }
    saveState();
    renderPractice();
    renderKnowledge();
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

function readQuizAnswer(question) {
  if (question.type === "choice") {
    const selected = els.practicePanel.querySelector(`input[name="${cssEscape(question.id)}"]:checked`);
    return selected ? Number(selected.value) : null;
  }
  const textarea = els.practicePanel.querySelector(`[data-answer-for="${cssEscape(question.id)}"]`);
  return textarea ? textarea.value.trim() : null;
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
      <span>0</span>
      <strong>后端协作会话启动中</strong>
      <em>等待第一个智能体接收任务</em>
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
    <div class="flow-row active"><span>1</span><strong>填写学习需求</strong><em>等待输入</em></div>
    <div class="flow-row"><span>2</span><strong>生成方案时显示数据流</strong><em>待启动</em></div>
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
  els.coachAnswer.textContent = "AI 导师正在结合当前学习方案、进度和测评结果回答...";

  try {
    const plan = getCurrentPlan();
    const context = plan ? JSON.stringify({
      topic: plan.data.input?.topic,
      profile: plan.data.learnerProfile?.summary,
      progress: progressSummaryFor(plan),
      notes: plan.notes,
      quizResults: state.quizResults
    }) : "";
    const data = await request("/api/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, context })
    });
    els.coachAnswer.innerHTML = escapeHtml(data.answer).replaceAll("\n", "<br />");
    els.coachMode.textContent = data.mode === "llm" ? "大模型回答" : "本地提示";
  } catch (error) {
    els.coachAnswer.textContent = `导师回答失败：${error.message}`;
  } finally {
    els.coachButton.disabled = false;
    els.coachButton.textContent = "问 AI 导师";
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

function getCurrentPlan() {
  return state.plans.find((plan) => plan.id === state.currentPlanId) || null;
}

async function request(path, options) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
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
  scheduleDiskSave();
}

function serializeState() {
  return {
    plans: state.plans || [],
    currentPlanId: state.currentPlanId || null,
    quiz: state.quiz || [],
    quizResults: state.quizResults || {},
    agents: state.agents || []
  };
}

function scheduleDiskSave() {
  if (!state.diskReady) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    fetch(`${API_BASE}/api/workspace-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeState())
    }).catch(() => {
      state.diskReady = false;
    });
  }, 350);
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
      diskReady: false
    };
  } catch {
    return { plans: [], currentPlanId: null, quiz: [], quizResults: {}, agents: [], diskReady: false };
  }
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
