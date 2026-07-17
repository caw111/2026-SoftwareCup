import http from "node:http";

import { agents } from "./src/agents.js";
import { PORT, JUDGE_AUTO_BOOTSTRAP, publicModelConfig } from "./src/config.js";
import {
  checkDatabaseConnection,
  closeDatabasePool,
  isDatabaseConfigured
} from "./src/db/pool.js";
import { setCors, sendJson, readJson } from "./src/http.js";
import { friendlyJudgeError, getJudgeStatus, bootstrapJudgeRuntime } from "./src/judge.js";
import {
  generateAdaptiveQuiz,
  generateDailyLearningMaterials,
  generateLearningReportWithLlm,
  generateLearningPlan,
  normalizeInput,
  runLocalAgents,
  streamLearningPlan,
  summarizeProgress
} from "./src/learning.js";
import { answerTutorQuestion, testLargeModelConnection } from "./src/llm.js";
import {
  createPlanForUser,
  claimServerLegacyWorkspaceForUser,
  deletePlanForUser,
  getWorkspaceForUser,
  importLegacyWorkspaceForUser,
  resetPlanProgressForUser,
  setActivePlanForUser,
  updatePlanContentForUser,
  updatePlanNotesForUser,
  updateTaskProgressForUser
} from "./src/services/plan-service.js";
import {
  evaluateStoredQuestionForUser,
  saveGeneratedQuizForUser
} from "./src/services/quiz-service.js";
import { requireUserSession } from "./src/services/session-service.js";
import { getStorageStatus, readWorkspaceState, writeWorkspaceState, storagePublicConfig } from "./src/storage.js";
import { clean, ensureArray } from "./src/utils.js";
import { evaluateDiagnosticPretest } from "./src/adaptive-learning.js";
import { migrateDatabase } from "../scripts/migrate.js";

const server = http.createServer(async (req, res) => {
  setCors(req, res);

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
        database: await checkDatabaseConnection(),
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
      const status = isDatabaseConfigured()
        ? await checkDatabaseConnection()
        : await getStorageStatus();
      sendJson(res, status.ok ? 200 : 503, status);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/judge/status") {
      const status = await getJudgeStatus();
      sendJson(res, status.ok ? 200 : 503, status);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workspace") {
      const session = await databaseSession(req, res);
      let workspace = await getWorkspaceForUser(session.userId);
      if (!workspace.plans.length) {
        const claimed = await claimServerLegacyWorkspaceForUser(
          session.userId,
          await readWorkspaceState()
        );
        if (claimed) workspace = await getWorkspaceForUser(session.userId);
      }
      sendJson(res, 200, workspace);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/import") {
      const session = await databaseSession(req, res);
      const result = await importLegacyWorkspaceForUser(session.userId, await readJson(req));
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/workspace/current-plan") {
      const session = await databaseSession(req, res);
      const body = await readJson(req);
      sendJson(res, 200, await setActivePlanForUser(session.userId, body.planId));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/plans") {
      const session = await databaseSession(req, res);
      const body = await readJson(req);
      const plan = await createPlanForUser(session.userId, body.plan || body);
      sendJson(res, 201, { ok: true, plan });
      return;
    }

    const planMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
    if (req.method === "DELETE" && planMatch) {
      const session = await databaseSession(req, res);
      sendJson(res, 200, await deletePlanForUser(session.userId, decodePart(planMatch[1])));
      return;
    }

    const notesMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/notes$/);
    if (req.method === "PATCH" && notesMatch) {
      const session = await databaseSession(req, res);
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await updatePlanNotesForUser(session.userId, decodePart(notesMatch[1]), body.notes)
      );
      return;
    }

    const contentMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/content$/);
    if (req.method === "PATCH" && contentMatch) {
      const session = await databaseSession(req, res);
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await updatePlanContentForUser(session.userId, decodePart(contentMatch[1]), body)
      );
      return;
    }

    const taskMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/tasks\/([^/]+)$/);
    if (req.method === "PATCH" && taskMatch) {
      const session = await databaseSession(req, res);
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await updateTaskProgressForUser(
          session.userId,
          decodePart(taskMatch[1]),
          decodePart(taskMatch[2]),
          body.completed
        )
      );
      return;
    }

    const progressMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/progress$/);
    if (req.method === "DELETE" && progressMatch) {
      const session = await databaseSession(req, res);
      sendJson(
        res,
        200,
        await resetPlanProgressForUser(session.userId, decodePart(progressMatch[1]))
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workspace-state") {
      if (isDatabaseConfigured()) throw legacyEndpointDisabled();
      sendJson(res, 200, await readWorkspaceState());
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/workspace-state") {
      if (isDatabaseConfigured()) throw legacyEndpointDisabled();
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

    if (req.method === "POST" && url.pathname === "/api/daily-materials") {
      const body = await readJson(req);
      const input = normalizeInput(body.input || {});
      if (!body.day || typeof body.day !== "object") {
        const error = new Error("缺少当日学习路径数据");
        error.statusCode = 400;
        throw error;
      }
      const day = await generateDailyLearningMaterials(input, body.day, body.totalDays);
      sendJson(res, 200, { day });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/learning-report") {
      const body = await readJson(req);
      if (!body.context || typeof body.context !== "object") {
        const error = new Error("缺少当前学习状态快照");
        error.statusCode = 400;
        throw error;
      }
      const report = await generateLearningReportWithLlm(body.context);
      sendJson(res, 200, { report });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/diagnostic/evaluate") {
      const body = await readJson(req);
      const result = evaluateDiagnosticPretest(body.plan || {}, body.answers || {});
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/quiz") {
      const body = await readJson(req);
      const input = normalizeInput(body.input || {});
      const plan = body.plan || runLocalAgents(input);
      const progress = body.progress || {};
      const history = ensureArray(body.history, []);
      const generated = await generateAdaptiveQuiz(
        input,
        plan,
        progress,
        Number(body.variant || 0),
        history,
        body.options || {}
      );
      const quizResult = {
        ...generated,
        generatedAt: new Date().toISOString(),
        source: summarizeProgress(plan, progress)
      };
      if (body.planId) {
        const session = await databaseSession(req, res);
        const saved = await saveGeneratedQuizForUser(
          session.userId,
          body.planId,
          quizResult,
          Number(body.variant || 0)
        );
        sendJson(res, 200, saved);
      } else {
        sendJson(res, 200, quizResult);
      }
      return;
    }

    const attemptMatch = url.pathname.match(/^\/api\/quiz-questions\/([^/]+)\/attempts$/);
    if (req.method === "POST" && attemptMatch) {
      const session = await databaseSession(req, res);
      const body = await readJson(req);
      const result = await evaluateStoredQuestionForUser(
        session.userId,
        decodePart(attemptMatch[1]),
        body.answer
      );
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/evaluate") {
      if (isDatabaseConfigured()) throw legacyEndpointDisabled();
      const body = await readJson(req);
      const { evaluateAnswer } = await import("./src/judge.js");
      sendJson(res, 200, await evaluateAnswer(body));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tutor") {
      const body = await readJson(req);
      const result = await answerTutorQuestion({
        question: clean(body.question, 1000),
        context: clean(body.context, 5000),
        mode: clean(body.mode, 30),
        hintLevel: Number(body.hintLevel || 1),
        history: ensureArray(body.history, []).slice(-8)
      });
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { message: "接口不存在" });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    sendJson(res, status, {
      message: status >= 500 ? "服务端处理失败" : error.message,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

async function databaseSession(req, res) {
  if (!isDatabaseConfigured()) {
    const error = new Error("MySQL 未配置，新数据库接口暂不可用");
    error.statusCode = 503;
    throw error;
  }
  return requireUserSession(req, res);
}

function decodePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    const error = new Error("URL 参数格式不正确");
    error.statusCode = 400;
    throw error;
  }
}

function legacyEndpointDisabled() {
  const error = new Error("数据库模式下已停用旧版整包状态接口");
  error.statusCode = 410;
  return error;
}

async function start() {
  if (isDatabaseConfigured()) await migrateDatabase();
  server.listen(PORT, () => {
    console.log(`API 服务已启动：http://localhost:${PORT}`);
    if (JUDGE_AUTO_BOOTSTRAP) {
      bootstrapJudgeRuntime().catch((error) => {
        console.warn(`判题沙箱自举失败：${friendlyJudgeError(error)}`);
      });
    }
  });
}

async function shutdown() {
  server.close();
  await closeDatabasePool();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((error) => {
  console.error(`后端启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
