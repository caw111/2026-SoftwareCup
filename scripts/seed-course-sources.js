import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SESSION_CONFIG } from "../backend/src/config.js";
import { closeDatabasePool, isDatabaseConfigured } from "../backend/src/db/pool.js";
import { agents } from "../backend/src/agents.js";
import {
  normalizeInput,
  prepareNewCoursePlan,
  runLocalAgents
} from "../backend/src/learning.js";
import { createAnonymousUserSession } from "../backend/src/repositories/user-repository.js";
import { createPlanForUser, setActivePlanForUser } from "../backend/src/services/plan-service.js";
import {
  listSourcesForUser,
  loadFullSourceContextForUser,
  uploadSourceForUser
} from "../backend/src/services/source-service.js";
import { migrateDatabase } from "./migrate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COURSEWARE_DIR = path.join(ROOT, "courseware", "ai-machine-learning-basics");
const MANIFEST_FILE = path.join(COURSEWARE_DIR, "manifest.json");

async function main() {
  if (!isDatabaseConfigured()) {
    throw new Error("MySQL 未配置，无法导入课程知识库。请先配置 MYSQL_* 或 MYSQL_URL。");
  }

  await migrateDatabase({ log: () => {} });
  const manifest = readManifest();
  const dryRun = process.argv.includes("--dry-run");
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_CONFIG.ttlDays * 24 * 60 * 60 * 1000);

  if (dryRun) {
    const files = manifest.sourceFiles.map((file) => inspectSourceFile(file));
    console.log(JSON.stringify({ ok: true, dryRun: true, course: manifest.title, files }, null, 2));
    return;
  }

  const session = await createAnonymousUserSession(hashToken(sessionToken), expiresAt);
  const uploadedSources = [];
  for (const sourceFile of manifest.sourceFiles) {
    uploadedSources.push(await uploadSourceForUser(session.userId, buildUploadPayload(sourceFile)));
  }

  const sources = await listSourcesForUser(session.userId);
  const sourceIds = sources.map((source) => source.id);
  const grounding = await loadFullSourceContextForUser(session.userId, { sourceIds });
  const seedInput = normalizeInput({
    ...manifest.seedPlan,
    knowledgeSourceIds: sourceIds
  });
  const input = {
    ...seedInput,
    knowledgeSources: sources,
    knowledgeGrounding: grounding
  };
  const generated = prepareNewCoursePlan(runLocalAgents(input));
  const plan = await createPlanForUser(session.userId, {
    id: `${manifest.id}-${Date.now()}`,
    title: `${manifest.title} 演示课程`,
    category: "课程知识库种子",
    data: {
      mode: "seeded-courseware",
      input,
      agents,
      ...generated,
      courseware: {
        id: manifest.id,
        title: manifest.title,
        sourceFiles: manifest.sourceFiles,
        seededAt: new Date().toISOString()
      }
    }
  });
  await setActivePlanForUser(session.userId, plan.id);

  console.log(JSON.stringify({
    ok: true,
    course: manifest.title,
    userId: session.userId,
    planId: plan.id,
    sourceCount: uploadedSources.length,
    chunkCount: sources.reduce((sum, source) => sum + Number(source.chunkCount || 0), 0),
    sessionCookie: `${SESSION_CONFIG.cookieName}=${encodeURIComponent(sessionToken)}`,
    cookieExpiresAt: expiresAt.toISOString(),
    note: "浏览器访问前端后，可将 sessionCookie 写入 127.0.0.1 域的 Cookie 以进入该演示工作台。"
  }, null, 2));
}

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
}

function inspectSourceFile(sourceFile) {
  const filePath = sourcePath(sourceFile);
  const content = fs.readFileSync(filePath);
  return {
    file: sourceFile,
    bytes: content.length,
    extension: path.extname(sourceFile).toLowerCase(),
    checksum: crypto.createHash("sha256").update(content).digest("hex")
  };
}

function buildUploadPayload(sourceFile) {
  const filePath = sourcePath(sourceFile);
  const buffer = fs.readFileSync(filePath);
  return {
    filename: sourceFile,
    mimeType: mimeTypeFor(sourceFile),
    contentBase64: buffer.toString("base64")
  };
}

function sourcePath(sourceFile) {
  const normalized = path.normalize(sourceFile);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`课程资料路径不安全：${sourceFile}`);
  }
  const filePath = path.join(COURSEWARE_DIR, normalized);
  if (!fs.existsSync(filePath)) throw new Error(`课程资料不存在：${sourceFile}`);
  return filePath;
}

function mimeTypeFor(filename) {
  return {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json"
  }[path.extname(filename).toLowerCase()] || "application/octet-stream";
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await closeDatabasePool();
});
