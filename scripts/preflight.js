import fs from "node:fs";

import {
  checkDatabaseConnection,
  closeDatabasePool,
  isDatabaseConfigured
} from "../backend/src/db/pool.js";
import { migrateDatabase } from "./migrate.js";

const requiredFiles = [
  "frontend/index.html",
  "frontend/app.js",
  "node_modules/marked/lib/marked.umd.js",
  "node_modules/dompurify/dist/purify.min.js"
];

try {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) throw new Error(`需要 Node.js 20 或更高版本，当前为 ${process.version}`);
  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) throw new Error(`缺少运行文件：${file}，请先执行 npm install`);
  }
  if (!isDatabaseConfigured()) {
    throw new Error("MySQL 未配置，请根据 .env.example 创建 .env.local 后重试");
  }
  await migrateDatabase({ log: (message) => console.log(`[migration] ${message}`) });
  const database = await checkDatabaseConnection();
  if (!database.ok) throw new Error(`MySQL 连接失败：${database.message}`);
  console.log(`启动检查通过：Node ${process.version}，MySQL ${database.version}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
