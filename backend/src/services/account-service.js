import crypto from "node:crypto";
import { promisify } from "node:util";

import { createAccountRecord, findAccountByUsername } from "../repositories/account-repository.js";

const scrypt = promisify(crypto.scrypt);

export async function registerAccountForUser(userId, value) {
  const username = normalizeUsername(value?.username);
  const password = normalizePassword(value?.password);
  const displayName = normalizeDisplayName(value?.displayName, username);
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = (await scrypt(password, passwordSalt, 64)).toString("hex");
  return createAccountRecord(userId, { username, displayName, passwordSalt, passwordHash });
}

export async function authenticateAccount(value) {
  const username = normalizeUsername(value?.username);
  const password = normalizePassword(value?.password);
  const account = await findAccountByUsername(username);
  if (!account) throw invalidCredentials();
  const actual = await scrypt(password, account.password_salt, 64);
  const expected = Buffer.from(account.password_hash, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw invalidCredentials();
  }
  return {
    userId: account.user_id,
    userType: account.user_type,
    username: account.username,
    displayName: account.display_name
  };
}

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) {
    throw httpError(400, "用户名需为 3-32 位字母、数字、点、短横线或下划线");
  }
  return username;
}

function normalizePassword(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 128) throw httpError(400, "密码长度需为 8-128 位");
  return password;
}

function normalizeDisplayName(value, fallback) {
  return String(value || fallback).trim().slice(0, 100) || fallback;
}

function invalidCredentials() {
  return httpError(401, "用户名或密码错误");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
