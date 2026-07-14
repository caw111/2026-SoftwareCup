import {
  getApplicationStateRecord,
  saveApplicationStateRecord
} from "../repositories/application-state-repository.js";

export async function getApplicationStateForUser(userId) {
  return getApplicationStateRecord(userId);
}

export async function saveApplicationStateForUser(userId, value) {
  const state = normalizeApplicationState(value?.state || value);
  const expectedVersion = normalizeVersion(value?.version);
  const serializedSize = Buffer.byteLength(JSON.stringify(state), "utf8");
  if (serializedSize > 1024 * 1024) {
    const error = new Error("学习状态数据超过 1 MB 限制");
    error.statusCode = 413;
    throw error;
  }
  const saved = await saveApplicationStateRecord(userId, state, expectedVersion);
  return { ok: true, ...saved };
}

export function normalizeApplicationState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    tutorHistory: arrayValue(source.tutorHistory, 50),
    settings: objectValue(source.settings),
    behaviorEvents: arrayValue(source.behaviorEvents, 500),
    exam: source.exam && typeof source.exam === "object" ? source.exam : null,
    projectTasks: objectValue(source.projectTasks),
    projectProgress: objectValue(source.projectProgress),
    projectSubmissions: objectValue(source.projectSubmissions),
    mistakeFilters: objectValue(source.mistakeFilters),
    lastQuizOptions: source.lastQuizOptions && typeof source.lastQuizOptions === "object"
      ? source.lastQuizOptions
      : null
  };
}

function arrayValue(value, limit) {
  return Array.isArray(value) ? value.slice(-limit) : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeVersion(value) {
  const version = Number(value ?? 0);
  if (!Number.isSafeInteger(version) || version < 0) {
    const error = new Error("学习状态版本号无效");
    error.statusCode = 400;
    throw error;
  }
  return version;
}
