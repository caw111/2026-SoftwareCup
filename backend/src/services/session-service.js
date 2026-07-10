import crypto from "node:crypto";

import { SESSION_CONFIG } from "../config.js";
import {
  createAnonymousUserSession,
  findUserBySessionTokenHash
} from "../repositories/user-repository.js";

export async function requireUserSession(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const existingToken = cookies[SESSION_CONFIG.cookieName];
  if (existingToken) {
    const session = await findUserBySessionTokenHash(hashToken(existingToken));
    if (session) return { userId: session.user_id, sessionId: session.session_id };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_CONFIG.ttlDays * 24 * 60 * 60 * 1000);
  const session = await createAnonymousUserSession(hashToken(token), expiresAt);
  res.setHeader("Set-Cookie", serializeSessionCookie(token, expiresAt));
  return { userId: session.userId, sessionId: session.sessionId };
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
