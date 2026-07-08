const API_BASE = "http://localhost:3000";

const form = document.querySelector("#learningForm");
const resultGrid = document.querySelector("#resultGrid");
const resultMode = document.querySelector("#resultMode");
const serviceStatus = document.querySelector("#serviceStatus");
const modelStatus = document.querySelector("#modelStatus");
const healthButton = document.querySelector("#healthButton");
const agentList = document.querySelector("#agentList");
const statusDot = document.querySelector(".status-dot");

healthButton.addEventListener("click", checkHealth);
form.addEventListener("submit", generatePlan);

loadAgents();
checkHealth();

async function checkHealth() {
  try {
    const data = await request("/api/health");
    serviceStatus.textContent = "后端已连接";
    modelStatus.textContent = data.llmEnabled ? "已启用大模型接口" : "本地规则模式，可离线演示";
    statusDot.classList.add("ok");
  } catch {
    serviceStatus.textContent = "后端未连接";
    modelStatus.textContent = "请先运行 npm run dev";
    statusDot.classList.remove("ok");
  }
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
  submitButton.textContent = "智能体协作生成中";
  resultMode.textContent = "生成中";

  const payload = Object.fromEntries(new FormData(form).entries());

  try {
    const data = await request("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    renderResult(data);
    resultMode.textContent = data.mode === "llm" ? "大模型增强结果" : "本地多智能体结果";
  } catch (error) {
    resultGrid.className = "result-grid empty-state";
    resultGrid.innerHTML = `<p class="warning">生成失败：${escapeHtml(error.message)}</p>`;
    resultMode.textContent = "生成失败";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "生成个性化学习资源";
  }
}

function renderResult(data) {
  resultGrid.className = "result-grid";
  resultGrid.innerHTML = `
    <article class="result-card profile-card">
      <h3>动态学习者画像</h3>
      <p>${escapeHtml(data.learnerProfile.summary)}</p>
      <div class="tag-list">
        ${data.profile.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="signal-list">
        ${data.learnerProfile.behaviorSignals.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </article>

    <article class="result-card radar-card">
      <h3>知识点掌握雷达图</h3>
      <canvas id="masteryRadar" width="360" height="300" aria-label="知识点掌握雷达图"></canvas>
      <div class="mastery-list">
        ${data.learnerProfile.mastery.map((item) => `
          <div>
            <span>${escapeHtml(item.dimension)}</span>
            <strong>${item.score}</strong>
          </div>
        `).join("")}
      </div>
    </article>

    <article class="result-card">
      <h3>优先策略</h3>
      ${renderSimpleList(data.profile.priority)}
    </article>

    <article class="result-card full loop-card">
      <div class="card-heading-row">
        <div>
          <h3>多智能体资源生成闭环</h3>
          <p>${escapeHtml(data.generationLoop.objective)}</p>
        </div>
        <span class="score-badge">${data.generationLoop.qualityScore} 分</span>
      </div>
      <div class="loop-timeline">
        ${data.generationLoop.stages.map((stage, index) => `
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
      <div class="review-grid">
        ${data.generationLoop.review.checks.map((check) => `
          <div class="review-item ${check.passed ? "passed" : "pending"}">
            <strong>${check.passed ? "通过" : "待修正"}：${escapeHtml(check.label)}</strong>
            <p>${escapeHtml(check.detail)}</p>
          </div>
        `).join("")}
      </div>
    </article>

    <article class="result-card full">
      <h3>个性化学习路径</h3>
      <ul class="item-list">
        ${data.path.map((item) => `
          <li>
            <strong>${escapeHtml(item.stage)}</strong><br />
            ${escapeHtml(item.task)}<br />
            <span>预期产出：${escapeHtml(item.outcome)}</span>
          </li>
        `).join("")}
      </ul>
    </article>

    <article class="result-card full">
      <h3>生成资源</h3>
      <ul class="item-list">
        ${data.resources.map((item) => `
          <li>
            <strong>${escapeHtml(item.type)}：${escapeHtml(item.title)}</strong><br />
            ${escapeHtml(item.content)}
          </li>
        `).join("")}
      </ul>
    </article>

    <article class="result-card">
      <h3>测评题目</h3>
      ${renderSimpleList(data.assessment.quiz)}
    </article>

    <article class="result-card">
      <h3>反馈规则</h3>
      ${renderSimpleList([...data.assessment.rubric, ...data.assessment.nextActions])}
    </article>

    ${data.llmOptimization ? `
      <article class="result-card full">
        <h3>大模型优化建议</h3>
        <p>${escapeHtml(data.llmOptimization).replaceAll("\n", "<br />")}</p>
      </article>
    ` : ""}
  `;
  drawRadar("masteryRadar", data.learnerProfile.mastery);
}

function drawRadar(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data?.length) return;

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
    const point = radarPoint(centerX, centerY, radius * (item.score / 100), step, index);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(37, 99, 235, 0.18)";
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  data.forEach((item, index) => {
    const point = radarPoint(centerX, centerY, radius * (item.score / 100), step, index);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#0f766e";
    ctx.fill();
  });
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
