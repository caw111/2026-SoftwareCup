export function clean(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function clamp(value) {
  return Math.max(20, Math.min(95, Math.round(value)));
}

export function ensureArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

export function normalizeCodeLanguage(language) {
  const value = String(language || "python").toLowerCase();
  if (["cpp", "c++"].includes(value)) return "cpp";
  if (["javascript", "js", "node"].includes(value)) return "javascript";
  if (value === "java") return "java";
  return "python";
}
