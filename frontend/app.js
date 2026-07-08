const API_BASE = "http://localhost:3000";
const STORAGE_KEY = "software-cup-learning-workspace";

const form = document.querySelector("#learningForm");
const resultGrid = document.querySelector("#resultGrid");
const resultMode = document.querySelector("#resultMode");
const dailyPanel = document.querySelector("#dailyPanel");
const progressSummary = document.querySelector("#progressSummary");
const serviceStatus = document.querySelector("#serviceStatus");
const modelStatus = document.querySelector("#modelStatus");
const healthButton = document.querySelector("#healthButton");
const llmTestButton = document.querySelector("#llmTestButton");
const agentList = document.querySelector("#agentList");
const statusDot = document.querySelector(".status-dot");
const coachQuestion = document.querySelector("#coachQuestion");
const coachButton = document.querySelector("#coachButton");
const coachAnswer = document.querySelector("#coachAnswer");
const coachMode = document.querySelector("#coachMode");

let currentPlan = loadSavedPlan();

healthButton.addEventListener("click", checkHealth);
llmTestButton.addEventListener("click", testLargeModel);
form.addEventListener("submit", generatePlan);
coachButton.addEventListener("click", askTutor);

loadAgents();
checkHealth();
if (currentPlan) {
  renderResult(currentPlan);
  renderDailyPlan(currentPlan);
  resultMode.textContent = "已恢复上次方案";
  coachMode.textContent = "已载入学习上下文";
}

async function checkHealth() {
  try {
    const data = await request("/api/health");
    serviceStatus.textContent = "后端已连接";
    modelStatus.textContent = formatModelStatus(data);
    statusDot.classList.add("ok");
  } catch {
    serviceStatus.textContent = "后端未连接";
    modelStatus.textContent = "请先运行 npm run dev";
    statusDot.classList.remove("ok");
  }
}

async function testLargeModel() {
  llmTestButton.disabled = true;
  llmTestButton.textContent = "测试中";

  try {
    const data = await request("/api/llm-test");
    serviceStatus.textContent = data.ok ? "大模型已连接" : "大模型未连接";
    modelStatus.textContent = data.ok
      ? `${data.llm.model}：${data.sample || data.message}`
      : `${data.message}${data.detail ? ` ${data.detail}` : ""}`;
    statusDot.classList.toggle("ok", data.ok);
  } catch (error) {
    serviceStatus.textContent = "大模型测试失败";
    modelStatus.textContent = error.message;
    statusDot.classList.remove("ok");
  } finally {
    llmTestButton.disabled = false;
    llmTestButton.textContent = "测试大模型";
  }
}

function formatModelStatus(data) {
  if (!data.llmEnabled) {
    return "本地规则模式，可离线演示";
  }
  return `大模型：${data.llm.model} / ${data.llm.wireApi} / ${data.llm.baseUrl}`;
}

async function loadAgents() {
  try {
    const data = await request("/api/agents");
    agentList.innerHTML = data.agents.map((agent) => `
      <article class="agent-item">
        <strong>${escapeHtml(agent.name)}</strong>
        <p>${escapeHtml(agent.role)}</p>
      </article>
    `).join("");
  } catch {
    agentList.innerHTML = `<p class="warning">暂时无法加载智能体列表。</p>`;
  }
}

async function generatePlan(event) {
  event.preventDefault();
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "正在生成学习工作台";
  resultMode.textContent = "生成中";
  progressSummary.textContent = "生成中";

  const payload = Object.fromEntries(new FormData(form).entries());

  try {
    const data = await request("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    currentPlan = { ...data, progress: {}, notes: loadSavedPlan()?.notes || "" };
    savePlan(currentPlan);
    renderResult(currentPlan);
    renderDailyPlan(currentPlan);
    resultMode.textContent = data.mode === "llm-core" ? "大模型核心生成" : "本地可用方案";
    coachMode.textContent = "可基于当前方案追问";
  } catch (error) {
    resultGrid.className = "result-grid empty-state";
    resultGrid.innerHTML = `<p class="warning">生成失败：${escapeHtml(error.message)}</p>`;
    resultMode.textContent = "生成失败";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "生成我的学习工作台";
  }
}

function renderDailyPlan(data) {
  const dailyPlan = data.dailyPlan || [];
  if (!dailyPlan.length) {
    dailyPanel.className = "empty-state";
    dailyPanel.innerHTML = "<p>当前方案没有每日任务。</p>";
    return;
  }

  dailyPanel.className = "daily-board";
  dailyPanel.innerHTML = `
    <section class="daily-overview">
      <div>
        <strong>${escapeHtml(data.resourcePackage?.title || data.input?.topic || "学习计划")}</strong>
        <p>${escapeHtml(data.learnerProfile?.summary || "")}</p>
      </div>
      <button class="ghost-button" type="button" id="resetProgressButton">重置进度</button>
    </section>
    <div class="daily-grid">
      ${dailyPlan.map((day) => renderDayCard(day, data.progress || {})).join("")}
    </div>
    <section class="study-notes">
      <label>
        学习笔记与错因记录
        <textarea id="studyNotes" rows="5" placeholder="写下今天的卡点、错因、收获。下次生成时可以复制到薄弱点里。">${escapeHtml(data.notes || "")}</textarea>
      </label>
    </section>
  `;

  dailyPanel.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", updateProgress);
  });
  dailyPanel.querySelector("#studyNotes").addEventListener("input", updateNotes);
  dailyPanel.querySelector("#resetProgressButton").addEventListener("click", resetProgress);
  updateProgressSummary();
}

function renderDayCard(day, progress) {
  const tasks = day.tasks || [];
  return `
    <article class="day-card">
      <div class="day-card-head">
        <span>Day ${day.day}</span>
        <strong>${escapeHtml(day.title)}</strong>
        <em>${escapeHtml(day.estimate || "")}</em>
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
  if (!currentPlan) return;
  const id = event.target.dataset.progressId;
  currentPlan.progress = currentPlan.progress || {};
  currentPlan.progress[id] = event.target.checked;
  savePlan(currentPlan);
  updateProgressSummary();
}

function updateProgressSummary() {
  if (!currentPlan?.dailyPlan) {
    progressSummary.textContent = "等待生成";
    return;
  }
  const total = currentPlan.dailyPlan.reduce((sum, day) => sum + (day.tasks?.length || 0), 0);
  const done = Object.values(currentPlan.progress || {}).filter(Boolean).length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  progressSummary.textContent = `已完成 ${done}/${total} 项，进度 ${percent}%`;
}

function updateNotes(event) {
  if (!currentPlan) return;
  currentPlan.notes = event.target.value;
  savePlan(currentPlan);
}

function resetProgress() {
  if (!currentPlan) return;
  currentPlan.progress = {};
  savePlan(currentPlan);
  renderDailyPlan(currentPlan);
}

function renderResult(data) {
  resultGrid.className = "result-grid";
  const quiz = data.assessment?.quiz || [];
  resultGrid.innerHTML = `
    <article class="result-card profile-card">
      <h3>动态学习者画像</h3>
      <p>${escapeHtml(data.learnerProfile.summary)}</p>
      <div class="tag-list">
        ${(data.profile.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="signal-list">
        ${(data.learnerProfile.behaviorSignals || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </article>

    <article class="result-card radar-card">
      <h3>知识点掌握雷达图</h3>
      <canvas id="masteryRadar" width="360" height="300" aria-label="知识点掌握雷达图"></canvas>
      <div class="mastery-list">
        ${(data.learnerProfile.mastery || []).map((item) => `
          <div>
            <span>${escapeHtml(item.dimension)}</span>
            <strong>${Number(item.score) || 0}</strong>
          </div>
        `).join("")}
      </div>
    </article>

    <article class="result-card full package-card">
      <div class="card-heading-row">
        <div>
          <h3>${escapeHtml(data.resourcePackage.title)}</h3>
          <p>${escapeHtml(data.resourcePackage.audience)}</p>
        </div>
        <span class="score-badge">${data.resourcePackage.packageScore || data.generationLoop.qualityScore} 分</span>
      </div>
      <div class="package-layout">
        <section class="deliverable-panel">
          <h4>交付物</h4>
          ${renderSimpleList(data.resourcePackage.deliverables || [])}
          <h4>使用顺序</h4>
          ${renderSimpleList(data.resourcePackage.usageGuide || [])}
        </section>
        <div class="package-sections">
          ${(data.resourcePackage.sections || []).map((section) => `
            <section class="package-section">
              <span>${escapeHtml(section.type)}</span>
              <h4>${escapeHtml(section.title)}</h4>
              ${renderSimpleList(section.items || [])}
            </section>
          `).join("")}
        </div>
      </div>
    </article>

    <article class="result-card full">
      <h3>每日之外的阶段路径</h3>
      <ul class="item-list">
        ${(data.path || []).map((item) => `
          <li>
            <strong>${escapeHtml(item.stage)}</strong><br />
            ${escapeHtml(item.task)}<br />
            <span>产出：${escapeHtml(item.outcome)}</span>
          </li>
        `).join("")}
      </ul>
    </article>

    <article class="result-card full">
      <h3>练习题与解析</h3>
      <div class="quiz-list">
        ${quiz.map((item, index) => `
          <details class="quiz-item">
            <summary>${index + 1}. ${escapeHtml(item.question || item)}</summary>
            <p><strong>提示：</strong>${escapeHtml(item.hint || "先尝试自己作答，再展开解析。")}</p>
            <p><strong>解析：</strong>${escapeHtml(item.answer || "暂无解析。")}</p>
          </details>
        `).join("")}
      </div>
    </article>

    <article class="result-card full loop-card">
      <div class="card-heading-row">
        <div>
          <h3>多智能体生成闭环</h3>
          <p>${escapeHtml(data.generationLoop.objective)}</p>
        </div>
        <span class="score-badge">${data.generationLoop.qualityScore} 分</span>
      </div>
      <div class="loop-timeline">
        ${(data.generationLoop.stages || []).map((stage, index) => `
          <section class="loop-step">
            <span class="step-index">${index + 1}</span>
            <div>
              <strong>${escapeHtml(stage.agent)}</strong>
              <p>${escapeHtml(stage.action)}</p>
              <dl>
                <div><dt>输入</dt><dd>${escapeHtml(stage.input)}</dd></div>
                <div><dt>输出</dt><dd>${escapeHtml(stage.output)}</dd></div>
              </dl>
            </div>
          </section>
        `).join("")}
      </div>
    </article>

    <article class="result-card full">
      <h3>可直接追问的问题</h3>
      <div class="prompt-grid">
        ${(data.tutorCards || []).map((card) => `
          <button class="prompt-card" type="button" data-prompt="${escapeHtml(card.prompt)}">
            <strong>${escapeHtml(card.title)}</strong>
            <span>${escapeHtml(card.prompt)}</span>
          </button>
        `).join("")}
      </div>
    </article>
  `;
  drawRadar("masteryRadar", data.learnerProfile.mastery || []);
  resultGrid.querySelectorAll(".prompt-card").forEach((button) => {
    button.addEventListener("click", () => {
      coachQuestion.value = button.dataset.prompt;
      document.querySelector("#coach").scrollIntoView({ behavior: "smooth" });
    });
  });
}

async function askTutor() {
  const question = coachQuestion.value.trim();
  if (!question) {
    coachAnswer.textContent = "请先输入你的问题。";
    return;
  }
  coachButton.disabled = true;
  coachButton.textContent = "思考中";
  coachAnswer.textContent = "AI 导师正在结合你的学习方案回答...";

  try {
    const context = currentPlan ? JSON.stringify({
      topic: currentPlan.input?.topic,
      profile: currentPlan.learnerProfile?.summary,
      today: currentPlan.dailyPlan?.[0],
      notes: currentPlan.notes
    }) : "";
    const data = await request("/api/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, context })
    });
    coachAnswer.innerHTML = escapeHtml(data.answer).replaceAll("\n", "<br />");
    coachMode.textContent = data.mode === "llm" ? "大模型回答" : "本地提示";
  } catch (error) {
    coachAnswer.textContent = `导师回答失败：${error.message}`;
  } finally {
    coachButton.disabled = false;
    coachButton.textContent = "问 AI 导师";
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
    const score = Math.max(0, Math.min(100, Number(item.score) || 0));
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
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius
  };
}

function renderSimpleList(items) {
  return `
    <ul class="item-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `请求失败：${response.status}`);
  }
  return response.json();
}

function savePlan(plan) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

function loadSavedPlan() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
