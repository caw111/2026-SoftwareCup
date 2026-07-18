// The frontend server proxies /api to the backend. Keeping requests same-origin
// lets desktop builds select free ports automatically and avoids CORS issues.
const API_BASE = "";
const STORAGE_KEY = "software-cup-learning-workspace-v2";

const state = loadState();
if (state.quiz.some((question) => question.type === "choice" && Number(question.answerDistributionVersion || 0) < 2)) {
  state.quiz = [];
  state.quizResults = {};
}
let activeView = location.hash.replace("#", "") || "home";
let flowTimer = null;
let persistTimer = null;
let examTimer = null;
let examSubmitting = false;
let deleteConfirmationResolver = null;
let progressResetConfirmationResolver = null;
const COURSE_MODES = [
  "daily",
  "calendar",
  "path-revisions",
  "notes",
  "diagnostic",
  "knowledge",
  "remediation",
  "practice",
  "mistakes",
  "exam",
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
  profileMessageForm: document.querySelector("#profileMessageForm"),
  profileMessageInput: document.querySelector("#profileMessageInput"),
  profileMessageButton: document.querySelector("#profileMessageButton"),
  profileMessages: document.querySelector("#profileMessages"),
  profileSuggestions: document.querySelector("#profileSuggestions"),
  profileAgentMode: document.querySelector("#profileAgentMode"),
  profileAgentNotice: document.querySelector("#profileAgentNotice"),
  profileCompleteness: document.querySelector("#profileCompleteness"),
  profileCompletenessMeter: document.querySelector("#profileCompletenessMeter"),
  profileReadyState: document.querySelector("#profileReadyState"),
  profileSummary: document.querySelector("#profileSummary"),
  profileFieldChecklist: document.querySelector("#profileFieldChecklist"),
  profileCourseSummary: document.querySelector("#profileCourseSummary"),
  resetProfileInterview: document.querySelector("#resetProfileInterview"),
  sourceFileInput: document.querySelector("#sourceFileInput"),
  sourceDropzone: document.querySelector("#sourceDropzone"),
  sourceUploadStatus: document.querySelector("#sourceUploadStatus"),
  sourceLibrary: document.querySelector("#sourceLibrary"),
  sourceSelectionSummary: document.querySelector("#sourceSelectionSummary"),
  sourceBindButton: document.querySelector("#sourceBindButton"),
  sourceSearchQuery: document.querySelector("#sourceSearchQuery"),
  sourceSearchButton: document.querySelector("#sourceSearchButton"),
  sourceSearchResults: document.querySelector("#sourceSearchResults"),
  resultMode: document.querySelector("#resultMode"),
  dailyPanel: document.querySelector("#dailyPanel"),
  progressSummary: document.querySelector("#progressSummary"),
  pathRevisionPanel: document.querySelector("#pathRevisionPanel"),
  pathRevisionMode: document.querySelector("#pathRevisionMode"),
  notesPanel: document.querySelector("#notesPanel"),
  notesMode: document.querySelector("#notesMode"),
  serviceStatus: document.querySelector("#serviceStatus"),
  modelStatus: document.querySelector("#modelStatus"),
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
  calendarPanel: document.querySelector("#calendarPanel"),
  calendarMode: document.querySelector("#calendarMode"),
  knowledgePanel: document.querySelector("#knowledgePanel"),
  masteryMode: document.querySelector("#masteryMode"),
  diagnosticPanel: document.querySelector("#diagnosticPanel"),
  diagnosticMode: document.querySelector("#diagnosticMode"),
  remediationPanel: document.querySelector("#remediationPanel"),
  remediationMode: document.querySelector("#remediationMode"),
  practicePanel: document.querySelector("#practicePanel"),
  judgeStatus: document.querySelector("#judgeStatus"),
  governancePanel: document.querySelector("#governancePanel"),
  governanceMode: document.querySelector("#governanceMode"),
  mistakePanel: document.querySelector("#mistakePanel"),
  mistakeMode: document.querySelector("#mistakeMode"),
  reportPanel: document.querySelector("#reportPanel"),
  reportMode: document.querySelector("#reportMode"),
  examPanel: document.querySelector("#examPanel"),
  examMode: document.querySelector("#examMode"),
  settingsPanel: document.querySelector("#settingsPanel"),
  settingsMode: document.querySelector("#settingsMode"),
  tutorMode: document.querySelector("#tutorMode"),
  hintLevel: document.querySelector("#hintLevel"),
  confirmDeleteDialog: document.querySelector("#confirmDeleteDialog"),
  confirmDeleteCourseName: document.querySelector("#confirmDeleteCourseName"),
  cancelDeleteButton: document.querySelector("#cancelDeleteButton"),
  confirmDeleteButton: document.querySelector("#confirmDeleteButton"),
  confirmResetProgressDialog: document.querySelector("#confirmResetProgressDialog"),
  confirmResetProgressCourseName: document.querySelector("#confirmResetProgressCourseName"),
  cancelResetProgressButton: document.querySelector("#cancelResetProgressButton"),
  confirmResetProgressButton: document.querySelector("#confirmResetProgressButton")
};

els.llmTestButton.addEventListener("click", testLargeModel);
els.form.addEventListener("submit", generatePlan);
els.form.addEventListener("input", syncProfileDraftFromForm);
els.profileMessageForm.addEventListener("submit", submitProfileMessage);
els.resetProfileInterview.addEventListener("click", resetProfileInterview);
els.sourceFileInput.addEventListener("change", () => uploadCourseFiles([...els.sourceFileInput.files]));
els.sourceDropzone.addEventListener("dragover", handleSourceDragOver);
els.sourceDropzone.addEventListener("dragleave", handleSourceDragLeave);
els.sourceDropzone.addEventListener("drop", handleSourceDrop);
els.sourceSearchButton.addEventListener("click", askSelectedSources);
els.sourceBindButton.addEventListener("click", bindSourcesToCurrentPlan);
els.coachButton.addEventListener("click", askTutor);
els.practicePanel.addEventListener("keydown", handleCodeTextareaKeydown, true);
els.cancelDeleteButton.addEventListener("click", () => closeDeleteConfirmation(false));
els.confirmDeleteButton.addEventListener("click", () => closeDeleteConfirmation(true));
els.confirmDeleteDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDeleteConfirmation(false);
});
els.cancelResetProgressButton.addEventListener("click", () => closeResetProgressConfirmation(false));
els.confirmResetProgressButton.addEventListener("click", () => closeResetProgressConfirmation(true));
els.confirmResetProgressDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeResetProgressConfirmation(false);
});
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
    syncProfileDraftFromForm();
    els.topicInput.focus();
  });
});

boot();

function boot() {
  setView(activeView, { replace: true });
  initializeProfileInterview();
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

async function initializeProfileInterview() {
  if (state.profileInterview?.messages?.length) {
    try {
      const session = await request("/api/profile/interview");
      state.profileInterview = {
        ...state.profileInterview,
        mode: session.mode,
        model: session.model,
        llm: session.llm,
        warning: session.warning
      };
      saveState();
    } catch {
      state.profileInterview.mode = "frontend-fallback";
      state.profileInterview.warning = "暂时无法连接画像服务，请确认后端已经启动。";
    }
    renderProfileInterview();
    return;
  }
  els.profileMessages.innerHTML = `<div class="profile-message">正在准备画像访谈...</div>`;
  try {
    state.profileInterview = await request("/api/profile/interview");
    saveState();
    renderProfileInterview();
  } catch {
    state.profileInterview = createLocalProfileInterview();
    saveState();
    renderProfileInterview();
  }
}

async function submitProfileMessage(event) {
  event.preventDefault();
  const message = els.profileMessageInput.value.trim();
  if (!message) {
    els.profileMessageInput.focus();
    return;
  }
  const current = state.profileInterview || createLocalProfileInterview();
  els.profileMessageButton.disabled = true;
  els.profileMessageButton.setAttribute("aria-busy", "true");
  els.profileMessageInput.disabled = true;
  const optimistic = {
    ...current,
    mode: "llm-pending",
    warning: null,
    messages: [
      ...(current.messages || []),
      { role: "student", content: message, at: new Date().toISOString() },
      { role: "assistant", content: "画像智能体正在结合对话上下文思考...", at: new Date().toISOString(), pending: true }
    ]
  };
  state.profileInterview = optimistic;
  renderProfileInterview();

  try {
    const result = await request("/api/profile/interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        draft: current.draft || {},
        messages: current.messages || []
      })
    });
    state.profileInterview = result;
    els.profileMessageInput.value = "";
    applyProfileDraftToForm(result.draft || {});
    saveState();
    renderProfileInterview();
  } catch (error) {
    state.profileInterview = {
      ...current,
      messages: [
        ...(current.messages || []),
        { role: "student", content: message, at: new Date().toISOString() },
        { role: "assistant", content: `暂时无法分析这段信息：${error.message}。你可以在下方精调信息中直接修改。`, at: new Date().toISOString() }
      ]
    };
    saveState();
    renderProfileInterview();
  } finally {
    els.profileMessageButton.disabled = false;
    els.profileMessageButton.removeAttribute("aria-busy");
    els.profileMessageInput.disabled = false;
    els.profileMessageInput.focus();
  }
}

async function resetProfileInterview() {
  const previous = state.profileInterview;
  els.resetProfileInterview.disabled = true;
  try {
    state.profileInterview = await request("/api/profile/interview");
  } catch {
    state.profileInterview = createLocalProfileInterview();
  } finally {
    els.resetProfileInterview.disabled = false;
  }
  if (previous?.draft?.topic) els.topicInput.value = previous.draft.topic;
  saveState();
  renderProfileInterview();
  els.profileMessageInput.focus();
}

function renderProfileInterview() {
  const interview = state.profileInterview || createLocalProfileInterview();
  const modelName = interview.model || interview.llm?.model;
  const modePresentation = {
    llm: { text: `LLM${modelName ? ` · ${modelName}` : " 对话"}`, className: "ok" },
    "llm-ready": { text: `LLM${modelName ? ` · ${modelName}` : " 已连接"}`, className: "ok" },
    "llm-pending": { text: "LLM 思考中", className: "thinking" },
    "local-fallback": { text: "本地降级", className: "warning" },
    "frontend-fallback": { text: "连接异常", className: "warning" }
  }[interview.mode] || { text: "LLM 待命", className: "" };
  els.profileAgentMode.textContent = modePresentation.text;
  els.profileAgentMode.classList.toggle("ok", modePresentation.className === "ok");
  els.profileAgentMode.classList.toggle("thinking", modePresentation.className === "thinking");
  els.profileAgentMode.classList.toggle("warning", modePresentation.className === "warning");
  els.profileAgentNotice.hidden = !interview.warning;
  els.profileAgentNotice.textContent = interview.warning || "";
  const messages = (interview.messages || []).filter((item) => item?.content);
  els.profileMessages.innerHTML = messages.map((message) => `
    <div class="profile-message ${message.role === "student" ? "student" : "assistant"} ${message.pending ? "pending" : ""}">
      ${escapeHtml(message.content)}
      <small>${message.role === "student" ? "你" : "画像智能体"} · ${profileMessageTime(message.at)}</small>
    </div>
  `).join("") || `<div class="profile-message">先介绍一下你的学习目标，我会逐步补齐画像。</div>`;
  els.profileMessages.scrollTop = els.profileMessages.scrollHeight;

  const suggestions = interview.suggestions || [];
  els.profileSuggestions.innerHTML = suggestions.map((suggestion) => (
    `<button type="button" data-profile-suggestion="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`
  )).join("");
  els.profileSuggestions.querySelectorAll("[data-profile-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      els.profileMessageInput.value = button.dataset.profileSuggestion;
      els.profileMessageForm.requestSubmit();
    });
  });

  const completeness = interview.completeness || profileCompletenessFromDraft(interview.draft || {});
  els.profileCompleteness.textContent = `${Number(completeness.percent || 0)}%`;
  els.profileCompletenessMeter.value = Number(completeness.percent || 0);
  els.profileReadyState.textContent = interview.ready ? "画像可用" : completeness.percent >= 50 ? "继续补充" : "正在了解你";
  els.profileReadyState.classList.toggle("ok", Boolean(interview.ready));
  els.profileSummary.textContent = interview.profilePreview?.summary || "完成几轮简短对话后，这里会形成带置信度和证据的初始画像。";
  els.profileFieldChecklist.innerHTML = (completeness.fields || []).map((field) => `
    <span class="${field.completed ? "complete" : ""}" title="置信度 ${Math.round(Number(field.confidence || 0) * 100)}%">
      ${escapeHtml(field.label)}${field.completed ? ` · ${Math.round(Number(field.confidence || 0) * 100)}%` : " · 待补充"}
    </span>
  `).join("");
  const draft = interview.draft || {};
  els.profileCourseSummary.textContent = draft.topic
    ? `${draft.topic} · ${draft.level || "待校准基础"} · ${draft.duration || "待确认周期"} · ${draft.style || "自适应方式"}`
    : "画像完成后可在这里确认课程";
  const dimensions = interview.profilePreview?.dimensions || defaultProfileDimensions();
  drawRadar("profileRadar", dimensions);
}

function syncProfileDraftFromForm() {
  const interview = state.profileInterview || createLocalProfileInterview();
  const values = Object.fromEntries(new FormData(els.form).entries());
  const draft = { ...(interview.draft || {}), confidence: { ...(interview.draft?.confidence || {}) } };
  ["topic", "major", "goal", "level", "duration", "dailyMinutes", "style", "weaknesses", "learningHistory"].forEach((field) => {
    if (values[field]) {
      draft[field] = values[field];
      draft.confidence[field] = 1;
    }
  });
  state.profileInterview = {
    ...interview,
    draft,
    completeness: profileCompletenessFromDraft(draft),
    ready: Boolean(draft.topic && draft.goal),
    profilePreview: {
      ...(interview.profilePreview || {}),
      summary: `${draft.major || "当前学习者"}计划学习${draft.topic || "待确认主题"}，课程将优先围绕${draft.weaknesses || "诊断结果"}展开。`
    }
  };
  saveState();
  renderProfileInterview();
}

function applyProfileDraftToForm(draft) {
  Object.entries(draft || {}).forEach(([name, value]) => {
    if (name === "confidence" || !value) return;
    const field = els.form.elements.namedItem(name);
    if (!field) return;
    if (field.tagName === "SELECT" && ![...field.options].some((option) => option.value === value)) {
      field.add(new Option(value, value));
    }
    field.value = value;
  });
}

function profileCompletenessFromDraft(draft) {
  const definitions = [
    ["topic", "学习主题", 20],
    ["major", "专业背景", 10],
    ["goal", "学习目标", 16],
    ["level", "当前基础", 12],
    ["duration", "学习周期", 10],
    ["dailyMinutes", "每日时间", 10],
    ["style", "学习偏好", 10],
    ["weaknesses", "薄弱点", 12]
  ];
  const fields = definitions.map(([field, label]) => ({
    field,
    label,
    completed: Boolean(draft?.[field]),
    confidence: Number(draft?.confidence?.[field] || (draft?.[field] ? 0.7 : 0))
  }));
  return {
    percent: definitions.reduce((sum, [field, , weight]) => sum + (draft?.[field] ? weight : 0), 0),
    fields,
    completed: fields.filter((item) => item.completed).map((item) => item.field),
    missing: fields.filter((item) => !item.completed).map((item) => item.field)
  };
}

function createLocalProfileInterview() {
  const draft = {};
  return {
    draft,
    messages: [{ role: "assistant", content: "你好，我是学习画像智能体。你最想系统学习的课程或主题是什么？", at: new Date().toISOString() }],
    completeness: profileCompletenessFromDraft(draft),
    profilePreview: { dimensions: defaultProfileDimensions(), summary: "当前画像尚未校准，请先描述你的学习需求。" },
    suggestions: ["机器学习基础", "数据结构与算法", "操作系统"],
    ready: false,
    mode: "frontend-fallback"
  };
}

function defaultProfileDimensions() {
  return ["先修基础", "概念理解", "方法迁移", "实践应用", "表达复盘", "学习自驱"]
    .map((dimension) => ({ dimension, score: 42 }));
}

function profileMessageTime(value) {
  const date = Number.isNaN(Date.parse(value)) ? new Date() : new Date(value);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

async function loadKnowledgeSources() {
  if (!state.databaseReady) {
    renderSourceLibrary();
    return;
  }
  try {
    const data = await request("/api/sources");
    state.knowledgeSources = data.sources || [];
    const available = new Set(state.knowledgeSources
      .filter((source) => source.status === "ready")
      .map((source) => source.id));
    state.selectedSourceIds = (state.selectedSourceIds || []).filter((id) => available.has(id));
    saveState();
    renderSourceLibrary();
  } catch (error) {
    els.sourceUploadStatus.textContent = `资料库加载失败：${error.message}`;
    els.sourceUploadStatus.className = "source-upload-status error";
    renderSourceLibrary();
  }
}

async function refreshLearningActivityForCurrentPlan() {
  const plan = getCurrentPlan();
  if (!state.databaseReady || !plan) {
    renderLearningCalendar();
    return;
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const data = await request(`/api/activity/summary?planId=${encodeURIComponent(plan.id)}&tz=${encodeURIComponent(timeZone)}`);
  state.activitySummary = data;
  saveState();
  renderCourseChrome();
  renderLearningCalendar();
}

function renderSourceLibrary() {
  const sources = state.knowledgeSources || [];
  const selected = new Set(state.selectedSourceIds || []);
  const readyCount = sources.filter((source) => source.status === "ready").length;
  els.sourceSelectionSummary.textContent = selected.size
    ? `已选 ${selected.size} / ${readyCount} 份`
    : readyCount ? `${readyCount} 份可用 · 未选择` : "未选择资料";
  els.sourceSelectionSummary.classList.toggle("ok", selected.size > 0);
  const plan = getCurrentPlan();
  const boundIds = new Set(plan?.data?.input?.knowledgeSourceIds || []);
  const bindingChanged = plan && (
    boundIds.size !== selected.size || [...boundIds].some((id) => !selected.has(id))
  );
  els.sourceBindButton.hidden = !state.databaseReady || !plan;
  els.sourceBindButton.disabled = !bindingChanged;
  els.sourceBindButton.textContent = bindingChanged ? "应用到当前课程" : "当前课程已同步";

  if (!sources.length) {
    els.sourceLibrary.className = "source-library empty-state";
    els.sourceLibrary.innerHTML = `<p>${state.databaseReady
      ? "还没有课程资料。上传后会自动解析并显示可引用片段数量。"
      : "资料上传需要数据库服务；当前仍可使用原有的无资料课程生成。"}</p>`;
    return;
  }

  els.sourceLibrary.className = "source-library";
  els.sourceLibrary.innerHTML = sources.map((source) => {
    const ready = source.status === "ready";
    const statusLabel = ready ? "可阅读" : source.status === "failed" ? "解析失败" : "解析中";
    return `
      <article class="source-item ${source.status}">
        <label class="source-select-control" title="${ready ? "用于课程生成和导师问答" : "资料解析完成后才能选择"}">
          <input type="checkbox" data-source-select="${escapeHtml(source.id)}"
            ${selected.has(source.id) ? "checked" : ""} ${ready ? "" : "disabled"} />
          <span class="source-file-icon">${escapeHtml(source.extension?.slice(1).toUpperCase() || "DOC")}</span>
        </label>
        <div class="source-item-body">
          <strong title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</strong>
          <div class="source-meta">
            <span class="source-state ${source.status}">${statusLabel}</span>
            <span>${formatFileSize(source.byteSize)}</span>
            ${ready ? `<span>${Number(source.charCount || 0).toLocaleString("zh-CN")} 字符</span><span>${Number(source.chunkCount || 0)} 个引用片段</span>` : ""}
          </div>
          ${source.errorMessage ? `<small class="source-error">${escapeHtml(source.errorMessage)}</small>` : ""}
        </div>
        <button class="source-remove-button" type="button" data-source-remove="${escapeHtml(source.id)}" aria-label="移除 ${escapeHtml(source.name)}">移除</button>
      </article>
    `;
  }).join("");

  els.sourceLibrary.querySelectorAll("[data-source-select]").forEach((input) => {
    input.addEventListener("change", () => {
      const ids = new Set(state.selectedSourceIds || []);
      if (input.checked) ids.add(input.dataset.sourceSelect);
      else ids.delete(input.dataset.sourceSelect);
      state.selectedSourceIds = [...ids];
      saveState();
      renderSourceLibrary();
    });
  });
  els.sourceLibrary.querySelectorAll("[data-source-remove]").forEach((button) => {
    button.addEventListener("click", () => requestSourceRemoval(button));
  });
}

async function uploadCourseFiles(files) {
  if (!files.length) return;
  if (!state.databaseReady) {
    els.sourceUploadStatus.textContent = "数据库尚未连接，暂时不能保存课程资料。";
    els.sourceUploadStatus.className = "source-upload-status error";
    return;
  }
  const selectedFiles = files.slice(0, 8);
  els.sourceFileInput.disabled = true;
  els.sourceDropzone.classList.add("uploading");
  let completed = 0;
  let failed = 0;
  for (const file of selectedFiles) {
    els.sourceUploadStatus.textContent = `正在解析 ${file.name} · ${completed + failed + 1}/${selectedFiles.length}`;
    els.sourceUploadStatus.className = "source-upload-status working";
    try {
      validateSourceFileInBrowser(file);
      const data = await request("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          contentBase64: await fileToBase64(file)
        })
      });
      if (data.source?.status === "ready") {
        state.selectedSourceIds = [...new Set([...(state.selectedSourceIds || []), data.source.id])];
      }
      completed += 1;
    } catch (error) {
      failed += 1;
      els.sourceUploadStatus.textContent = `${file.name} 上传失败：${error.message}`;
      els.sourceUploadStatus.className = "source-upload-status error";
    }
  }
  await loadKnowledgeSources();
  els.sourceFileInput.value = "";
  els.sourceFileInput.disabled = false;
  els.sourceDropzone.classList.remove("uploading", "dragging");
  els.sourceUploadStatus.textContent = failed
    ? `已完成 ${completed} 份，${failed} 份失败；失败资料保留原因，可移除后重试。`
    : `已完成 ${completed} 份资料的解析、分段和索引，并自动选中。`;
  els.sourceUploadStatus.className = `source-upload-status ${failed ? "error" : "success"}`;
}

function handleSourceDragOver(event) {
  event.preventDefault();
  if (!els.sourceFileInput.disabled) els.sourceDropzone.classList.add("dragging");
}

function handleSourceDragLeave(event) {
  if (!els.sourceDropzone.contains(event.relatedTarget)) els.sourceDropzone.classList.remove("dragging");
}

function handleSourceDrop(event) {
  event.preventDefault();
  els.sourceDropzone.classList.remove("dragging");
  if (!els.sourceFileInput.disabled) uploadCourseFiles([...event.dataTransfer.files]);
}

function validateSourceFileInBrowser(file) {
  if (!/\.(pdf|docx|pptx|md|txt|csv|json)$/i.test(file.name)) {
    throw new Error("仅支持 PDF、DOCX、PPTX、Markdown、TXT、CSV 和 JSON");
  }
  if (!file.size) throw new Error("不能上传空文件");
  if (file.size > 12 * 1024 * 1024) throw new Error("单文件不能超过 12 MB");
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function requestSourceRemoval(button) {
  if (button.dataset.confirming !== "true") {
    button.dataset.confirming = "true";
    button.textContent = "确认移除";
    button.classList.add("confirming");
    setTimeout(() => {
      if (!button.isConnected) return;
      button.dataset.confirming = "false";
      button.textContent = "移除";
      button.classList.remove("confirming");
    }, 4000);
    return;
  }
  button.disabled = true;
  try {
    await request(`/api/sources/${encodeURIComponent(button.dataset.sourceRemove)}`, { method: "DELETE" });
    state.selectedSourceIds = (state.selectedSourceIds || []).filter((id) => id !== button.dataset.sourceRemove);
    await loadKnowledgeSources();
    els.sourceUploadStatus.textContent = "资料已移除，相关课程绑定也已解除。";
    els.sourceUploadStatus.className = "source-upload-status success";
  } catch (error) {
    els.sourceUploadStatus.textContent = `移除失败：${error.message}`;
    els.sourceUploadStatus.className = "source-upload-status error";
    button.disabled = false;
  }
}

async function askSelectedSources() {
  const query = els.sourceSearchQuery.value.trim();
  const sourceIds = state.selectedSourceIds || [];
  if (!sourceIds.length || !query) {
    els.sourceSearchResults.className = "rag-search-results empty-state";
    els.sourceSearchResults.innerHTML = `<p>${sourceIds.length ? "请先输入想验证的问题。" : "请先从左侧勾选至少一份可用资料。"}</p>`;
    return;
  }
  els.sourceSearchButton.disabled = true;
  els.sourceSearchButton.textContent = "全文阅读中";
  els.sourceSearchResults.className = "rag-search-results loading";
  els.sourceSearchResults.innerHTML = "<p>正在读取所选文件的全部解析内容，并提交给大模型生成带引用的回答…</p>";
  try {
    const data = await request("/api/sources/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, sourceIds })
    });
    renderSourceAnswer(data);
  } catch (error) {
    els.sourceSearchResults.className = "rag-search-results empty-state";
    els.sourceSearchResults.innerHTML = `<p>资料全文问答失败：${escapeHtml(error.message)}</p>`;
  } finally {
    els.sourceSearchButton.disabled = false;
    els.sourceSearchButton.textContent = "让 LLM 阅读并回答";
  }
}

function renderSourceAnswer(data) {
  const citations = data?.citations || [];
  if (!citations.length && !data?.answer) {
    els.sourceSearchResults.className = "rag-search-results empty-state";
    els.sourceSearchResults.innerHTML = "<p>所选资料没有可供模型阅读的解析内容。系统不会伪造引用，请重新上传或解析资料。</p>";
    return;
  }
  const modeLabel = data.mode === "llm-full-context"
    ? `LLM 全文问答${data.model ? ` · ${data.model}` : ""}`
    : data.mode === "no-content" ? "资料内容为空" : "抽取式降级";
  const coverageLabel = { full: "证据充分", partial: "部分覆盖", insufficient: "证据不足" }[data.coverage] || "待校验";
  const fullContext = data.fullContext || {};
  const pipeline = data.pipeline || {};
  const pipelineStages = [
    ["文件全文", pipeline.fullContext?.status, pipeline.fullContext?.durationMs],
    ["答案生成", pipeline.generation?.status, pipeline.generation?.durationMs],
    ["引用校验", pipeline.citationValidation?.status, null]
  ];
  els.sourceSearchResults.className = "rag-search-results";
  els.sourceSearchResults.innerHTML = `
    <article class="rag-answer-card ${data.llmUsed ? "llm" : "fallback"}">
      <div class="rag-answer-head">
        <div>
          <span class="status-pill ${data.llmUsed ? "ok" : ""}">${escapeHtml(modeLabel)}</span>
          <span class="status-pill">${escapeHtml(coverageLabel)}</span>
        </div>
        <small>服务端 LLM ${Number(data.llmCalls || 0)} 次 · 已读 ${Number(fullContext.sourceCount || 0)} 个文件 / ${Number(fullContext.loadedChunks || 0)} 个内容块 / ${Number(fullContext.fullContextChars || 0).toLocaleString("zh-CN")} 字 · 实际引用 ${citations.length} 个${data.traceId ? ` · Trace ${escapeHtml(data.traceId.slice(0, 8))}` : ""}</small>
      </div>
      ${data.warning ? `<p class="rag-answer-warning">${escapeHtml(data.warning)}</p>` : ""}
      ${pipelineStages.some(([, status]) => status) ? `
        <div class="rag-pipeline" aria-label="RAG 执行流水线">
          ${pipelineStages.map(([label, status, duration]) => `
            <span class="${escapeHtml(status || "pending")}"><b>${escapeHtml(label)}</b><small>${escapeHtml(ragPipelineStatusLabel(status))}${duration ? ` · ${Number(duration)}ms` : ""}</small></span>
          `).join("")}
        </div>
      ` : ""}
      <div class="rag-answer-body">${renderMarkdown(data.answer || "暂无可用回答。")}</div>
      ${data.followUpQuestions?.length ? `
        <div class="rag-followups">
          <strong>继续追问</strong>
          ${data.followUpQuestions.map((question) => `<button type="button" data-rag-followup="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join("")}
        </div>
      ` : ""}
    </article>
    ${citations.length ? `
      <section class="rag-used-citations">
        <div><strong>模型实际使用的资料证据</strong><small>${escapeHtml((data.usedCitationIds || []).join(" · "))}</small></div>
        <div class="course-citation-grid">${citations.map(renderCitationCard).join("")}</div>
      </section>
    ` : ""}
  `;
  els.sourceSearchResults.querySelectorAll("[data-rag-followup]").forEach((button) => {
    button.addEventListener("click", () => {
      els.sourceSearchQuery.value = button.dataset.ragFollowup;
      askSelectedSources();
    });
  });
}

function ragPipelineStatusLabel(status) {
  return {
    loaded: "已完整读取",
    llm: "LLM 已调用",
    passed: "校验通过",
    skipped: "未执行",
    "not-applicable": "无需校验",
    "extractive-fallback": "抽取式降级"
  }[status] || "等待执行";
}

function renderCitationCard(citation) {
  return `
    <article class="citation-card">
      <div><span class="citation-marker">${escapeHtml(citation.id || "S")}</span><strong>${escapeHtml(citation.title || "课程资料")}</strong></div>
      <small>${escapeHtml(citation.locator || citation.sectionTitle || "原文片段")}</small>
      <p>${escapeHtml(citation.quote || "")}</p>
    </article>
  `;
}

async function bindSourcesToCurrentPlan() {
  const plan = getCurrentPlan();
  if (!plan || !state.databaseReady) return;
  els.sourceBindButton.disabled = true;
  els.sourceBindButton.textContent = "同步中";
  try {
    await request(`/api/plans/${encodeURIComponent(plan.id)}/sources`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceIds: state.selectedSourceIds || [] })
    });
    applyDatabaseState(await request("/api/workspace"));
    await loadKnowledgeSources();
    els.sourceUploadStatus.textContent = "当前课程的资料绑定已更新；后续课程生成和导师问答会读取所选资料全文。";
    els.sourceUploadStatus.className = "source-upload-status success";
  } catch (error) {
    els.sourceUploadStatus.textContent = `课程绑定失败：${error.message}`;
    els.sourceUploadStatus.className = "source-upload-status error";
    renderSourceLibrary();
  }
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
    const appState = await request("/api/app-state");
    applyPersistentAppState(appState?.state);
    applyDatabaseState(databaseState);
    state.databaseReady = true;
    await loadKnowledgeSources();
    await refreshPathRevisionsForCurrentPlan();
    await refreshLearningActivityForCurrentPlan();
  } catch {
    state.databaseReady = false;
    renderSourceLibrary();
  }
}

function applyPersistentAppState(saved) {
  if (!saved || typeof saved !== "object") return;
  for (const key of [
    "tutorHistory",
    "settings",
    "behaviorEvents",
    "exam",
    "mistakeFilters",
    "lastQuizOptions"
  ]) {
    if (Object.hasOwn(saved, key)) state[key] = saved[key];
  }
}

function applyDatabaseState(databaseState) {
  state.plans = databaseState?.plans || [];
  state.currentPlanId = databaseState?.currentPlanId || state.plans[0]?.id || null;
  state.quiz = databaseState?.quiz || [];
  state.quizResults = databaseState?.quizResults || {};
  if (state.quiz.some((question) => question.type === "choice" && Number(question.answerDistributionVersion || 0) < 2)) {
    state.quiz = [];
    state.quizResults = {};
  }
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
    const selected = link.dataset.view === activeView || Boolean(linkGroup && linkGroup === group);
    link.classList.toggle("active", selected);
    if (link.closest(".nav-actions")) {
      if (selected) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  });
  document.body.dataset.view = shellView;
  document.body.dataset.courseMode = isCourseMode ? activeCourseMode : "";
  if (!options.replace) location.hash = activeView;
  renderCourseChrome();
  if (activeView === "calendar") refreshLearningActivityForCurrentPlan().catch(() => {});
}

function courseModeGroup(view) {
  if (view === "daily" || view === "calendar" || view === "path-revisions") return "path";
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
  const submitLabel = submitButton.textContent;
  submitButtons.forEach((button) => {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  });
  submitButton.textContent = "正在生成课程";

  const payload = Object.fromEntries(new FormData(els.form).entries());
  payload.knowledgeSourceIds = state.databaseReady ? (state.selectedSourceIds || []) : [];
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
      button.removeAttribute("aria-busy");
    });
    submitButton.textContent = submitLabel;
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
  renderSourceLibrary();
  renderCourseChrome();
  renderSavedPlans();
  renderDailyPlan();
  renderLearningCalendar();
  renderPathRevisions();
  renderNotes();
  renderDiagnostic();
  renderKnowledge();
  renderRemediation();
  renderPractice();
  renderMistakes();
  renderExam();
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
  const streak = activityStreakFor(plan);
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
  return tasks.length > 0 && tasks.every((_, index) => progress[progressId(day, index)]);
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

function activityStreakFor(plan) {
  const summary = state.activitySummary;
  if (summary?.planId === plan?.id && summary?.streak) return Number(summary.streak.current || 0);
  return learningStreak(plan);
}

function buildCurrentAdvice(plan, current, summary) {
  if (summary.percent >= 100) return "课程任务已完成，可以进入学习报告复盘整体表现。";
  const pendingRevision = pendingPathRevisionFor(plan);
  if (pendingRevision) return `有新的路径调整建议：${pendingRevision.summary}`;
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

  const sortedPlans = [...state.plans].sort((left, right) => {
    const pinDifference = Number(isPlanPinned(right)) - Number(isPlanPinned(left));
    if (pinDifference) return pinDifference;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
  const markup = sortedPlans.map(renderCourseCard).join("");
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
    <article class="plan-card ${active ? "active" : ""} ${isPlanPinned(plan) ? "pinned" : ""}">
      <div class="plan-card-cover">${escapeHtml(courseInitials(plan.title))}</div>
      <div>
        <div class="tag-list">
          <span class="tag">${escapeHtml(plan.category || "个性化课程")}</span>
          ${isPlanPinned(plan) ? `<span class="tag pinned-tag">已置顶</span>` : ""}
        </div>
        <h3>${escapeHtml(plan.title)}</h3>
        <p>${escapeHtml(description)}</p>
        <small>${formatDate(plan.createdAt)} · 进度 ${summary.done}/${summary.total} · ${summary.percent}% · ${escapeHtml(quizStatus)}</small>
      </div>
      <div class="chapter-preview">
        ${chapters.map((day) => `<span>${escapeHtml(day.title || `第 ${day.day} 章`)}</span>`).join("")}
      </div>
      <div class="plan-actions">
        <button class="ghost-button" type="button" data-open-plan="${escapeHtml(plan.id)}">${active ? "继续学习" : "进入课程"}</button>
        <button class="text-button pin-button" type="button" data-pin-plan="${escapeHtml(plan.id)}" aria-pressed="${isPlanPinned(plan)}">${isPlanPinned(plan) ? "取消置顶" : "置顶"}</button>
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
      syncProfileDraftFromForm();
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
  container.querySelectorAll("[data-pin-plan]").forEach((button) => {
    button.addEventListener("click", () => togglePlanPinned(button.dataset.pinPlan));
  });
}

function isPlanPinned(plan) {
  return Boolean(plan?.data?.ui?.pinned);
}

async function togglePlanPinned(planId) {
  const plan = state.plans.find((item) => item.id === planId);
  if (!plan) return;
  const previous = isPlanPinned(plan);
  plan.data = {
    ...plan.data,
    ui: { ...(plan.data?.ui || {}), pinned: !previous }
  };
  saveState();
  renderSavedPlans();
  if (!state.databaseReady) return;
  try {
    await request(`/api/plans/${encodeURIComponent(plan.id)}/content`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: plan.data, masteryEvidence: plan.masteryEvidence || [] })
    });
  } catch (error) {
    plan.data.ui.pinned = previous;
    saveState();
    renderSavedPlans();
    reportPersistenceError(error);
  }
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
  const activePlan = getCurrentPlan();
  state.selectedSourceIds = [...(activePlan?.data?.input?.knowledgeSourceIds || [])];
  saveState();
  renderSourceLibrary();
  await refreshPathRevisionsForCurrentPlan();
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
  const plan = state.plans.find((item) => item.id === id);
  if (!(await requestDeleteConfirmation(plan))) return;
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

function requestDeleteConfirmation(plan) {
  if (deleteConfirmationResolver) closeDeleteConfirmation(false);
  els.confirmDeleteCourseName.textContent = plan?.title || "未命名课程";
  els.confirmDeleteDialog.showModal();
  els.confirmDeleteButton.focus();
  return new Promise((resolve) => {
    deleteConfirmationResolver = resolve;
  });
}

function closeDeleteConfirmation(confirmed) {
  if (els.confirmDeleteDialog.open) els.confirmDeleteDialog.close();
  const resolve = deleteConfirmationResolver;
  deleteConfirmationResolver = null;
  resolve?.(confirmed);
}

function pathRevisionsFor(plan) {
  if (!plan) return [];
  return state.pathRevisions?.[plan.id] || plan.data?.pathRevisions || [];
}

function pendingPathRevisionFor(plan) {
  return pathRevisionsFor(plan).find((revision) => revision.status === "proposed") || null;
}

function renderPathRevisionBanner(revision) {
  const inserted = revision.diff?.insertedDays?.length || 0;
  const updated = revision.diff?.updatedDays?.length || 0;
  const shifted = revision.diff?.shiftedTasks?.length || 0;
  return `
    <section class="path-revision-banner">
      <div>
        <span class="mini-label">路径重规划建议</span>
        <strong>${escapeHtml(revision.summary || "系统检测到学习路径需要调整。")}</strong>
        <p>LLM 预计新增 ${inserted} 个学习日，调整 ${updated} 个后续学习日，顺延 ${shifted} 个未完成任务；接受前不会覆盖当前路径。</p>
      </div>
      <div class="heading-actions">
        <button class="ghost-button" type="button" data-open-path-revisions>查看对比</button>
        <button class="primary-button" type="button" data-apply-path-revision="${escapeHtml(revision.id)}">接受调整</button>
      </div>
    </section>
  `;
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
  const pendingRevision = pendingPathRevisionFor(plan);
  const displayDays = data.dailyPlan.map((day, index) => ({
    ...day,
    materials: Array.isArray(day.materials) ? day.materials : []
  }));
  els.dailyPanel.className = "learning-path";
  els.dailyPanel.innerHTML = `
    ${pendingRevision ? renderPathRevisionBanner(pendingRevision) : ""}
    <div class="timeline-list">
      ${displayDays.map((day, index) => renderDayCard(day, plan.progress || {}, index, current.index)).join("")}
    </div>
    <section class="study-notes">
      <label>
        学习笔记与错因记录
        <textarea id="studyNotes" rows="7" placeholder="支持 Markdown，例如：&#10;## 今日收获&#10;- 关键知识点&#10;&#10;## 错因&#10;1. 审题遗漏条件">${escapeHtml(plan.notes || "")}</textarea>
      </label>
      <div class="study-notes-footer">
        <p>支持 Markdown，输入内容会自动保存到“我的笔记”。</p>
        <div class="heading-actions">
          <button class="ghost-button" type="button" id="openNotesButton">查看我的笔记</button>
          <button class="text-button" type="button" id="resetProgressButton">重置进度</button>
        </div>
      </div>
    </section>
  `;

  els.dailyPanel.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", updateProgress);
  });
  els.dailyPanel.querySelector("[data-open-path-revisions]")?.addEventListener("click", () => setView("path-revisions"));
  els.dailyPanel.querySelector("[data-apply-path-revision]")?.addEventListener("click", (event) => (
    applyPathRevision(event.currentTarget.dataset.applyPathRevision)
  ));
  els.dailyPanel.querySelectorAll("[data-day-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const details = button.closest("details");
      if (details) details.open = true;
      if (button.dataset.review === "true") {
        const reviewPanel = details?.querySelector("[data-review-panel]");
        if (reviewPanel) {
          reviewPanel.hidden = !reviewPanel.hidden;
          button.textContent = reviewPanel.hidden ? "复习本节" : "收起复习";
          if (!reviewPanel.hidden) {
            reviewPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
            reviewPanel.querySelector("button, a")?.focus();
          }
        }
        return;
      }
      const firstUnchecked = details?.querySelector(".task-item input:not(:checked)");
      (firstUnchecked || details?.querySelector(".task-item input"))?.focus();
    });
  });
  els.dailyPanel.querySelectorAll("[data-generate-materials]").forEach((button) => {
    button.addEventListener("click", () => generateDailyMaterialsForDay(button));
  });
  els.dailyPanel.querySelectorAll(".review-panel [data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  els.dailyPanel.querySelector("#studyNotes").addEventListener("input", updateNotes);
  els.dailyPanel.querySelector("#openNotesButton").addEventListener("click", () => setView("notes"));
  els.dailyPanel.querySelector("#resetProgressButton").addEventListener("click", resetProgress);
  updateProgressSummary();
}

function renderNotes() {
  const plan = getCurrentPlan();
  if (!plan) {
    els.notesMode.textContent = "等待课程";
    els.notesPanel.className = "empty-state notes-empty";
    els.notesPanel.innerHTML = "<p>先生成或选择一门课程，再开始记录学习笔记。</p>";
    return;
  }

  const notes = String(plan.notes || "").trim();
  els.notesMode.textContent = notes ? `已保存 · ${notes.length} 字符` : "暂无内容";
  if (!notes) {
    els.notesPanel.className = "empty-state notes-empty";
    els.notesPanel.innerHTML = `
      <p>还没有笔记。在学习路径的“学习笔记与错因记录”中输入内容后，会自动保存到这里。</p>
      <button class="primary-button" type="button" data-edit-notes>开始写笔记</button>
    `;
  } else {
    els.notesPanel.className = "notes-board";
    els.notesPanel.innerHTML = `
      <div class="notes-preview-head">
        <div>
          <span class="mini-label">当前课程</span>
          <h3>${escapeHtml(plan.title || "未命名课程")}</h3>
        </div>
        <button class="ghost-button" type="button" data-edit-notes>编辑笔记</button>
      </div>
      <article class="notes-markdown markdown-body" aria-label="Markdown 格式学习笔记">${renderMarkdown(notes)}</article>
    `;
  }

  els.notesPanel.querySelector("[data-edit-notes]")?.addEventListener("click", openNotesEditor);
}

function renderLearningCalendar() {
  if (!els.calendarPanel || !els.calendarMode) return;
  const plan = getCurrentPlan();
  if (!plan) {
    els.calendarMode.textContent = "等待课程";
    els.calendarPanel.className = "empty-state";
    els.calendarPanel.innerHTML = "<p>先生成或选择一门课程，再查看学习日历。</p>";
    return;
  }
  const summary = state.activitySummary?.planId === plan.id ? state.activitySummary : null;
  if (!summary) {
    els.calendarMode.textContent = state.databaseReady ? "正在读取学习事件" : "需要数据库事件";
    els.calendarPanel.className = "calendar-board";
    els.calendarPanel.innerHTML = `
      <section class="result-card full">
        <h3>真实连续天数</h3>
        <p class="hint-text">${state.databaseReady
          ? "学习事件加载中。完成任务、提交测评或诊断后会按自然日统计。"
          : "当前处于本地演示模式，无法从服务端事件计算真实连续天数。连接 MySQL 后会启用真实统计。"}</p>
      </section>
    `;
    return;
  }

  const streak = summary.streak || {};
  const today = new Date().toISOString().slice(0, 10);
  els.calendarMode.textContent = `真实连续 ${Number(streak.current || 0)} 天 · 最长 ${Number(streak.longest || 0)} 天`;
  els.calendarPanel.className = "calendar-board";
  els.calendarPanel.innerHTML = `
    <section class="calendar-summary">
      <article class="result-card calendar-stat">
        <span class="mini-label">真实连续学习</span>
        <strong>${Number(streak.current || 0)} 天</strong>
        <p>${escapeHtml(streak.todayActive ? "今天已有有效学习事件。" : streak.countedThrough ? "今天尚未形成有效学习事件。" : "最近没有连续学习记录。")}</p>
      </article>
      <article class="result-card calendar-stat">
        <span class="mini-label">最长连续</span>
        <strong>${Number(streak.longest || 0)} 天</strong>
        <p>最后活跃：${escapeHtml(streak.lastActiveDate || "--")}</p>
      </article>
      <article class="result-card calendar-stat">
        <span class="mini-label">今日强度</span>
        <strong>${dailyScore(summary, today)}</strong>
        <p>强度按有效学习事件加权，单日封顶。</p>
      </article>
    </section>
    <section class="result-card full">
      <div class="calendar-head">
        <div>
          <span class="mini-label">近一年学习热力</span>
          <h3>学习热力图</h3>
        </div>
        <span class="status-pill">${escapeHtml(summary.timeZone || "UTC")}</span>
      </div>
      ${renderHeatmap(summary.heatmap || [])}
    </section>
    <section class="calendar-two-column">
      <article class="result-card">
        <h3>徽章进度</h3>
        <div class="badge-grid">
          ${(summary.badges || []).map(renderBadge).join("") || "<p class=\"hint-text\">暂无徽章规则。</p>"}
        </div>
      </article>
      <article class="result-card">
        <h3>最近学习事件</h3>
        <div class="activity-list">
          ${recentActivityEvents(summary).map((event) => `
            <div>
              <strong>${escapeHtml(eventTypeLabel(event.type))}</strong>
              <span>${escapeHtml(formatDate(event.occurredAt))}</span>
              <small>${escapeHtml(activityEventDetail(event))}</small>
            </div>
          `).join("") || "<p class=\"hint-text\">还没有服务端学习事件。</p>"}
        </div>
      </article>
    </section>
  `;
}

function renderHeatmap(heatmap) {
  const byDate = new Map(heatmap.map((item) => [item.date, item]));
  const days = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 364);
  for (let index = 0; index < 365; index += 1) {
    const key = cursor.toISOString().slice(0, 10);
    const item = byDate.get(key) || { date: key, level: 0, score: 0, eventCount: 0 };
    days.push(`<span class="heat-cell level-${Number(item.level || 0)}" title="${escapeHtml(item.date)} · 强度 ${Number(item.score || 0)} · ${Number(item.eventCount || 0)} 个事件"></span>`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return `<div class="activity-heatmap" aria-label="近一年学习热力图">${days.join("")}</div>`;
}

function renderBadge(badge) {
  return `
    <div class="badge-card ${badge.unlocked ? "unlocked" : ""}">
      <strong>${escapeHtml(badge.title)}</strong>
      <p>${escapeHtml(badge.description)}</p>
      <meter min="0" max="100" value="${Number(badge.progress || 0)}"></meter>
      <small>${Number(badge.current || 0)} / ${Number(badge.target || 0)}${badge.unlockedAt ? ` · ${escapeHtml(badge.unlockedAt.slice(0, 10))}` : ""}</small>
    </div>
  `;
}

function dailyScore(summary, dateKey) {
  const item = (summary.heatmap || []).find((day) => day.date === dateKey);
  return item ? Number(item.score || 0) : 0;
}

function recentActivityEvents(summary) {
  return (summary.calendar || [])
    .flatMap((day) => (day.events || []).map((event) => ({ ...event, date: day.date })))
    .sort((left, right) => new Date(right.occurredAt) - new Date(left.occurredAt))
    .slice(0, 12);
}

function activityEventDetail(event) {
  const payload = event.payload || {};
  if (payload.taskKey) return payload.taskKey;
  if (payload.score !== undefined && payload.maxScore !== undefined) return `${payload.score}/${payload.maxScore}`;
  if (payload.title) return payload.title;
  if (payload.mode) return tutorModeLabel(payload.mode);
  return event.effective ? "计入真实连续学习" : "学习辅助事件";
}

function eventTypeLabel(type) {
  return {
    task_completed: "完成任务",
    task_reopened: "重新打开任务",
    quiz_attempt_evaluated: "提交测评",
    diagnostic_completed: "完成诊断",
    exam_submitted: "提交考试",
    review_completed: "完成复习",
    tutor_question_asked: "导师问答",
    source_question_asked: "资料问答",
    daily_materials_generated: "生成当日资料",
    learning_report_generated: "生成学习报告",
    knowledge_graph_refined: "LLM 增强图谱"
  }[type] || behaviorLabel(type);
}

function openNotesEditor() {
  setView("daily");
  requestAnimationFrame(() => {
    const textarea = els.dailyPanel.querySelector("#studyNotes");
    textarea?.scrollIntoView({ behavior: "smooth", block: "center" });
    textarea?.focus();
  });
}

function renderDayCard(day, progress, index = 0, currentIndex = 0) {
  const tasks = day.tasks || [];
  const materials = day.materials || [];
  const complete = isDayComplete(day, progress);
  const today = index === currentIndex;
  const current = today && !complete;
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
            const id = progressId(day, taskIndex);
            return `
              <label class="task-item">
                <input type="checkbox" data-progress-id="${id}" ${progress[id] ? "checked" : ""} ${locked ? "disabled" : ""} />
                <span>${escapeHtml(task)}</span>
              </label>
            `;
          }).join("")}
        </div>
        <section class="learning-materials" aria-label="本节学习资料">
          <strong>本节学习资料</strong>
          ${materials.length
            ? `<div class="material-list">${materials.map(renderLearningMaterial).join("")}</div>
              ${today ? `<button class="ghost-button regenerate-materials-button" type="button" data-generate-materials="${day.day}">重新生成当日学习资料</button>` : ""}`
            : today
              ? `<div class="material-generation-empty">
                  <p>当日学习路径已就绪。点击后将根据今日全部知识点生成完整 Markdown 讲义、案例、练习和答案解析。</p>
                  <button class="primary-button" type="button" data-generate-materials="${day.day}">生成当日学习资料</button>
                  <p class="material-generation-status" aria-live="polite"></p>
                </div>`
              : `<p>该学习日解锁后，可生成当日完整学习资料。</p>`}
        </section>
        <p class="checkpoint">${escapeHtml(day.checkpoint || "")}</p>
        ${complete ? `
          <section class="review-panel" data-review-panel hidden>
            <strong>复习步骤</strong>
            <ol>
              <li>不看笔记，口述本节核心概念与适用场景。</li>
              <li>重做本节练习，并对照资料检查步骤和错因。</li>
              <li>用下方笔记记录仍不确定的知识点，再进入“测验与复习”复测。</li>
            </ol>
            <button class="ghost-button nav-link" type="button" data-view="practice">进入复习测验</button>
          </section>` : ""}
        <button class="primary-button timeline-action" type="button" data-day-action="${day.day}" data-review="${complete}" ${locked ? "disabled" : ""}>${actionText}</button>
      </div>
    </details>
  `;
}

async function generateDailyMaterialsForDay(button) {
  const plan = getCurrentPlan();
  const dayNumber = Number(button?.dataset.generateMaterials || 0);
  const day = plan?.data?.dailyPlan?.find((item) => Number(item.day) === dayNumber);
  if (!plan || !day) return;

  const originalText = button.textContent;
  const status = button.closest(".learning-materials")?.querySelector(".material-generation-status");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "正在生成完整资料…";
  if (status) status.textContent = "正在逐项生成讲义、案例、练习和答案解析，请保持页面打开。";

  try {
    const result = await request("/api/daily-materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: plan.id,
        input: plan.data.input || {},
        totalDays: plan.data.dailyPlan.length,
        day: {
          day: day.day,
          title: day.title,
          estimate: day.estimate,
          focus: day.focus,
          tasks: day.tasks,
          checkpoint: day.checkpoint
        }
      })
    });
    day.knowledgePoints = result.day?.knowledgePoints || [];
    day.materials = result.day?.materials || [];
    day.materialsGeneratedAt = result.day?.materialsGeneratedAt || new Date().toISOString();
    recordBehavior("daily-materials-generated", { planId: plan.id, detail: `Day ${day.day}` });
    saveState();
    await persistPlanContent(plan);
    await refreshLearningActivityForCurrentPlan();
    renderDailyPlan();
    renderReport();
  } catch (error) {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = originalText;
    if (status) status.textContent = `生成失败：${error.message}`;
  }
}

function renderLearningMaterial(material, index) {
  if (typeof material === "string") {
    return `<article class="material-card"><span>学习资料 ${index + 1}</span><p>${escapeHtml(material)}</p></article>`;
  }
  const sections = Array.isArray(material.sections) ? material.sections : [];
  const questions = Array.isArray(material.questions) ? material.questions : [];
  return `
    <article class="material-card">
      <span>${escapeHtml(material.type || `学习资料 ${index + 1}`)}</span>
      <h4>${escapeHtml(material.title || "本节资料")}</h4>
      ${material.content ? `<div class="material-markdown markdown-body">${renderMarkdown(material.content)}</div>` : ""}
      ${sections.map((section) => `
        <section class="material-section">
          <strong>${escapeHtml(section.heading || "知识点")}</strong>
          <p>${escapeHtml(section.body || "")}</p>
          ${Array.isArray(section.steps) ? `<ol>${section.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>` : ""}
        </section>
      `).join("")}
      ${questions.length ? `
        <section class="material-section practice-material">
          <strong>练习与解析</strong>
          ${questions.map((question, questionIndex) => `
            <details>
              <summary>第 ${questionIndex + 1} 题：${escapeHtml(question.prompt || "")}</summary>
              <p><b>参考解析：</b>${escapeHtml(question.answer || "")}</p>
            </details>
          `).join("")}
        </section>` : ""}
    </article>
  `;
}

function progressId(day, index) {
  if (day && typeof day === "object") {
    return day.taskKeys?.[index] || `day-${day.day}-task-${index}`;
  }
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
    ).then(() => refreshLearningActivityForCurrentPlan()).catch(reportPersistenceError);
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

function renderPathRevisions() {
  const plan = getCurrentPlan();
  if (!els.pathRevisionPanel || !els.pathRevisionMode) return;
  if (!plan) {
    els.pathRevisionPanel.className = "empty-state";
    els.pathRevisionPanel.innerHTML = "<p>先生成或选择一门课程，再查看路径变更建议。</p>";
    els.pathRevisionMode.textContent = "等待课程";
    return;
  }

  const revisions = pathRevisionsFor(plan);
  const proposed = revisions.filter((revision) => revision.status === "proposed");
  els.pathRevisionMode.textContent = proposed.length
    ? `${proposed.length} 条待处理建议`
    : revisions.length
      ? `${revisions.length} 条变更记录`
      : "暂无变更";

  if (!revisions.length) {
    els.pathRevisionPanel.className = "empty-state";
    els.pathRevisionPanel.innerHTML = `
      <p>还没有路径变更建议。LLM 会在诊断、连续错题、综合考试和进度异常后，结合当前路径提出可接受或撤销的调整方案。</p>
      <button class="ghost-button" type="button" data-evaluate-replanning>让 LLM 检查路径</button>
    `;
    els.pathRevisionPanel.querySelector("[data-evaluate-replanning]")?.addEventListener("click", () => (
      evaluatePathReplanning("manual", {}, true)
    ));
    return;
  }

  els.pathRevisionPanel.className = "path-revision-board";
  els.pathRevisionPanel.innerHTML = `
    <section class="remediation-head">
      <div>
        <strong>路径变更建议</strong>
        <p>每条建议都由 LLM 基于学习证据生成，并保留前后差异；只有点击接受后，才会事务更新未完成学习日。</p>
      </div>
      <button class="ghost-button" type="button" data-evaluate-replanning>让 LLM 重新检查</button>
    </section>
    <div class="path-revision-list">
      ${revisions.map(renderPathRevisionCard).join("")}
    </div>
  `;
  els.pathRevisionPanel.querySelector("[data-evaluate-replanning]")?.addEventListener("click", () => (
    evaluatePathReplanning("manual", {}, true)
  ));
  els.pathRevisionPanel.querySelectorAll("[data-apply-path-revision]").forEach((button) => {
    button.addEventListener("click", () => applyPathRevision(button.dataset.applyPathRevision));
  });
  els.pathRevisionPanel.querySelectorAll("[data-reject-path-revision]").forEach((button) => {
    button.addEventListener("click", () => rejectPathRevision(button.dataset.rejectPathRevision));
  });
  els.pathRevisionPanel.querySelectorAll("[data-undo-path-revision]").forEach((button) => {
    button.addEventListener("click", () => undoPathRevision(button.dataset.undoPathRevision));
  });
}

function renderPathRevisionCard(revision) {
  const insertedDays = revision.diff?.insertedDays || [];
  const shiftedTasks = revision.diff?.shiftedTasks || [];
  const updatedDays = revision.diff?.updatedDays || [];
  const evidence = revision.evidence || {};
  return `
    <article class="path-revision-card ${revision.status}">
      <div class="path-revision-head">
        <div>
          <span class="tag ${revision.status === "proposed" ? "warning-tag" : ""}">${escapeHtml(pathRevisionStatusLabel(revision.status))}</span>
          <h3>${escapeHtml(revision.summary || "路径调整建议")}</h3>
          <small>${escapeHtml(revision.createdByAgent || "路径重规划智能体")} · ${formatDate(revision.createdAt)} · 置信度 ${Number(revision.confidence || 0)}%</small>
        </div>
        <div class="heading-actions">
          ${revision.status === "proposed" ? `
            <button class="primary-button" type="button" data-apply-path-revision="${escapeHtml(revision.id)}">接受调整</button>
            <button class="text-button" type="button" data-reject-path-revision="${escapeHtml(revision.id)}">暂不采用</button>
          ` : ""}
          ${revision.status === "applied" ? `<button class="ghost-button" type="button" data-undo-path-revision="${escapeHtml(revision.id)}">撤销本次调整</button>` : ""}
        </div>
      </div>
      <div class="path-revision-evidence">
        ${renderEvidencePill("触发", triggerTypeLabel(revision.triggerType))}
        ${evidence.diagnostic ? renderEvidencePill("诊断", `${Number(evidence.diagnostic.percent || 0)}%`) : ""}
        ${evidence.recentWrong?.length ? renderEvidencePill("错题", `${evidence.recentWrong.length} 条`) : ""}
        ${evidence.overdue?.overdueDays ? renderEvidencePill("进度", `落后 ${evidence.overdue.overdueDays} 天`) : ""}
      </div>
      <div class="path-revision-diff">
        <section>
          <strong>新增学习日</strong>
          ${insertedDays.length ? insertedDays.map((day) => `
            <div class="revision-day-preview">
              <span>Day ${Number(day.day || 0)}</span>
              <b>${escapeHtml(day.title || "")}</b>
              <ul>${(day.tasks || []).map((task) => `<li>${escapeHtml(task)}</li>`).join("")}</ul>
            </div>
          `).join("") : "<p class=\"hint-text\">没有新增学习日。</p>"}
        </section>
        <section>
          <strong>顺延影响</strong>
          ${shiftedTasks.length ? `
            <div class="report-table compact">
              ${shiftedTasks.slice(0, 8).map((task) => `
                <div>
                  <span>${escapeHtml(task.content)}</span>
                  <span>Day ${Number(task.fromDay || 0)} → Day ${Number(task.toDay || 0)}</span>
                </div>
              `).join("")}
            </div>
            ${shiftedTasks.length > 8 ? `<p class="hint-text">另有 ${shiftedTasks.length - 8} 个任务随路径整体顺延。</p>` : ""}
          ` : "<p class=\"hint-text\">未影响原有任务顺序。</p>"}
        </section>
        <section>
          <strong>后续学习日调整</strong>
          ${updatedDays.length ? updatedDays.map((day) => `
            <div class="revision-day-preview">
              <span>Day ${Number(day.day || 0)}</span>
              <b>${escapeHtml(day.title || "")}</b>
              ${day.reason ? `<p>${escapeHtml(day.reason)}</p>` : ""}
              <ul>${(day.tasks || []).map((task) => `<li>${escapeHtml(task)}</li>`).join("")}</ul>
            </div>
          `).join("") : "<p class=\"hint-text\">没有改写后续学习日。</p>"}
        </section>
      </div>
    </article>
  `;
}

function renderEvidencePill(label, value) {
  return `<span><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`;
}

function pathRevisionStatusLabel(status) {
  return {
    proposed: "待确认",
    accepted: "已接受",
    rejected: "已忽略",
    applied: "已应用",
    undone: "已撤销",
    expired: "已过期"
  }[status] || status || "未知";
}

function triggerTypeLabel(type) {
  return {
    manual: "手动检查",
    diagnostic_completed: "诊断完成",
    quiz_attempt_evaluated: "连续错题",
    exam_submitted: "综合考试",
    task_overdue: "任务逾期",
    remediation_retest_completed: "补救复测"
  }[type] || type || "学习事件";
}

async function refreshPathRevisionsForCurrentPlan() {
  const plan = getCurrentPlan();
  if (!plan || !state.databaseReady) {
    renderPathRevisions();
    renderDailyPlan();
    return;
  }
  try {
    const data = await request(`/api/plans/${encodeURIComponent(plan.id)}/path-revisions`);
    state.pathRevisions = {
      ...(state.pathRevisions || {}),
      [plan.id]: data.revisions || []
    };
    saveState();
    renderPathRevisions();
    renderDailyPlan();
    renderCourseChrome();
  } catch (error) {
    els.pathRevisionMode.textContent = `路径变更加载失败：${error.message}`;
  }
}

async function evaluatePathReplanning(triggerType = "manual", payload = {}, force = false) {
  const plan = getCurrentPlan();
  if (!plan || !state.databaseReady) {
    if (els.pathRevisionMode) els.pathRevisionMode.textContent = "数据库模式下可用";
    return null;
  }
  if (els.pathRevisionMode) els.pathRevisionMode.textContent = "正在检查路径";
  try {
    const data = await request(`/api/plans/${encodeURIComponent(plan.id)}/replanning/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triggerType, payload, force })
    });
    state.pathRevisions = {
      ...(state.pathRevisions || {}),
      [plan.id]: data.revisions || (data.revision ? [data.revision] : pathRevisionsFor(plan))
    };
    if (data.revision) {
      recordBehavior("path-revision-proposed", { planId: plan.id, detail: data.revision.summary });
    }
    saveState();
    renderPathRevisions();
    renderDailyPlan();
    renderCourseChrome();
    if (!data.revision && data.reason && els.pathRevisionMode) {
      els.pathRevisionMode.textContent = data.reason;
    }
    return data.revision || null;
  } catch (error) {
    if (els.pathRevisionMode) els.pathRevisionMode.textContent = `检查失败：${error.message}`;
    return null;
  }
}

async function applyPathRevision(revisionId) {
  const plan = getCurrentPlan();
  if (!plan || !revisionId || !state.databaseReady) return;
  try {
    const data = await request(`/api/plans/${encodeURIComponent(plan.id)}/path-revisions/${encodeURIComponent(revisionId)}/apply`, {
      method: "POST"
    });
    if (data.workspace) applyDatabaseState(data.workspace);
    state.pathRevisions = {
      ...(state.pathRevisions || {}),
      [plan.id]: data.revisions || []
    };
    recordBehavior("path-revision-applied", { planId: plan.id, detail: data.revision?.summary || "" });
    saveState();
    renderAll();
    setView("daily");
  } catch (error) {
    if (els.pathRevisionMode) els.pathRevisionMode.textContent = `应用失败：${error.message}`;
  }
}

async function rejectPathRevision(revisionId) {
  const plan = getCurrentPlan();
  if (!plan || !revisionId || !state.databaseReady) return;
  try {
    const data = await request(`/api/plans/${encodeURIComponent(plan.id)}/path-revisions/${encodeURIComponent(revisionId)}/reject`, {
      method: "POST"
    });
    state.pathRevisions = {
      ...(state.pathRevisions || {}),
      [plan.id]: data.revisions || []
    };
    recordBehavior("path-revision-rejected", { planId: plan.id, detail: revisionId });
    saveState();
    renderPathRevisions();
    renderDailyPlan();
  } catch (error) {
    if (els.pathRevisionMode) els.pathRevisionMode.textContent = `忽略失败：${error.message}`;
  }
}

async function undoPathRevision(revisionId) {
  const plan = getCurrentPlan();
  if (!plan || !revisionId || !state.databaseReady) return;
  try {
    const data = await request(`/api/plans/${encodeURIComponent(plan.id)}/path-revisions/${encodeURIComponent(revisionId)}/undo`, {
      method: "POST"
    });
    if (data.workspace) applyDatabaseState(data.workspace);
    state.pathRevisions = {
      ...(state.pathRevisions || {}),
      [plan.id]: data.revisions || []
    };
    recordBehavior("path-revision-undone", { planId: plan.id, detail: data.revision?.summary || "" });
    saveState();
    renderAll();
    setView("path-revisions");
  } catch (error) {
    if (els.pathRevisionMode) els.pathRevisionMode.textContent = `撤销失败：${error.message}`;
  }
}

function updateNotes(event) {
  const plan = getCurrentPlan();
  if (!plan) return;
  plan.notes = event.target.value;
  saveState();
  renderNotes();
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

async function resetProgress() {
  const plan = getCurrentPlan();
  if (!plan) return;
  if (!(await requestResetProgressConfirmation(plan))) return;
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

function requestResetProgressConfirmation(plan) {
  if (progressResetConfirmationResolver) closeResetProgressConfirmation(false);
  els.confirmResetProgressCourseName.textContent = plan?.title || "当前课程";
  els.confirmResetProgressDialog.showModal();
  els.confirmResetProgressButton.focus();
  return new Promise((resolve) => {
    progressResetConfirmationResolver = resolve;
  });
}

function closeResetProgressConfirmation(confirmed) {
  if (els.confirmResetProgressDialog.open) els.confirmResetProgressDialog.close();
  const resolve = progressResetConfirmationResolver;
  progressResetConfirmationResolver = null;
  resolve?.(confirmed);
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
      <div class="heading-actions">
        <button class="ghost-button" type="button" id="regenerateDiagnosticButton">重新生成课前测</button>
        ${result ? `<span class="score-badge">${result.percent}%</span>` : "<span class=\"score-badge muted\">待测</span>"}
      </div>
    </section>
    <div class="diagnostic-list">
      ${diagnostic.items.map((item, index) => renderDiagnosticItem(item, index, result)).join("")}
    </div>
    <button id="submitDiagnosticButton" class="primary-button" type="button">提交诊断并更新画像</button>
  `;
  els.diagnosticPanel.querySelector("#submitDiagnosticButton").addEventListener("click", evaluateDiagnostic);
  els.diagnosticPanel.querySelector("#regenerateDiagnosticButton").addEventListener("click", regenerateDiagnosticPretest);
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
      await evaluatePathReplanning("diagnostic_completed", {
        diagnostic: {
          percent: result.percent,
          score: result.score,
          maxScore: result.maxScore
        }
      });
      await refreshLearningActivityForCurrentPlan();
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

async function regenerateDiagnosticPretest() {
  const plan = getCurrentPlan();
  if (!plan?.data) return;
  const button = els.diagnosticPanel.querySelector("#regenerateDiagnosticButton");
  const originalText = button?.textContent || "重新生成课前测";
  if (button) {
    button.disabled = true;
    button.textContent = "LLM 生成中";
  }
  els.diagnosticMode.textContent = "正在生成 LLM 课前测";
  try {
    const data = await request("/api/diagnostic/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: plan.data })
    });
    plan.data.diagnosticPretest = data.diagnosticPretest;
    plan.data.diagnosticResult = null;
    plan.data.remediationPlan = null;
    state.diagnosticStartedAt = {
      ...(state.diagnosticStartedAt || {}),
      [plan.id]: Date.now()
    };
    recordBehavior("diagnostic-generated", { planId: plan.id, detail: "LLM 课前测" });
    saveState();
    if (state.databaseReady) {
      await request(`/api/plans/${encodeURIComponent(plan.id)}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: plan.data, masteryEvidence: plan.masteryEvidence || [] })
      });
    }
    renderDiagnostic();
    renderRemediation();
  } catch (error) {
    els.diagnosticMode.textContent = `生成失败：${error.message}`;
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
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
  const graph = currentKnowledgeGraph(plan);
  const concepts = graph.nodes || [];
  const courseSources = plan.data?.input?.knowledgeSources || [];
  const sourceCitations = plan.data?.input?.knowledgeGrounding?.citations
    || plan.data?.resourcePackage?.sourceCitations
    || [];
  const ragTrace = plan.data?.rag || {};
  const diagnosticText = plan.data?.diagnosticResult ? `，诊断 ${plan.data.diagnosticResult.percent}%` : "";
  els.masteryMode.textContent = `图谱 ${concepts.length} 节点 · 基于 ${summary.done} 项打卡、${Object.keys(state.quizResults || {}).length} 道测评${diagnosticText}`;
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
    <article class="result-card full graph-card">
      <div class="graph-toolbar">
        <div>
          <span class="mini-label">交互式图谱</span>
          <h3>知识点、先修关系与掌握证据</h3>
        </div>
        <div class="graph-controls">
          <input id="graphSearchInput" placeholder="搜索知识点" value="${escapeHtml(state.graphUi?.search || "")}" />
          <select id="graphDimensionFilter">
            <option value="all">全部维度</option>
            ${(graph.filters?.dimensions || []).map((dimension) => `<option value="${escapeHtml(dimension)}" ${state.graphUi?.dimension === dimension ? "selected" : ""}>${escapeHtml(dimension)}</option>`).join("")}
          </select>
          <select id="graphMasteryFilter">
            <option value="all" ${state.graphUi?.mastery === "all" ? "selected" : ""}>全部状态</option>
            <option value="weak" ${state.graphUi?.mastery === "weak" ? "selected" : ""}>薄弱优先</option>
            <option value="due" ${state.graphUi?.mastery === "due" ? "selected" : ""}>需要复习</option>
          </select>
          <button class="ghost-button" type="button" data-graph-zoom="out">-</button>
          <button class="ghost-button" type="button" data-graph-zoom="in">+</button>
          <button class="ghost-button" type="button" data-refine-graph>LLM 增强</button>
        </div>
      </div>
      <div class="knowledge-graph-workbench">
        <div class="knowledge-graph-canvas">
          ${renderKnowledgeGraphSvg(graph)}
        </div>
        <aside class="knowledge-node-detail">
          ${renderKnowledgeNodeDetail(selectedGraphNode(graph))}
        </aside>
      </div>
      <div class="graph-list-view">
        ${filteredGraphNodes(graph).map((node) => `
          <button type="button" data-select-graph-node="${escapeHtml(node.id)}">
            <strong>${escapeHtml(node.title)}</strong>
            <span>${escapeHtml(node.dimension)} · 掌握 ${Number(node.masteryScore || 0)}</span>
          </button>
        `).join("")}
      </div>
    </article>
    <article class="result-card full course-grounding-card">
      <div class="course-grounding-head">
        <div>
          <span class="mini-label">课程依据</span>
          <h3>课程资料与可核验引用</h3>
        </div>
        <div class="course-grounding-actions">
          ${ragTrace.enabled ? `<span class="status-pill ${ragTrace.grounded ? "ok" : ""}">${ragTrace.llmUsed ? `LLM 全文资料 · ${Number(ragTrace.usedCitationIds?.length || 0)} 个引用` : "全文资料 · 模型未使用"}</span>` : ""}
          <button class="ghost-button" type="button" data-manage-sources>管理资料</button>
        </div>
      </div>
      ${courseSources.length ? `
        <div class="bound-source-list">
          ${courseSources.map((source) => `
            <span><b>${escapeHtml(source.extension?.slice(1).toUpperCase() || "DOC")}</b>${escapeHtml(source.name)}</span>
          `).join("")}
        </div>
        <div class="course-citation-grid">
          ${sourceCitations.length
            ? sourceCitations.slice(0, 6).map(renderCitationCard).join("")
            : "<p class=\"hint-text\">资料绑定已就绪；在生成当日资料或向导师提问时会读取所选文件全文。</p>"}
        </div>
      ` : "<p class=\"hint-text\">这门课程尚未绑定自有资料，当前内容基于学习画像和系统知识生成。</p>"}
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
  els.knowledgePanel.querySelector("[data-manage-sources]")?.addEventListener("click", () => {
    state.selectedSourceIds = [...(plan.data?.input?.knowledgeSourceIds || [])];
    saveState();
    renderSourceLibrary();
    setView("home");
    document.querySelector("#courseSourceTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  bindKnowledgeGraphControls(plan, graph);
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

function currentKnowledgeGraph(plan) {
  const serverGraph = state.graphUi?.serverGraph;
  if (serverGraph?.planId === plan.id && Array.isArray(serverGraph.nodes)) return serverGraph;
  return buildClientKnowledgeGraph(plan);
}

function buildClientKnowledgeGraph(plan) {
  const data = plan?.data || {};
  const adaptive = data.adaptiveState?.concepts || [];
  const raw = adaptive.length ? adaptive : data.knowledgeGraph?.concepts || data.learnerProfile?.mastery || [];
  const nodes = raw.map((concept, index) => {
    const id = concept.conceptId || concept.id || slugClient(`${concept.title || concept.conceptTitle || concept.dimension}-${index}`);
    const score = Number(concept.masteryScore ?? concept.score ?? 50);
    const tasks = conceptTasksFor(plan, id, concept);
    return {
      id,
      title: concept.title || concept.conceptTitle || concept.dimension || `节点 ${index + 1}`,
      dimension: concept.dimension || "综合能力",
      masteryScore: clamp(score),
      confidence: Number(concept.confidence ?? 0.35),
      status: concept.status || (score >= 82 ? "已掌握" : score >= 65 ? "巩固中" : "薄弱"),
      nextAction: concept.nextAction || concept.evidence || "完成相关任务并进行一次测评。",
      evidence: concept.evidence || "",
      reviewDueAt: concept.reviewDueAt || null,
      tasks,
      resources: conceptResourcesFor(plan, concept),
      quizzes: conceptQuizEvidenceFor(plan, id, concept),
      layout: { x: 0, y: 0 }
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  const edges = [
    ...(data.knowledgeGraph?.edges || []).map((edge) => ({
      source: edge.source,
      target: edge.target,
      relation: edge.relation || "prerequisite"
    })),
    ...nodes.flatMap((node) => (raw.find((item) => (item.conceptId || item.id) === node.id)?.prerequisites || [])
      .map((source) => ({ source, target: node.id, relation: "prerequisite" })))
  ].filter((edge, index, arr) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target
    && arr.findIndex((item) => item.source === edge.source && item.target === edge.target) === index);
  const positions = state.graphUi?.positions || {};
  const laidOut = layoutClientGraph(nodes, edges, positions);
  return {
    id: `client-${plan.id}`,
    planId: plan.id,
    topic: data.input?.topic || plan.title,
    source: "client-plan",
    nodes: laidOut,
    edges,
    filters: {
      dimensions: [...new Set(laidOut.map((node) => node.dimension).filter(Boolean))]
    }
  };
}

function layoutClientGraph(nodes, edges, positions) {
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => incoming.get(edge.target)?.push(edge.source));
  const memo = new Map();
  const levelOf = (id, stack = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return 0;
    stack.add(id);
    const level = Math.max(0, ...(incoming.get(id) || []).map((source) => levelOf(source, stack) + 1));
    stack.delete(id);
    memo.set(id, level);
    return level;
  };
  const levels = new Map(nodes.map((node) => [node.id, levelOf(node.id)]));
  const groups = new Map();
  nodes.forEach((node) => {
    const level = levels.get(node.id) || 0;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(node);
  });
  return nodes.map((node) => {
    const saved = positions[node.id];
    if (saved) return { ...node, layout: { x: Number(saved.x), y: Number(saved.y), pinned: true } };
    const level = levels.get(node.id) || 0;
    const siblings = groups.get(level) || [];
    const index = siblings.findIndex((item) => item.id === node.id);
    return { ...node, layout: { x: 120 + level * 220, y: 90 + Math.max(0, index) * 94 } };
  });
}

function filteredGraphNodes(graph) {
  const search = String(state.graphUi?.search || "").trim().toLowerCase();
  const dimension = state.graphUi?.dimension || "all";
  const mastery = state.graphUi?.mastery || "all";
  return (graph.nodes || []).filter((node) => {
    if (dimension !== "all" && node.dimension !== dimension) return false;
    if (mastery === "weak" && Number(node.masteryScore || 0) >= 70) return false;
    if (mastery === "due" && !node.reviewDueAt && Number(node.masteryScore || 0) >= 80) return false;
    if (search && !`${node.title} ${node.dimension} ${node.nextAction}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderKnowledgeGraphSvg(graph) {
  const nodes = filteredGraphNodes(graph);
  const visible = new Set(nodes.map((node) => node.id));
  const edges = (graph.edges || []).filter((edge) => visible.has(edge.source) && visible.has(edge.target));
  const zoom = Number(state.graphUi?.zoom || 1);
  const selectedId = selectedGraphNode(graph)?.id;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const width = Math.max(720, ...nodes.map((node) => Number(node.layout?.x || 0) + 190));
  const height = Math.max(420, ...nodes.map((node) => Number(node.layout?.y || 0) + 120));
  return `
    <svg id="knowledgeGraphSvg" class="knowledge-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="交互式知识图谱">
      <g transform="scale(${zoom})">
        ${edges.map((edge) => {
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          if (!source || !target) return "";
          return `<line class="graph-edge" x1="${Number(source.layout.x) + 68}" y1="${Number(source.layout.y) + 28}" x2="${Number(target.layout.x) + 68}" y2="${Number(target.layout.y) + 28}" />`;
        }).join("")}
        ${nodes.map((node) => `
          <g class="graph-node ${node.id === selectedId ? "selected" : ""} ${Number(node.masteryScore || 0) < 65 ? "weak" : ""}"
             transform="translate(${Number(node.layout.x)}, ${Number(node.layout.y)})" data-graph-node="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="${escapeHtml(node.title)}">
            <rect width="144" height="58" rx="8"></rect>
            <text x="12" y="22">${escapeSvgText(node.title, 12)}</text>
            <text x="12" y="42">${escapeSvgText(`${node.dimension} · ${Number(node.masteryScore || 0)}`, 14)}</text>
          </g>
        `).join("")}
      </g>
    </svg>
  `;
}

function renderKnowledgeNodeDetail(node) {
  if (!node) return "<p class=\"hint-text\">选择一个节点查看掌握证据、任务和下一步动作。</p>";
  return `
    <span class="mini-label">${escapeHtml(node.dimension || "知识节点")}</span>
    <h3>${escapeHtml(node.title)}</h3>
    <meter min="0" max="100" value="${Number(node.masteryScore || 0)}"></meter>
    <p>${escapeHtml(node.nextAction || node.evidence || "完成相关任务后会更新证据。")}</p>
    <dl class="node-evidence-list">
      <div><dt>掌握度</dt><dd>${Number(node.masteryScore || 0)}</dd></div>
      <div><dt>置信度</dt><dd>${Math.round(Number(node.confidence || 0) * 100)}%</dd></div>
      <div><dt>状态</dt><dd>${escapeHtml(node.status || "待观察")}</dd></div>
      <div><dt>复习到期</dt><dd>${escapeHtml(node.reviewDueAt || "--")}</dd></div>
    </dl>
    <div class="node-related-list">
      <strong>关联任务</strong>
      ${(node.tasks || []).slice(0, 5).map((task) => `<span>${task.completed ? "已完成" : "待完成"} · ${escapeHtml(task.title)}</span>`).join("") || "<small>暂无任务绑定。</small>"}
    </div>
    <div class="node-related-list">
      <strong>测评证据</strong>
      ${(node.quizzes || []).slice(-4).map((quiz) => `<span>${quiz.correct ? "通过" : "未通过"} · ${Number(quiz.score || 0)}/${Number(quiz.maxScore || 0)}</span>`).join("") || "<small>暂无测评证据。</small>"}
    </div>
  `;
}

function selectedGraphNode(graph) {
  const nodes = filteredGraphNodes(graph);
  const selected = state.graphUi?.selectedNodeId;
  return nodes.find((node) => node.id === selected) || nodes[0] || null;
}

function bindKnowledgeGraphControls(plan, graph) {
  const search = els.knowledgePanel.querySelector("#graphSearchInput");
  const dimension = els.knowledgePanel.querySelector("#graphDimensionFilter");
  const mastery = els.knowledgePanel.querySelector("#graphMasteryFilter");
  search?.addEventListener("input", () => {
    state.graphUi = { ...(state.graphUi || {}), search: search.value };
    saveState();
    renderKnowledge();
  });
  dimension?.addEventListener("change", () => {
    state.graphUi = { ...(state.graphUi || {}), dimension: dimension.value };
    saveState();
    renderKnowledge();
  });
  mastery?.addEventListener("change", () => {
    state.graphUi = { ...(state.graphUi || {}), mastery: mastery.value };
    saveState();
    renderKnowledge();
  });
  els.knowledgePanel.querySelectorAll("[data-select-graph-node], [data-graph-node]").forEach((element) => {
    element.addEventListener("click", () => selectGraphNode(element.dataset.selectGraphNode || element.dataset.graphNode));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectGraphNode(element.dataset.selectGraphNode || element.dataset.graphNode);
      }
    });
  });
  els.knowledgePanel.querySelectorAll("[data-graph-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      const delta = button.dataset.graphZoom === "in" ? 0.1 : -0.1;
      state.graphUi = { ...(state.graphUi || {}), zoom: Math.max(0.6, Math.min(1.5, Number(state.graphUi?.zoom || 1) + delta)) };
      saveState();
      renderKnowledge();
    });
  });
  els.knowledgePanel.querySelector("[data-refine-graph]")?.addEventListener("click", (event) => refineKnowledgeGraph(plan, event.currentTarget));
  bindGraphDrag(plan, graph);
}

function selectGraphNode(nodeId) {
  state.graphUi = { ...(state.graphUi || {}), selectedNodeId: nodeId };
  saveState();
  renderKnowledge();
}

function bindGraphDrag(plan) {
  const svg = els.knowledgePanel.querySelector("#knowledgeGraphSvg");
  if (!svg) return;
  let dragging = null;
  svg.querySelectorAll("[data-graph-node]").forEach((node) => {
    node.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const id = node.dataset.graphNode;
      const match = node.getAttribute("transform").match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
      dragging = {
        id,
        node,
        startX: event.clientX,
        startY: event.clientY,
        x: Number(match?.[1] || 0),
        y: Number(match?.[2] || 0)
      };
      state.graphUi = { ...(state.graphUi || {}), selectedNodeId: id };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp, { once: true });
    });
  });

  function handleMove(event) {
    if (!dragging) return;
    const zoom = Number(state.graphUi?.zoom || 1);
    const x = dragging.x + (event.clientX - dragging.startX) / zoom;
    const y = dragging.y + (event.clientY - dragging.startY) / zoom;
    dragging.node.setAttribute("transform", `translate(${x}, ${y})`);
  }

  function handleUp(event) {
    window.removeEventListener("mousemove", handleMove);
    if (!dragging) return;
    const zoom = Number(state.graphUi?.zoom || 1);
    const position = {
      x: Math.round(dragging.x + (event.clientX - dragging.startX) / zoom),
      y: Math.round(dragging.y + (event.clientY - dragging.startY) / zoom)
    };
    state.graphUi = {
      ...(state.graphUi || {}),
      positions: {
        ...(state.graphUi?.positions || {}),
        [dragging.id]: position
      }
    };
    saveState();
    saveGraphLayout(plan).catch(reportPersistenceError);
    dragging = null;
    renderKnowledge();
  }
}

async function refineKnowledgeGraph(plan, button) {
  if (!state.databaseReady) {
    els.masteryMode.textContent = "LLM 增强需要数据库课程";
    return;
  }
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "LLM 增强中";
  try {
    const data = await request(`/api/plans/${encodeURIComponent(plan.id)}/knowledge-graph/refine`, { method: "POST" });
    state.graphUi = {
      ...(state.graphUi || {}),
      serverGraph: data.graph,
      selectedNodeId: data.graph.nodes?.[0]?.id || state.graphUi?.selectedNodeId
    };
    saveState();
    renderKnowledge();
  } catch (error) {
    els.masteryMode.textContent = `LLM 增强失败：${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function saveGraphLayout(plan) {
  if (!state.databaseReady || !plan) return;
  await request(`/api/plans/${encodeURIComponent(plan.id)}/knowledge-graph`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graphVersionId: state.graphUi?.serverGraph?.id || null,
      positions: state.graphUi?.positions || {},
      zoom: state.graphUi?.zoom || 1
    })
  });
}

function conceptTasksFor(plan, conceptId, concept) {
  const title = concept.title || concept.conceptTitle || concept.dimension || "";
  return (plan.data?.dailyPlan || []).flatMap((day) => (day.tasks || []).map((task, index) => {
    const taskConcept = day.conceptIds?.[index] || day.conceptId;
    const matched = taskConcept === conceptId || (!taskConcept && `${task} ${day.title || ""}`.includes(title));
    if (!matched) return null;
    const key = progressId(day, index);
    return { day: day.day, taskKey: key, title: task, completed: Boolean(plan.progress?.[key]) };
  }).filter(Boolean));
}

function conceptResourcesFor(plan, concept) {
  const title = concept.title || concept.conceptTitle || concept.dimension || "";
  const citations = plan.data?.input?.knowledgeGrounding?.citations || plan.data?.resourcePackage?.sourceCitations || [];
  return citations.filter((citation) => `${citation.title || ""} ${citation.quote || ""}`.includes(title)).slice(0, 4);
}

function conceptQuizEvidenceFor(plan, conceptId, concept) {
  const title = concept.title || concept.conceptTitle || concept.dimension || "";
  return (plan.quizHistory || []).filter((item) => (
    item.conceptId === conceptId || item.dimension === concept.dimension || String(item.question || "").includes(title)
  )).slice(-6);
}

function slugClient(value) {
  let hash = 0;
  const text = String(value || "node");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return `node-${Math.abs(hash).toString(36)}`;
}

function escapeSvgText(value, maxLength = 16) {
  const text = String(value || "");
  return escapeHtml(text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text);
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
    <div class="quiz-list mistake-quiz-list">
      ${filtered.map((item) => `
        <article class="quiz-item mistake-quiz-item">
          <div class="quiz-head">
            <span>${escapeHtml(typeLabel(item.type))} · ${escapeHtml(item.dimension || "综合")} · ${formatDate(item.at)}</span>
            <strong class="bad-text">${Number(item.score || 0)}/${Number(item.maxScore || 0)}</strong>
          </div>
          <h3>${escapeHtml(stripQuestionContext(item.question))}</h3>
          ${item.options?.length ? `
            <div class="option-list mistake-options">
              ${item.options.map((option, optionIndex) => `
                <label class="option-item ${optionIndex === Number(item.answerIndex) ? "correct-option" : optionIndex === Number(item.selectedIndex) ? "wrong-option" : ""}">
                  <input type="radio" disabled ${optionIndex === Number(item.selectedIndex) ? "checked" : ""} />
                  <span>${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}${optionIndex === Number(item.answerIndex) ? "（正确答案）" : ""}</span>
                </label>
              `).join("")}
            </div>` : ""}
          <p class="feedback">${escapeHtml(item.feedback || item.explanation || "等待复盘。")}</p>
          <p class="hint-text">错因：${escapeHtml(item.reasonTag || "未归因")}</p>
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
  const report = plan.data?.learningReport;
  const mistakes = buildMistakeBook(plan);
  const progress = progressSummaryFor(plan);
  els.reportMode.textContent = `${mistakes.length} 条错题 · ${progress.percent}% 进度`;
  els.reportPanel.className = "remediation-board";

  if (!report?.markdown) {
    els.reportPanel.innerHTML = `
      <section class="remediation-head">
        <div>
          <strong>${escapeHtml(plan.title)} 学习报告</strong>
          <p>报告尚未生成。生成时会读取当前任务进度、诊断、测验、错题、掌握度、学习资料、笔记、考试和综合应用数据。</p>
        </div>
      </section>
      <section class="report-generation-empty">
        <dl class="overview-stats report-snapshot-stats">
          <div><dt>当前进度</dt><dd>${progress.percent}%</dd></div>
          <div><dt>已完成任务</dt><dd>${progress.done}/${progress.total}</dd></div>
          <div><dt>当前错题</dt><dd>${mistakes.length}</dd></div>
        </dl>
        <button class="primary-button" type="button" data-generate-report>生成学习报告</button>
        <p class="report-generation-status" aria-live="polite"></p>
      </section>
    `;
    els.reportPanel.querySelector("[data-generate-report]")?.addEventListener("click", (event) => generateLearningReport(event.currentTarget));
    return;
  }

  const reportText = report.markdown;
  els.reportPanel.innerHTML = `
    <section class="remediation-head">
      <div>
        <strong>${escapeHtml(plan.title)} 学习报告</strong>
        <p>由 LLM 根据 ${escapeHtml(formatDate(report.generatedAt))} 的学习状态生成。完成新任务或测评后，可重新生成以纳入最新证据。</p>
      </div>
      <div class="heading-actions">
        <button class="primary-button" type="button" data-generate-report>重新生成</button>
        <button class="ghost-button" type="button" data-export-report="copy">复制 Markdown</button>
        <button class="ghost-button" type="button" data-export-report="md">下载 MD</button>
        <button class="ghost-button" type="button" data-export-report="json">下载 JSON</button>
        <button class="ghost-button" type="button" data-export-report="html">下载 HTML</button>
        <button class="ghost-button" type="button" data-export-report="print">打印 PDF</button>
      </div>
    </section>
    <p class="report-generation-status" aria-live="polite"></p>
    <article id="reportText" class="report-text markdown-body" aria-label="Markdown 格式学习报告"></article>
  `;
  els.reportPanel.querySelector("#reportText").innerHTML = renderMarkdown(reportText);
  els.reportPanel.querySelector("[data-generate-report]")?.addEventListener("click", (event) => generateLearningReport(event.currentTarget));
  els.reportPanel.querySelectorAll("[data-export-report]").forEach((button) => {
    button.addEventListener("click", () => exportLearningReport(button.dataset.exportReport, plan, reportText));
  });
}

async function generateLearningReport(button) {
  const plan = getCurrentPlan();
  if (!plan || !button) return;
  const originalText = button.textContent;
  const status = els.reportPanel.querySelector(".report-generation-status");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "正在分析当前学习状态…";
  if (status) status.textContent = "正在汇总进度、掌握度、错题、笔记、考试和综合应用证据，请保持页面打开。";

  try {
    const result = await request("/api/learning-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: plan.id, context: buildLearningReportContext(plan) })
    });
    plan.data.learningReport = result.report;
    plan.data.personalInsights = null;
    recordBehavior("learning-report-generated", {
      planId: plan.id,
      detail: `${progressSummaryFor(plan).percent}% 进度快照`
    });
    saveState();
    await persistPlanContent(plan);
    await refreshLearningActivityForCurrentPlan();
    renderReport();
  } catch (error) {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = originalText;
    if (status) status.textContent = `生成失败：${error.message}`;
  }
}

function renderExam() {
  const plan = getCurrentPlan();
  if (!plan) {
    clearExamTimer();
    els.examPanel.className = "empty-state";
    els.examPanel.innerHTML = "<p>先生成或选择一个学习方案。</p>";
    els.examMode.textContent = "等待方案";
    return;
  }
  const exam = state.exam?.planId === plan.id ? state.exam : null;
  const results = Object.values(exam?.results || {});
  const score = results.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const max = (exam?.quiz || []).reduce((sum, item) => sum + Number(item.score || 0), 0);
  const remaining = exam?.status === "running" ? Math.max(0, Number(exam.durationSec || 0) - Math.round((Date.now() - exam.startedAt) / 1000)) : 0;
  els.examMode.textContent = exam?.status === "submitted"
    ? `已提交 ${score}/${max}`
    : exam?.status === "submitting"
      ? "时间已到 · 自动提交中"
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
      <p id="examCountError" class="count-error" role="alert" hidden></p>
      <div class="heading-actions">
        <button id="generateExamButton" class="primary-button" type="button">生成考试</button>
        ${exam?.quiz?.length && exam.status === "running" ? "<button id=\"submitExamButton\" class=\"ghost-button\" type=\"button\">提交考试</button>" : ""}
      </div>
    </section>
    ${exam?.quiz?.length ? `
      <div id="examCountdown" class="score-panel">${exam.status === "submitted" ? `${exam.timeExpired ? "时间已到 · 已自动提交" : "考试已提交"} · 得分 ${score}/${max}` : exam.status === "submitting" ? "时间已到，正在自动提交..." : `剩余时间 ${formatDuration(remaining)}`}</div>
      <div class="quiz-list">
        ${exam.quiz.map((item, index) => renderExamQuestion(item, index, exam.results?.[item.id])).join("")}
      </div>
    ` : "<div class=\"empty-state compact\"><p>按上面的配置生成一次模拟考试。</p></div>"}
  `;
  els.examPanel.querySelector("#generateExamButton")?.addEventListener("click", generateExam);
  els.examPanel.querySelector("#submitExamButton")?.addEventListener("click", () => submitExam());
  bindQuestionCompositionValidation(els.examPanel, {
    total: "#examQuestionCount",
    parts: ["#examChoiceCount", "#examShortCount", "#examCodeCount"],
    error: "#examCountError",
    button: "#generateExamButton"
  });
  startExamTimer();
}

function startExamTimer() {
  clearExamTimer();
  const plan = getCurrentPlan();
  const exam = state.exam?.planId === plan?.id ? state.exam : null;
  if (!exam || exam.status !== "running") return;

  const tick = () => {
    const remaining = Math.max(0, Number(exam.durationSec || 0) - Math.floor((Date.now() - Number(exam.startedAt || Date.now())) / 1000));
    const countdown = els.examPanel.querySelector("#examCountdown");
    if (countdown) countdown.textContent = remaining > 0 ? `剩余时间 ${formatDuration(remaining)}` : "时间已到，正在自动提交...";
    els.examMode.textContent = remaining > 0 ? `进行中 · 剩余 ${formatDuration(remaining)}` : "时间已到 · 自动提交中";
    if (remaining > 0) return;

    clearExamTimer();
    exam.timeExpired = true;
    saveState();
    submitExam({ timeExpired: true });
  };

  tick();
  if (exam.status === "running") examTimer = window.setInterval(tick, 1000);
}

function clearExamTimer() {
  if (examTimer !== null) window.clearInterval(examTimer);
  examTimer = null;
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
      <p id="settingCountError" class="count-error" role="alert" hidden></p>
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
  bindQuestionCompositionValidation(els.settingsPanel, {
    total: "#settingQuestionCount",
    parts: ["#settingChoiceCount", "#settingShortCount", "#settingCodeCount"],
    error: "#settingCountError",
    button: "#saveSettingsButton"
  });
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
      if (!savePracticeSettingsFromPanel()) return;
      loadQuiz(false);
    });
    bindQuestionCompositionValidation(els.practicePanel, {
      total: "#practiceQuestionCount",
      parts: ["#practiceChoiceCount", "#practiceShortCount", "#practiceCodeCount"],
      error: "#practiceCountError",
      button: "#applyPracticeSettings"
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
    if (!savePracticeSettingsFromPanel()) return;
    loadQuiz(true);
  });
  bindQuestionCompositionValidation(els.practicePanel, {
    total: "#practiceQuestionCount",
    parts: ["#practiceChoiceCount", "#practiceShortCount", "#practiceCodeCount"],
    error: "#practiceCountError",
    button: "#applyPracticeSettings"
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
        options: Array.isArray(question.options) ? [...question.options] : [],
        explanation: question.explanation || "",
        answerIndex: Number.isInteger(result.answerIndex) ? result.answerIndex : question.answerIndex,
        selectedIndex: question.type === "choice" ? Number(answer) : null,
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
      if (result.correct === false) refreshPathRevisionsForCurrentPlan();
      refreshLearningActivityForCurrentPlan().catch(() => {});
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
      <p id="practiceCountError" class="count-error" role="alert" hidden></p>
      <div class="heading-actions">
        <label class="toggle-line"><input id="practiceShowHints" type="checkbox" ${settings.showHints ? "checked" : ""} /> 显示提示</label>
        <button id="applyPracticeSettings" class="ghost-button" type="button">保存设置并出题</button>
      </div>
    </section>
  `;
}

function savePracticeSettingsFromPanel() {
  if (!validateQuestionComposition(els.practicePanel, {
    total: "#practiceQuestionCount",
    parts: ["#practiceChoiceCount", "#practiceShortCount", "#practiceCodeCount"],
    error: "#practiceCountError",
    button: "#applyPracticeSettings"
  })) return false;
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
  return true;
}

function bindQuestionCompositionValidation(container, config) {
  const selectors = [config.total, ...config.parts];
  selectors.forEach((selector) => {
    container.querySelector(selector)?.addEventListener("input", () => validateQuestionComposition(container, config));
  });
  validateQuestionComposition(container, config);
}

function validateQuestionComposition(container, config) {
  const total = numberFrom(config.total, 0, container);
  const parts = config.parts.map((selector) => numberFrom(selector, 0, container));
  const sum = parts.reduce((result, value) => result + value, 0);
  const valid = total >= 1 && total === sum;
  const error = container.querySelector(config.error);
  if (error) {
    error.hidden = valid;
    error.textContent = valid ? "" : `题型数量之和必须等于总题量：当前 ${sum} 题，总题量 ${total} 题。`;
  }
  const button = container.querySelector(config.button);
  if (button) button.disabled = !valid;
  return valid;
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
      options: Array.isArray(item.options) ? item.options : [],
      answerIndex: item.answerIndex,
      selectedIndex: item.selectedIndex,
      explanation: item.explanation || item.result?.explanation || "",
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
        options: Array.isArray(source.options) ? source.options : [],
        answerIndex: source.answerIndex,
        selectedIndex: item.selectedIndex,
        explanation: source.explanation || item.explanation || "",
        score: item.score,
        maxScore: item.maxScore,
        feedback: item.explanation || "",
        referenceAnswer: source.explanation,
        reasonTag: (item.misconceptionTags || source.misconceptionTags || [])[0] || inferReasonTag(item.explanation),
        at: plan.data.diagnosticResult?.evaluatedAt || new Date().toISOString()
      };
    });
  const seen = new Set();
  return [...quizMistakes, ...diagnosticMistakes]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .filter((item) => {
      const questionKey = `${item.type}|${stripQuestionContext(item.question).toLocaleLowerCase()}`;
      if (seen.has(questionKey)) return false;
      seen.add(questionKey);
      return true;
    });
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

function buildLearningReportContext(plan) {
  const progress = progressSummaryFor(plan);
  const mistakes = buildMistakeBook(plan);
  const mastery = plan.data?.adaptiveState?.concepts || plan.data?.knowledgeGraph?.concepts || [];
  const latestExam = state.exam?.planId === plan.id ? state.exam : null;
  const examResults = Object.values(latestExam?.results || {});
  const notes = String(plan.notes || "");
  const dailyPlan = plan.data?.dailyPlan || [];
  return {
    snapshotAt: new Date().toISOString(),
    course: {
      id: plan.id,
      title: plan.title,
      createdAt: plan.createdAt,
      input: plan.data?.input || {},
      learnerProfile: plan.data?.learnerProfile || plan.data?.profile || null
    },
    progress: {
      ...progress,
      currentDay: currentLearningDay(plan).day?.day || null,
      days: dailyPlan.map((day) => ({
        day: day.day,
        title: day.title,
        focus: day.focus,
        checkpoint: day.checkpoint,
        materialsGeneratedAt: day.materialsGeneratedAt || null,
        knowledgePoints: day.knowledgePoints || [],
        materials: (day.materials || []).map((material) => ({
          type: material.type,
          title: material.title,
          contentCharacters: String(material.content || "").length
        })),
        tasks: (day.tasks || []).map((task, taskIndex) => ({
          task,
          completed: Boolean(plan.progress?.[progressId(day, taskIndex)])
        }))
      }))
    },
    diagnostic: plan.data?.diagnosticResult || null,
    mastery: mastery.map((item) => ({
      conceptId: item.conceptId || item.id,
      concept: item.title || item.conceptTitle || item.dimension,
      dimension: item.dimension,
      masteryScore: Number(item.masteryScore ?? item.score ?? 0),
      confidence: item.confidence,
      evidence: item.evidence,
      source: item.source,
      nextAction: item.nextAction
    })),
    masteryEvidence: (plan.masteryEvidence || []).slice(-30),
    masteryHistory: (plan.masteryHistory || []).slice(-30),
    mistakes: mistakes.slice(0, 30).map((item) => ({
      source: item.source,
      type: item.type,
      dimension: item.dimension || item.conceptTitle,
      question: stripQuestionContext(item.question).slice(0, 1500),
      score: Number(item.score || 0),
      maxScore: Number(item.maxScore || 0),
      reasonTag: item.reasonTag,
      feedback: item.feedback || item.explanation,
      at: item.at
    })),
    quizHistory: (plan.quizHistory || []).slice(-30).map((item) => ({
      source: item.source,
      type: item.type,
      dimension: item.dimension,
      question: stripQuestionContext(item.question || "").slice(0, 1500),
      correct: item.correct,
      score: item.score,
      maxScore: item.maxScore,
      feedback: item.feedback || item.result?.feedback,
      at: item.at
    })),
    remediationPlan: plan.data?.remediationPlan || null,
    notes: notes.slice(0, 20000),
    notesTruncated: notes.length > 20000,
    exam: latestExam ? {
      status: latestExam.status,
      score: examResults.reduce((sum, item) => sum + Number(item.score || 0), 0),
      maxScore: examResults.reduce((sum, item) => sum + Number(item.maxScore || 0), 0),
      submittedAt: latestExam.submittedAt || null,
      results: (latestExam.quiz || []).map((question) => ({
        type: question.type,
        dimension: question.dimension,
        question: String(question.question || "").slice(0, 1500),
        result: latestExam.results?.[question.id] || null
      }))
    } : null,
    behaviorEvents: (state.behaviorEvents || [])
      .filter((event) => event.planId === plan.id)
      .slice(-30)
      .map((event) => ({ type: event.type, label: behaviorLabel(event.type), at: event.at, detail: event.detail })),
    settings: withDefaultSettings(state.settings || {})
  };
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
      exam: state.exam?.planId === plan.id ? state.exam : null
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
  if (!validateQuestionComposition(els.examPanel, {
    total: "#examQuestionCount",
    parts: ["#examChoiceCount", "#examShortCount", "#examCodeCount"],
    error: "#examCountError",
    button: "#generateExamButton"
  })) return;
  clearExamTimer();
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

async function submitExam({ timeExpired = false } = {}) {
  const plan = getCurrentPlan();
  const exam = state.exam?.planId === plan?.id ? state.exam : null;
  if (!plan || !exam?.quiz?.length || exam.status === "submitted" || examSubmitting) return;
  const answers = exam.quiz.map((question) => ({ question, answer: readQuizAnswerFrom(els.examPanel, question) }));
  if (!timeExpired && withDefaultSettings(state.settings).strictMode && answers.some((item) => item.answer === null || item.answer === "")) {
    alert("还有题目未作答。");
    return;
  }
  examSubmitting = true;
  clearExamTimer();
  exam.status = "submitting";
  exam.timeExpired = Boolean(timeExpired || exam.timeExpired);
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
    if (state.databaseReady) {
      const examResults = Object.values(exam.results || {});
      const score = examResults.reduce((sum, item) => sum + Number(item.score || 0), 0);
      const maxScore = examResults.reduce((sum, item) => sum + Number(item.maxScore || 0), 0);
      await evaluatePathReplanning("exam_submitted", {
        exam: {
          score,
          maxScore,
          percent: maxScore ? Math.round((score / maxScore) * 100) : 0
        }
      });
    }
    saveState();
    renderExam();
    renderMistakes();
    renderKnowledge();
    renderReport();
    renderSavedPlans();
  } catch (error) {
    exam.status = "running";
    alert(`考试提交失败：${error.message}`);
  } finally {
    examSubmitting = false;
    if (button) {
      button.disabled = false;
      button.textContent = "提交考试";
    }
  }
}

function saveSettingsFromPanel() {
  if (!validateQuestionComposition(els.settingsPanel, {
    total: "#settingQuestionCount",
    parts: ["#settingChoiceCount", "#settingShortCount", "#settingCodeCount"],
    error: "#settingCountError",
    button: "#saveSettingsButton"
  })) return;
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

function examScoreText(exam) {
  const results = Object.values(exam?.results || {});
  const score = results.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const max = results.reduce((sum, item) => sum + Number(item.maxScore || 0), 0);
  return `${score}/${max}`;
}

function behaviorLabel(type) {
  return {
    "plan-generated": "生成方案",
    "diagnostic-generated": "生成课前测",
    "diagnostic-submitted": "提交诊断",
    "quiz-generated": "生成练习",
    "quiz-submitted": "提交练习",
    "exam-generated": "生成考试",
    "exam-submitted": "提交考试",
    "daily-materials-generated": "生成当日学习资料",
    "learning-report-generated": "生成学习报告",
    "report-exported": "导出报告",
    "path-revision-proposed": "提出路径变更",
    "path-revision-applied": "应用路径变更",
    "path-revision-rejected": "忽略路径变更",
    "path-revision-undone": "撤销路径变更",
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
    credentials: "include",
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
      <em>组织每日路径、阅读任务和综合应用练习</em>
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
        planId: state.databaseReady ? plan?.id : null,
        sourceIds: plan?.data?.input?.knowledgeSourceIds || [],
        mode: els.tutorMode.value,
        hintLevel: Number(els.hintLevel.value || 1),
        history: state.tutorHistory || []
      })
    });
    els.coachAnswer.innerHTML = `${renderMarkdown(data.answer)}${data.citations?.length ? `
      <section class="tutor-citations">
        <strong>本次回答引用的课程资料</strong>
        ${data.citations.map(renderCitationCard).join("")}
      </section>
    ` : ""}`;
    state.tutorHistory = [
      ...(state.tutorHistory || []),
      { role: "student", content: question, at: new Date().toISOString() },
      { role: "tutor", content: data.answer, mode: data.tutorMode, hintLevel: data.hintLevel, at: new Date().toISOString() }
    ].slice(-12);
    saveState();
    els.coachMode.textContent = data.mode === "llm" || data.mode === "llm-full-context-tutor"
      ? `大模型回答 · ${tutorModeLabel(data.tutorMode)} · 提示 ${data.hintLevel}`
      : `本地提示 · ${tutorModeLabel(data.tutorMode)} · 提示 ${data.hintLevel}`;
    refreshLearningActivityForCurrentPlan().catch(() => {});
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

let appStateSyncTimer = null;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
  if (!state.databaseReady) return;
  clearTimeout(appStateSyncTimer);
  appStateSyncTimer = setTimeout(syncPersistentAppState, 150);
}

async function syncPersistentAppState() {
  appStateSyncTimer = null;
  const serialized = serializeState();
  const persistentState = {
    tutorHistory: serialized.tutorHistory,
    settings: serialized.settings,
    behaviorEvents: serialized.behaviorEvents,
    exam: serialized.exam,
    mistakeFilters: serialized.mistakeFilters,
    lastQuizOptions: serialized.lastQuizOptions
  };
  try {
    await request("/api/app-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: persistentState })
    });
  } catch {
    // localStorage remains a fallback if the local database is temporarily busy.
  }
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
    pathRevisions: state.pathRevisions || {},
    mistakeFilters: state.mistakeFilters || { concept: "all", type: "all", reason: "all" },
    lastQuizOptions: state.lastQuizOptions || null,
    profileInterview: state.profileInterview || null,
    knowledgeSources: state.knowledgeSources || [],
    selectedSourceIds: state.selectedSourceIds || [],
    activitySummary: state.activitySummary || null,
    graphUi: state.graphUi || {}
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
      pathRevisions: saved?.pathRevisions || {},
      mistakeFilters: saved?.mistakeFilters || { concept: "all", type: "all", reason: "all" },
      lastQuizOptions: saved?.lastQuizOptions || null,
      profileInterview: saved?.profileInterview || null,
      knowledgeSources: saved?.knowledgeSources || [],
      selectedSourceIds: saved?.selectedSourceIds || [],
      activitySummary: saved?.activitySummary || null,
      graphUi: saved?.graphUi || {},
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
      pathRevisions: {},
      mistakeFilters: { concept: "all", type: "all", reason: "all" },
      lastQuizOptions: null,
      profileInterview: null,
      knowledgeSources: [],
      selectedSourceIds: [],
      activitySummary: null,
      graphUi: {},
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
