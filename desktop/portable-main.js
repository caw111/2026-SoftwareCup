import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(desktopDir, "..");
const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || appRoot, "AppData", "Local");
const userDataDir = path.join(localAppData, "PersonalizedLearning");

fs.mkdirSync(userDataDir, { recursive: true });
process.chdir(appRoot);
const backendPort = await findFreePort();
const frontendPort = await findFreePort();
process.env.BACKEND_PORT = String(backendPort);
process.env.FRONTEND_PORT = String(frontendPort);
process.env.JUDGE_AUTO_BOOTSTRAP = "false";
process.env.LOCAL_SINGLE_USER = "true";
process.env.SOFTWARECUP_DATA_DIR ||= path.join(userDataDir, "data");
process.env.PYTHON_EXECUTABLE ||= path.join(appRoot, "..", "runtime", "python", "python.exe");

for (const key of [
  "MYSQL_URL",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE"
]) {
  delete process.env[key];
}

try {
  await import("../backend/server.js");
  await import("../frontend/server.js");
  await waitUntilReady(`http://127.0.0.1:${frontendPort}`, 10000);

  if (process.env.SOFTWARECUP_HEADLESS === "true") {
    console.log(`Portable services are ready at http://127.0.0.1:${frontendPort}`);
  } else {
    launchDesktopWindow();
  }
} catch (error) {
  fail(error);
}

function launchDesktopWindow() {
  const edgePath = findEdge();
  if (!edgePath) throw new Error("未找到 Microsoft Edge。请安装 Edge 后重试。");

  const edge = spawn(edgePath, [
    `--app=http://127.0.0.1:${frontendPort}`,
    `--user-data-dir=${path.join(userDataDir, "edge-profile")}`,
    "--no-first-run",
    "--disable-sync"
  ], {
    stdio: "ignore",
    windowsHide: true
  });

  edge.once("error", fail);
  edge.once("exit", () => process.exit(0));
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function findEdge() {
  const candidates = [
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function waitUntilReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("本地页面服务启动超时。");
}

function fail(error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  fs.writeFileSync(path.join(userDataDir, "startup-error.log"), message, "utf8");
  console.error(message);
  process.exit(1);
}
