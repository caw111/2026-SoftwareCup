import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeDatabasePool, getDatabasePool, isDatabaseConfigured } from "../backend/src/db/pool.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_DIR = path.join(ROOT, "database", "migrations");

export async function migrateDatabase({ log = console.log } = {}) {
  if (!isDatabaseConfigured()) {
    throw new Error("MySQL 未配置，无法执行迁移");
  }

  const pool = getDatabasePool();
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK('softwarecup_schema_migrations', 30) AS acquired");
    locked = Number(lockRows[0]?.acquired) === 1;
    if (!locked) throw new Error("等待数据库迁移锁超时");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        checksum CHAR(64) NOT NULL,
        executed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const files = migrationFiles();
    const [appliedRows] = await connection.query(
      "SELECT version, filename, checksum FROM schema_migrations ORDER BY version"
    );
    const applied = new Map(appliedRows.map((row) => [row.version, row]));

    for (const filename of files) {
      const version = filename.match(/^(\d+)/)?.[1];
      const sql = fs.readFileSync(path.join(MIGRATION_DIR, filename), "utf8");
      const checksum = migrationChecksum(sql);
      const legacyChecksum = legacyMigrationChecksum(sql);
      const previous = applied.get(version);
      if (previous) {
        const checksumMatches = previous.checksum === checksum || previous.checksum === legacyChecksum;
        const appliedWithSameChecksum = appliedRows.find((row) => (
          row.checksum === checksum || row.checksum === legacyChecksum
        ));
        if (!checksumMatches && appliedWithSameChecksum) {
          log(
            `跳过已按历史编号执行的迁移 ${filename}，原记录为 ${appliedWithSameChecksum.filename}`
          );
          continue;
        }
        if (previous.filename !== filename || !checksumMatches) {
          throw new Error(`迁移 ${version} 已执行，但文件名或校验值发生变化`);
        }
        if (previous.checksum !== checksum) {
          await connection.execute(
            "UPDATE schema_migrations SET checksum = ? WHERE version = ?",
            [checksum, version]
          );
        }
        continue;
      }

      log(`执行数据库迁移 ${filename}`);
      for (const statement of splitSqlStatements(sql)) {
        await connection.query(statement);
      }
      await connection.execute(
        "INSERT INTO schema_migrations (version, filename, checksum) VALUES (?, ?, ?)",
        [version, filename, checksum]
      );
    }

    return { ok: true, total: files.length, applied: applied.size };
  } finally {
    if (locked) {
      await connection.query("SELECT RELEASE_LOCK('softwarecup_schema_migrations')");
    }
    connection.release();
  }
}

export async function databaseMigrationStatus() {
  const pool = getDatabasePool();
  const [rows] = await pool.query(
    `SELECT version, filename, checksum, executed_at
       FROM schema_migrations
      ORDER BY version`
  );
  return rows;
}

export function migrationFiles() {
  return fs.readdirSync(MIGRATION_DIR)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "en"));
}

export function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function migrationChecksum(sql) {
  return crypto.createHash("sha256")
    .update(normalizeMigrationSql(sql))
    .digest("hex");
}

export function legacyMigrationChecksum(sql) {
  return crypto.createHash("sha256")
    .update(String(sql))
    .digest("hex");
}

function normalizeMigrationSql(sql) {
  return String(sql).replace(/\r\n?/g, "\n");
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const statusOnly = process.argv.includes("--status");
  try {
    if (statusOnly) {
      const rows = await databaseMigrationStatus();
      console.table(rows);
    } else {
      const result = await migrateDatabase();
      console.log(`数据库迁移完成，共发现 ${result.total} 个迁移文件。`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}
