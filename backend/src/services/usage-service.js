import { incrementDailyUsageRecord } from "../repositories/usage-repository.js";

const activeRequests = new Map();
const limits = {
  "llm-test": { daily: numberEnv("LLM_TEST_DAILY_LIMIT", 10), concurrent: 1 },
  generate: { daily: numberEnv("GENERATE_DAILY_LIMIT", 20), concurrent: 2 },
  quiz: { daily: numberEnv("QUIZ_DAILY_LIMIT", 100), concurrent: 2 },
  tutor: { daily: numberEnv("TUTOR_DAILY_LIMIT", 100), concurrent: 2 }
};

export async function withApiLimit(userId, endpoint, work) {
  const limit = limits[endpoint];
  if (!limit) return work();

  const key = `${userId}:${endpoint}`;
  const active = activeRequests.get(key) || 0;
  if (active >= limit.concurrent) {
    throw httpError(429, "当前请求仍在处理中，请稍后重试");
  }

  const used = await incrementDailyUsageRecord(userId, endpoint);
  if (used > limit.daily) {
    throw httpError(429, `今日${endpoint}调用次数已达到上限`);
  }

  activeRequests.set(key, active + 1);
  try {
    return await work();
  } finally {
    const remaining = (activeRequests.get(key) || 1) - 1;
    if (remaining > 0) activeRequests.set(key, remaining);
    else activeRequests.delete(key);
  }
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
