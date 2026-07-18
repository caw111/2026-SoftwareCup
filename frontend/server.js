import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.FRONTEND_PORT || 5173);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const vendorFiles = new Map([
  ["/vendor/marked.js", path.join(projectRoot, "node_modules", "marked", "lib", "marked.umd.js")],
  ["/vendor/dompurify.js", path.join(projectRoot, "node_modules", "dompurify", "dist", "purify.min.js")]
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      proxyApiRequest(req, res);
      return;
    }
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const filePath = vendorFiles.get(url.pathname) || path.join(__dirname, normalized);
    const ext = path.extname(filePath);
    const data = await fs.readFile(filePath);

    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("页面不存在");
  }
});

function proxyApiRequest(req, res) {
  const proxy = http.request({
    hostname: "127.0.0.1",
    port: BACKEND_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${BACKEND_PORT}`
    }
  }, (proxyResponse) => {
    res.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
    proxyResponse.pipe(res);
  });
  proxy.on("error", () => {
    if (res.headersSent) return res.end();
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ message: "本地后端服务暂未就绪" }));
  });
  req.pipe(proxy);
}

server.listen(PORT, () => {
  console.log(`前端页面已启动：http://localhost:${PORT}`);
});
