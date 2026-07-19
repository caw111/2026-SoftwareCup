import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const iconv = require("iconv-lite");

const MOJIBAKE_FRAGMENTS = [
  "瀛︿範",
  "鐢熸垚",
  "璇剧▼",
  "鍙紪",
  "澶х翰",
  "鎬濈淮",
  "椤圭洰",
  "璧勬簮",
  "绛夊緟",
  "鍚庣",
  "浠诲姟",
  "瑙ｉ噴",
  "妯″瀷",
  "棰勬祴"
];

const KNOWN_REPAIRS = new Map([
  ["鍙紪杈戝ぇ绾�", "大纲"],
  ["鍙紪杈戝ぇ绾?", "大纲"],
  ["澶嶅埗澶х翰", "复制大纲"],
  ["鍏ㄩ儴鍒嗘敮", "全部分支"],
  ["鐢熸垚璇剧▼", "生成课程"],
  ["瀛︿範璺緞", "学习路径"],
  ["鎬濈淮瀵煎浘", "思维导图"],
  ["椤圭洰浠诲姟", "项目任务"],
  ["瀛︿範璧勬簮", "学习资源"]
]);

export function containsLegacyMojibake(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  return MOJIBAKE_FRAGMENTS.some((fragment) => text.includes(fragment)) || text.includes("�");
}

export function repairLegacyMojibake(value) {
  const result = repairValue(value);
  return {
    value: result.value,
    changed: result.changed
  };
}

function repairValue(value) {
  if (typeof value === "string") {
    const repaired = repairText(value);
    return { value: repaired, changed: repaired !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const repaired = repairValue(item);
      changed ||= repaired.changed;
      return repaired.value;
    });
    return { value: items, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const entries = Object.entries(value).map(([key, item]) => {
      const repaired = repairValue(item);
      changed ||= repaired.changed;
      return [key, repaired.value];
    });
    return { value: Object.fromEntries(entries), changed };
  }
  return { value, changed: false };
}

function repairText(text) {
  if (!containsLegacyMojibake(text)) return text;
  const candidates = new Set([text, applyKnownRepairs(text)]);
  const converted = iconv.decode(iconv.encode(text, "gbk"), "utf8");
  candidates.add(converted);
  candidates.add(applyKnownRepairs(converted));
  return [...candidates].sort((left, right) => (
    mojibakeScore(left) - mojibakeScore(right)
  ))[0] || text;
}

function applyKnownRepairs(text) {
  let repaired = text;
  for (const [bad, good] of KNOWN_REPAIRS) {
    repaired = repaired.replaceAll(bad, good);
  }
  return repaired;
}

function mojibakeScore(text) {
  return MOJIBAKE_FRAGMENTS.reduce((sum, fragment) => (
    sum + (text.includes(fragment) ? 3 : 0)
  ), text.includes("�") ? 8 : 0);
}
