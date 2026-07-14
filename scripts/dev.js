import { spawn } from "node:child_process";

const processes = [
  ["后端", "node", ["backend/server.js"], 3000],
  ["前端", "node", ["frontend/server.js"], 5173]
];

const children = [];
let shuttingDown = false;

for (const [name, command, args, port] of processes) {
  const child = spawn(command, args, {
    stdio: "pipe",
    shell: false,
    env: process.env
  });

  children.push(child);

  child.stdout.on("data", (data) => {
    process.stdout.write(`[${name}] ${data}`);
  });

  child.stderr.on("data", (data) => {
    const text = String(data);
    process.stderr.write(`[${name}] ${text}`);

    if (text.includes("EADDRINUSE")) {
      const envName = name === "后端" ? "BACKEND_PORT" : "FRONTEND_PORT";
      console.error(`[${name}] 端口 ${port} 已被占用。请关闭旧服务，或临时设置 ${envName} 使用其他端口。`);
    }
  });

  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[${name}] 进程退出，代码：${code}`);
      shutdown(1);
    }
  });
}

function shutdown(code) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => {
  shutdown(0);
});
process.on("SIGTERM", () => {
  shutdown(0);
});
