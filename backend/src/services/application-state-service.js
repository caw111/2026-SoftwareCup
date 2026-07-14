import {
  getApplicationStateRecord,
  upsertApplicationStateRecord
} from "../repositories/application-state-repository.js";

export async function getApplicationStateForUser(userId) {
  return getApplicationStateRecord(userId);
}

export async function saveApplicationStateForUser(userId, value) {
  const state = normalizeApplicationState(value?.state || value);
  const saved = await upsertApplicationStateRecord(userId, state);
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
