const EFFECTIVE_TYPES = new Set([
  "task_completed",
  "quiz_attempt_evaluated",
  "diagnostic_completed",
  "mistake_retested",
  "exam_submitted",
  "review_completed"
]);

const EVENT_WEIGHTS = {
  task_completed: 2,
  quiz_attempt_evaluated: 3,
  diagnostic_completed: 5,
  mistake_retested: 4,
  exam_submitted: 7,
  review_completed: 4,
  tutor_question_asked: 1,
  source_question_asked: 1,
  daily_materials_generated: 1,
  learning_report_generated: 1,
  note_updated: 1
};

const BADGE_RULES = [
  {
    id: "streak-3",
    title: "三日连学",
    description: "按自然日连续 3 天完成有效学习。",
    target: 3,
    metric: "currentStreak"
  },
  {
    id: "streak-7",
    title: "七日稳定节奏",
    description: "按自然日连续 7 天完成有效学习。",
    target: 7,
    metric: "currentStreak"
  },
  {
    id: "diagnostic-first",
    title: "完成首次诊断",
    description: "提交一次课前诊断并形成画像证据。",
    target: 1,
    metric: "diagnostics"
  },
  {
    id: "practice-10",
    title: "十题练习闭环",
    description: "累计提交 10 道练习或测评题。",
    target: 10,
    metric: "quizAttempts"
  },
  {
    id: "task-20",
    title: "二十项任务完成",
    description: "累计完成 20 项学习路径任务。",
    target: 20,
    metric: "completedTasks"
  }
];

export function summarizeLearningActivity(events, options = {}) {
  const timeZone = normalizeTimeZone(options.timeZone);
  const now = options.now ? new Date(options.now) : new Date();
  const normalized = events
    .map(normalizeEvent)
    .filter((event) => !Number.isNaN(event.occurredAt.getTime()))
    .sort((left, right) => left.occurredAt - right.occurredAt);
  const rollups = buildDailyRollups(normalized, timeZone);
  const streak = calculateStreak(rollups, { timeZone, now });
  const metrics = buildBadgeMetrics(normalized, streak);
  const badges = evaluateBadges(metrics, normalized);

  return {
    timeZone,
    generatedAt: now.toISOString(),
    streak,
    heatmap: rollups.map(publicRollup),
    calendar: buildCalendar(rollups),
    badges,
    metrics
  };
}

export function buildDailyRollups(events, timeZone = "UTC") {
  const byDate = new Map();
  for (const event of events) {
    const dateKey = localDateKey(event.occurredAt, timeZone);
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, {
        date: dateKey,
        score: 0,
        cappedScore: 0,
        eventCount: 0,
        effectiveEventCount: 0,
        completedTasks: 0,
        quizAttempts: 0,
        diagnostics: 0,
        reviews: 0,
        concepts: new Set(),
        events: []
      });
    }
    const rollup = byDate.get(dateKey);
    const weight = eventWeight(event);
    rollup.score += weight;
    rollup.cappedScore = Math.min(12, rollup.score);
    rollup.eventCount += 1;
    if (isEffectiveLearningEvent(event)) rollup.effectiveEventCount += 1;
    if (event.type === "task_completed") rollup.completedTasks += 1;
    if (event.type === "quiz_attempt_evaluated") rollup.quizAttempts += 1;
    if (event.type === "diagnostic_completed") rollup.diagnostics += 1;
    if (event.type === "review_completed") rollup.reviews += 1;
    const conceptId = event.payload?.conceptId || event.payload?.dimension;
    if (conceptId) rollup.concepts.add(String(conceptId));
    rollup.events.push(publicEvent(event, weight));
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function calculateStreak(rollups, options = {}) {
  const timeZone = normalizeTimeZone(options.timeZone);
  const today = localDateKey(options.now ? new Date(options.now) : new Date(), timeZone);
  const activeDays = new Set(
    rollups
      .filter((rollup) => rollup.effectiveEventCount > 0)
      .map((rollup) => rollup.date)
  );
  const yesterday = addDays(today, -1);
  const anchor = activeDays.has(today) ? today : activeDays.has(yesterday) ? yesterday : null;
  let current = 0;
  if (anchor) {
    for (let cursor = anchor; activeDays.has(cursor); cursor = addDays(cursor, -1)) {
      current += 1;
    }
  }

  let longest = 0;
  let running = 0;
  let previous = null;
  for (const date of [...activeDays].sort()) {
    running = previous && addDays(previous, 1) === date ? running + 1 : 1;
    longest = Math.max(longest, running);
    previous = date;
  }

  return {
    current,
    longest,
    lastActiveDate: [...activeDays].sort().at(-1) || null,
    todayActive: activeDays.has(today),
    countedThrough: anchor,
    rule: "按用户时区自然日统计，同日多次有效学习只计 1 天。"
  };
}

export function isEffectiveLearningEvent(event) {
  return EFFECTIVE_TYPES.has(String(event?.type || event?.eventType || ""));
}

export function eventWeight(event) {
  const type = String(event?.type || event?.eventType || "");
  if (type === "quiz_attempt_evaluated" && event?.payload?.correct === false) return 2;
  return EVENT_WEIGHTS[type] || 0;
}

export function localDateKey(value, timeZone = "UTC") {
  const date = value instanceof Date ? value : new Date(value);
  const safeTimeZone = normalizeTimeZone(timeZone);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: safeTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || "01";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function addDays(dateKey, delta) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function buildBadgeMetrics(events, streak) {
  return {
    currentStreak: streak.current,
    longestStreak: streak.longest,
    completedTasks: events.filter((event) => event.type === "task_completed").length,
    quizAttempts: events.filter((event) => event.type === "quiz_attempt_evaluated").length,
    diagnostics: events.filter((event) => event.type === "diagnostic_completed").length,
    reviews: events.filter((event) => event.type === "review_completed").length
  };
}

function evaluateBadges(metrics, events) {
  return BADGE_RULES.map((rule) => {
    const value = Number(metrics[rule.metric] || 0);
    const unlocked = value >= rule.target;
    const evidence = evidenceForBadge(rule, events);
    return {
      id: rule.id,
      title: rule.title,
      description: rule.description,
      target: rule.target,
      current: Math.min(value, rule.target),
      progress: rule.target ? Math.min(100, Math.round((value / rule.target) * 100)) : 0,
      unlocked,
      unlockedAt: unlocked ? evidence.at : null,
      evidence
    };
  });
}

function evidenceForBadge(rule, events) {
  const matching = events.filter((event) => {
    if (rule.metric === "currentStreak") return isEffectiveLearningEvent(event);
    if (rule.metric === "completedTasks") return event.type === "task_completed";
    if (rule.metric === "quizAttempts") return event.type === "quiz_attempt_evaluated";
    if (rule.metric === "diagnostics") return event.type === "diagnostic_completed";
    return false;
  });
  const event = matching[Math.min(rule.target, matching.length) - 1] || matching.at(-1) || null;
  return {
    eventType: event?.type || null,
    eventId: event?.id || null,
    at: event?.occurredAt?.toISOString?.() || null,
    count: matching.length
  };
}

function buildCalendar(rollups) {
  return rollups.map((rollup) => ({
    date: rollup.date,
    score: rollup.cappedScore,
    eventCount: rollup.eventCount,
    effectiveEventCount: rollup.effectiveEventCount,
    completedTasks: rollup.completedTasks,
    quizAttempts: rollup.quizAttempts,
    diagnostics: rollup.diagnostics,
    reviews: rollup.reviews,
    concepts: [...rollup.concepts],
    events: rollup.events
  }));
}

function publicRollup(rollup) {
  return {
    date: rollup.date,
    score: rollup.cappedScore,
    rawScore: rollup.score,
    level: heatLevel(rollup.cappedScore),
    eventCount: rollup.eventCount,
    effectiveEventCount: rollup.effectiveEventCount
  };
}

function heatLevel(score) {
  if (score <= 0) return 0;
  if (score <= 2) return 1;
  if (score <= 5) return 2;
  if (score <= 9) return 3;
  return 4;
}

function normalizeEvent(row) {
  return {
    id: row.id,
    planId: row.planId || row.plan_id,
    type: row.type || row.eventType || row.event_type,
    eventKey: row.eventKey || row.event_key || null,
    payload: row.payload || row.payload_json || {},
    occurredAt: row.occurredAt instanceof Date
      ? row.occurredAt
      : row.occurred_at instanceof Date
        ? row.occurred_at
        : new Date(row.occurredAt || row.occurred_at || row.createdAt || row.created_at || Date.now())
  };
}

function publicEvent(event, weight) {
  return {
    id: event.id,
    type: event.type,
    planId: event.planId,
    eventKey: event.eventKey,
    payload: event.payload,
    occurredAt: event.occurredAt.toISOString(),
    effective: isEffectiveLearningEvent(event),
    score: weight
  };
}

function normalizeTimeZone(timeZone) {
  const value = String(timeZone || "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return "UTC";
  }
}
