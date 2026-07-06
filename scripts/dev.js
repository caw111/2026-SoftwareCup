import { spawn } from "node:child_process";

const processes = [
  ["后端", "node", ["backend/server.js"]],
  ["前端", "node", ["frontend/server.js"]]
];

const children = [];

for (const [name, command, args] of processes) {
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
    process.stderr.write(`[${name}] ${data}`);
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[${name}] 进程退出，代码：${code}`);
      shutdown();
    }
  });
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(1);
}

process.on("SIGINT", () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(0);
});
