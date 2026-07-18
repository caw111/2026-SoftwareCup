import { FRONTEND_ORIGINS } from "./config.js";

export function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && FRONTEND_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

export function readJson(req, { maxBytes = 5 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let data = "";
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      data += chunk;
      if (Buffer.byteLength(data, "utf8") > maxBytes) {
        rejected = true;
        const error = new Error("请求体过大");
        error.statusCode = 413;
        reject(error);
      }
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("JSON 格式不正确"));
      }
    });
  });
}
