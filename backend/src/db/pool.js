import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import mysql from "mysql2/promise";

import { PROJECT_ROOT, SQLITE_FILE, STORAGE_CONFIG } from "../config.js";

let pool;

export function isMysqlConfigured() {
  return Boolean(
    STORAGE_CONFIG.mysqlUrl
    || (STORAGE_CONFIG.host && STORAGE_CONFIG.user && STORAGE_CONFIG.database)
  );
}

export function databaseDialect() {
  return isMysqlConfigured() ? "mysql" : "sqlite";
}

export function isDatabaseConfigured() {
  return true;
}

export function getDatabasePool() {
  if (pool) return pool;
  pool = isMysqlConfigured() ? createMysqlPool() : createSqlitePool();
  return pool;
}

export async function withTransaction(work) {
  const connection = await getDatabasePool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function checkDatabaseConnection() {
  try {
    if (databaseDialect() === "sqlite") {
      const [rows] = await getDatabasePool().query("SELECT sqlite_version() AS version");
      return {
        ok: true,
        configured: true,
        dialect: "sqlite",
        database: SQLITE_FILE,
        version: rows[0]?.version
      };
    }
    const [rows] = await getDatabasePool().query("SELECT DATABASE() AS database_name, VERSION() AS version");
    return {
      ok: true,
      configured: true,
      dialect: "mysql",
      database: rows[0]?.database_name,
      version: rows[0]?.version
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      dialect: databaseDialect(),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function closeDatabasePool() {
  if (!pool) return;
  const activePool = pool;
  pool = undefined;
  await activePool.end();
}

function createMysqlPool() {
  const options = STORAGE_CONFIG.mysqlUrl
    ? connectionOptionsFromUrl(STORAGE_CONFIG.mysqlUrl)
    : {
      host: STORAGE_CONFIG.host,
      port: STORAGE_CONFIG.port,
      user: STORAGE_CONFIG.user,
      password: STORAGE_CONFIG.password,
      database: STORAGE_CONFIG.database
    };
  const mysqlPool = mysql.createPool({
    ...options,
    waitForConnections: true,
    connectionLimit: STORAGE_CONFIG.connectionLimit,
    queueLimit: 0,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: false,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });
  mysqlPool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
  return mysqlPool;
}

function createSqlitePool() {
  fs.mkdirSync(path.dirname(SQLITE_FILE), { recursive: true });
  const database = new DatabaseSync(SQLITE_FILE);
  const schema = fs.readFileSync(path.join(PROJECT_ROOT, "database", "sqlite-schema.sql"), "utf8");
  database.exec(schema);
  return new SqlitePool(database);
}

class SqlitePool {
  constructor(database) {
    this.database = database;
  }

  async execute(sql, params = []) {
    return executeSqlite(this.database, sql, params);
  }

  async query(sql, params = []) {
    return executeSqlite(this.database, sql, params);
  }

  async getConnection() {
    return new SqliteConnection(this.database);
  }

  async end() {
    this.database.close();
  }
}

class SqliteConnection extends SqlitePool {
  async beginTransaction() {
    this.database.exec("BEGIN IMMEDIATE");
  }

  async commit() {
    this.database.exec("COMMIT");
  }

  async rollback() {
    if (this.database.isTransaction) this.database.exec("ROLLBACK");
  }

  release() {}
}

function executeSqlite(database, sql, params) {
  const normalizedSql = String(sql)
    .replace(/CURRENT_TIMESTAMP\(3\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\s+FOR\s+UPDATE\b/gi, "");
  const statement = database.prepare(normalizedSql);
  const values = params.map(normalizeSqliteValue);
  if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(normalizedSql)) {
    return [statement.all(...values), []];
  }
  const result = statement.run(...values);
  return [{
    affectedRows: Number(result.changes || 0),
    insertId: Number(result.lastInsertRowid || 0)
  }, []];
}

function normalizeSqliteValue(value) {
  if (value instanceof Date) return value.toISOString().replace("T", " ").replace("Z", "");
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

function connectionOptionsFromUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "mysql:") throw new Error("MYSQL_URL 必须使用 mysql:// 协议");
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\/+/, ""))
  };
}
