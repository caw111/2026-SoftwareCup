import mysql from "mysql2/promise";

import { STORAGE_CONFIG } from "../config.js";

let pool;

export function isDatabaseConfigured() {
  return Boolean(
    STORAGE_CONFIG.mysqlUrl
    || (STORAGE_CONFIG.host && STORAGE_CONFIG.user && STORAGE_CONFIG.database)
  );
}

export function getDatabasePool() {
  if (!isDatabaseConfigured()) {
    throw new Error("MySQL 未配置，请设置 MYSQL_URL 或 MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE");
  }
  if (pool) return pool;

  const options = STORAGE_CONFIG.mysqlUrl
    ? connectionOptionsFromUrl(STORAGE_CONFIG.mysqlUrl)
    : {
      host: STORAGE_CONFIG.host,
      port: STORAGE_CONFIG.port,
      user: STORAGE_CONFIG.user,
      password: STORAGE_CONFIG.password,
      database: STORAGE_CONFIG.database
    };

  pool = mysql.createPool({
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
  pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
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
  if (!isDatabaseConfigured()) {
    return { ok: false, configured: false, message: "MySQL 未配置" };
  }
  try {
    const [rows] = await getDatabasePool().query("SELECT DATABASE() AS database_name, VERSION() AS version");
    return {
      ok: true,
      configured: true,
      database: rows[0]?.database_name,
      version: rows[0]?.version
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
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
