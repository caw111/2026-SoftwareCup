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
    <article class="result-card">
      <h3>学习画像</h3>
      <p>${escapeHtml(data.profile.summary)}</p>
      <div class="tag-list">
        ${data.profile.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    </article>

    <article class="result-card">
      <h3>优先策略</h3>
      ${renderSimpleList(data.profile.priority)}
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
            <strong>${escapeHtml(item.type)}｜${escapeHtml(item.title)}</strong><br />
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
