import crypto from "node:crypto";

import { SESSION_CONFIG } from "../config.js";
import {
  createAnonymousUserSession,
  findUserBySessionTokenHash
} from "../repositories/user-repository.js";
import { createSessionRecord, deleteSessionRecord } from "../repositories/account-repository.js";
import { authenticateAccount, registerAccountForUser } from "./account-service.js";

export async function requireUserSession(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const existingToken = cookies[SESSION_CONFIG.cookieName];
  if (existingToken) {
    const session = await findUserBySessionTokenHash(hashToken(existingToken));
    if (session) return publicSession(session);
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_CONFIG.ttlDays * 24 * 60 * 60 * 1000);
  const session = await createAnonymousUserSession(hashToken(token), expiresAt);
  res.setHeader("Set-Cookie", serializeSessionCookie(token, expiresAt));
  return { userId: session.userId, sessionId: session.sessionId, userType: "anonymous" };
}

export async function registerCurrentSession(req, res, value) {
  const session = await requireUserSession(req, res);
  const account = await registerAccountForUser(session.userId, value);
  return { ok: true, ...account };
}

export async function loginSession(res, value) {
  const account = await authenticateAccount(value);
  const session = await issueSession(account.userId, res);
  return { ok: true, ...account, sessionId: session.sessionId };
}

export async function logoutSession(req, res) {
  const token = parseCookies(req.headers.cookie || "")[SESSION_CONFIG.cookieName];
  if (token) await deleteSessionRecord(hashToken(token));
  res.setHeader("Set-Cookie", clearSessionCookie());
  return { ok: true };
}

async function issueSession(userId, res) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_CONFIG.ttlDays * 24 * 60 * 60 * 1000);
  const session = await createSessionRecord(userId, hashToken(token), expiresAt);
  res.setHeader("Set-Cookie", serializeSessionCookie(token, expiresAt));
  return session;
}

function publicSession(session) {
  return {
    userId: session.user_id,
    sessionId: session.session_id,
    userType: session.user_type,
    displayName: session.display_name || null,
    username: session.username || null
  };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(header) {
  return Object.fromEntries(header.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [part.trim(), ""];
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      return [key, decodeURIComponent(value)];
    } catch {
      return [key, value];
    }
  }).filter(([key]) => key));
}

function serializeSessionCookie(token, expiresAt) {
  const parts = [
    `${SESSION_CONFIG.cookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
    `Max-Age=${SESSION_CONFIG.ttlDays * 24 * 60 * 60}`
  ];
  if (SESSION_CONFIG.secure) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie() {
  const parts = [
    `${SESSION_CONFIG.cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0"
  ];
  if (SESSION_CONFIG.secure) parts.push("Secure");
  return parts.join("; ");
}
