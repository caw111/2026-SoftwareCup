import {
  getAppStateRecord,
  saveAppStateRecord
} from "../repositories/app-state-repository.js";

const ALLOWED_KEYS = new Set([
  "tutorHistory",
  "settings",
  "behaviorEvents",
  "exam",
  "projectTasks",
  "projectProgress",
  "projectSubmissions",
  "mistakeFilters",
  "lastQuizOptions"
]);

export function getAppStateForUser(userId) {
  return getAppStateRecord(userId);
}

export function saveAppStateForUser(userId, value) {
  const source = value?.state && typeof value.state === "object" ? value.state : value;
  const state = {};
  for (const [key, item] of Object.entries(source || {})) {
    if (ALLOWED_KEYS.has(key)) state[key] = item;
  }
  return saveAppStateRecord(userId, state);
}
