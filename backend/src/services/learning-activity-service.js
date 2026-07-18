import { summarizeLearningActivity } from "../learning-activity.js";
import { listLearningEventRecords } from "../repositories/learning-activity-repository.js";
import { planExistsForUser } from "../repositories/plan-repository.js";

export async function getLearningActivitySummaryForUser(userId, options = {}) {
  const planId = options.planId ? String(options.planId).slice(0, 64) : null;
  if (planId && !(await planExistsForUser(userId, planId))) {
    const error = new Error("学习方案不存在");
    error.statusCode = 404;
    throw error;
  }
  const now = new Date();
  const from = options.from || new Date(now.getTime() - 370 * 24 * 60 * 60 * 1000).toISOString();
  const to = options.to || new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const events = await listLearningEventRecords(userId, {
    planId,
    from,
    to,
    limit: 8000
  });
  return {
    ok: true,
    planId,
    source: "learning_activity_events",
    ...summarizeLearningActivity(events, {
      timeZone: options.timeZone,
      now
    })
  };
}
