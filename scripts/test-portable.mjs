import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const bundleRoot = path.join(projectRoot, "dist-portable", "PersonalizedLearning");
const bundledNode = path.join(bundleRoot, "runtime", "node.exe");
const bundledPython = path.join(bundleRoot, "runtime", "python", "python.exe");
const entry = path.join(bundleRoot, "app", "desktop", "portable-main.js");
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "softwarecup-sqlite-test-"));

const child = spawn(bundledNode, [entry], {
  cwd: path.join(bundleRoot, "app"),
  env: {
    ...process.env,
    SOFTWARECUP_HEADLESS: "true",
    SOFTWARECUP_DATA_DIR: testDataDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
let resolveReady;
const readyUrlPromise = new Promise((resolve) => { resolveReady = resolve; });
child.stdout.on("data", (data) => {
  output += data;
  const match = output.match(/Portable services are ready at (http:\/\/127\.0\.0\.1:\d+)/);
  if (match) resolveReady(match[1]);
});
child.stderr.on("data", (data) => { output += data; });

let testExitCode = 0;
try {
  const baseUrl = await Promise.race([
    readyUrlPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Portable startup timed out")), 10000))
  ]);
  const health = await fetchJson(`${baseUrl}/api/health`);
  const page = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
  const storage = await fetchJson(`${baseUrl}/api/storage/status`);
  const judge = await fetchJson(`${baseUrl}/api/judge/status`);
  const plan = await fetchJson(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "数据结构", level: "入门", goal: "掌握基础", duration: "7天" })
  });
  const zipPath = path.join(projectRoot, "dist-portable", "PersonalizedLearning-Portable-0.1.0.zip");
  const planId = `portable-test-${Date.now()}`;
  await fetchJson(`${baseUrl}/api/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan: {
        id: planId,
        title: "SQLite portable test",
        category: "test",
        data: { dailyPlan: [{ day: 1, tasks: ["Persist this task"] }] }
      }
    })
  });
  await fetchJson(`${baseUrl}/api/plans/${planId}/tasks/day-1-task-0`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completed: true })
  });
  const workspace = await fetchJson(`${baseUrl}/api/workspace`);
  const storedPlan = workspace.plans.find((item) => item.id === planId);
  await fetchJson(`${baseUrl}/api/app-state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: { settings: { theme: "portable-test" } } })
  });
  const appState = await fetchJson(`${baseUrl}/api/app-state`);
  const pythonResult = verifyBundledPython();
  await fetchJson(`${baseUrl}/api/plans/${planId}`, { method: "DELETE" });
  console.log(JSON.stringify({
    pageStatus: page.status,
    health: health.status,
    databaseMode: health.storage.mode,
    storage: storage.mode,
    sqliteFileCreated: fs.existsSync(path.join(testDataDir, "learning.sqlite3")),
    sqlitePlanStored: Boolean(storedPlan),
    sqliteTaskStored: storedPlan?.progress?.["day-1-task-0"] === true,
    sqliteAppStateStored: appState?.state?.settings?.theme === "portable-test",
    judgeOk: judge.ok,
    judgeMode: judge.mode,
    bundledPython: pythonResult.passed === 1,
    planGenerated: Boolean(plan.resourcePackage),
    bundledNode,
    zipMB: Math.round(fs.statSync(zipPath).size / 1024 / 1024 * 100) / 100
  }, null, 2));
} catch (error) {
  testExitCode = 1;
  console.error(error instanceof Error ? error.stack : String(error));
  console.error(output);
} finally {
  child.kill("SIGKILL");
  child.stdout.destroy();
  child.stderr.destroy();
  setTimeout(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    process.exit(testExitCode);
  }, 100);
}

function verifyBundledPython() {
  const runner = path.join(bundleRoot, "app", "backend", "judge", "python", "safe_python_runner.py");
  const payload = JSON.stringify({
    code: "def solve(values):\n    total = 0\n    for value in values:\n        total += value\n    return total",
    tests: [{ function: "solve", args: [[1, 2, 3]], expected: 6 }]
  });
  const result = spawnSync(bundledPython, ["-I", "-S", "-B", runner], {
    input: payload,
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || "Bundled Python failed");
  return JSON.parse(result.stdout);
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    ...(options || {})
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}
