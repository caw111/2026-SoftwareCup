import http from "node:http";
import { PORT, JUDGE_AUTO_BOOTSTRAP, publicModelConfig } from "./src/config.js";
import { agents } from "./src/agents.js";
import { setCors, sendJson, readJson } from "./src/http.js";
import { getStorageStatus, readWorkspaceState, writeWorkspaceState, storagePublicConfig } from "./src/storage.js";
import { testLargeModelConnection, answerTutorQuestion } from "./src/llm.js";
import { normalizeInput, generateLearningPlan, streamLearningPlan, runLocalAgents, generateAdaptiveQuiz, summarizeProgress } from "./src/learning.js";
import { evaluateAnswer, getJudgeStatus, bootstrapJudgeRuntime, friendlyJudgeError } from "./src/judge.js";
import { clean, ensureArray } from "./src/utils.js";

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        status: "ok",
        service: "个性化资源生成与学习多智能体后端",
        llmEnabled: Boolean(publicModelConfig().enabled),
        llm: publicModelConfig(),
        storage: storagePublicConfig(),
        time: new Date().toISOString()
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/llm-test") {
      const result = await testLargeModelConnection();
      sendJson(res, result.ok ? 200 : 503, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/agents") {
      sendJson(res, 200, { agents });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/storage/status") {
      const status = await getStorageStatus();
      sendJson(res, status.ok ? 200 : 503, status);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/judge/status") {
      const status = await getJudgeStatus();
      sendJson(res, status.ok ? 200 : 503, status);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workspace-state") {
      sendJson(res, 200, await readWorkspaceState());
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/workspace-state") {
      const body = await readJson(req);
      const saved = await writeWorkspaceState(body);
      sendJson(res, 200, saved);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const input = normalizeInput(await readJson(req));
      const result = await generateLearningPlan(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate-stream") {
      const input = normalizeInput(await readJson(req));
      await streamLearningPlan(res, input);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/quiz") {
      const body = await readJson(req);
      const input = normalizeInput(body.input || {});
      const plan = body.plan || runLocalAgents(input);
      const progress = body.progress || {};
      const history = ensureArray(body.history, []);
      const quizResult = await generateAdaptiveQuiz(input, plan, progress, Number(body.variant || 0), history);
      sendJson(res, 200, { ...quizResult, generatedAt: new Date().toISOString(), source: summarizeProgress(plan, progress) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/evaluate") {
      const body = await readJson(req);
      const result = await evaluateAnswer(body);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tutor") {
      const body = await readJson(req);
      const result = await answerTutorQuestion({
        question: clean(body.question, 1000),
        context: clean(body.context, 5000)
      });
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { message: "接口不存在" });
  } catch (error) {
    sendJson(res, 500, {
      message: "服务端处理失败",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(PORT, () => {
  console.log(`API 服务已启动：http://localhost:${PORT}`);
  if (JUDGE_AUTO_BOOTSTRAP) {
    bootstrapJudgeRuntime().catch((error) => {
      console.warn(`判题沙箱自举失败：${friendlyJudgeError(error)}`);
    });
  }
});
