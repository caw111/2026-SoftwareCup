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
import {
  applyPathRevisionForUser,
  evaluatePathReplanningForUser,
  getPathRevisionForUser,
  listPathRevisionsForUser,
  recordLearningEventForUser,
  rejectPathRevisionForUser,
  undoPathRevisionForUser
} from "./src/services/path-replanning-service.js";
import { requireUserSession } from "./src/services/session-service.js";
import { getStorageStatus, readWorkspaceState, writeWorkspaceState, storagePublicConfig } from "./src/storage.js";
import { clean, ensureArray } from "./src/utils.js";
import { evaluateDiagnosticPretest } from "./src/adaptive-learning.js";
import {
  advanceProfileInterviewWithLlm,
  createProfileInterviewSession
} from "./src/services/profile-interview-service.js";
import {
  answerGroundedQuestion,
  answerSourceQuestionForUser
} from "./src/services/rag-answer-service.js";
import {
  deleteSourceForUser,
  listSourcesForUser,
  loadFullSourceContextForUser,
  replacePlanSourcesForUser,
  searchSourcesForUser,
  uploadSourceForUser
} from "./src/services/source-service.js";
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

    if (req.method === "GET" && url.pathname === "/api/profile/interview") {
      sendJson(res, 200, createProfileInterviewSession());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/profile/interview") {
      const body = await readJson(req);
      sendJson(res, 200, await advanceProfileInterviewWithLlm({
        message: body.message,
        draft: body.draft,
        messages: body.messages
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/sources") {
      const session = await databaseSession(req, res);
      const sources = await listSourcesForUser(session.userId, url.searchParams.get("planId"));
      sendJson(res, 200, { sources });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sources") {
      const session = await databaseSession(req, res);
      const result = await uploadSourceForUser(
        session.userId,
        await readJson(req, { maxBytes: 17 * 1024 * 1024 })
      );
      sendJson(res, result.deduplicated ? 200 : 201, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sources/search") {
      const session = await databaseSession(req, res);
      sendJson(res, 200, await searchSourcesForUser(session.userId, await readJson(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sources/ask") {
      const session = await databaseSession(req, res);
      sendJson(res, 200, await answerSourceQuestionForUser(session.userId, await readJson(req)));
      return;
    }

    const sourceMatch = url.pathname.match(/^\/api\/sources\/([^/]+)$/);
    if (req.method === "DELETE" && sourceMatch) {
      const session = await databaseSession(req, res);
      sendJson(res, 200, await deleteSourceForUser(session.userId, decodePart(sourceMatch[1])));
      return;
    }

    const planSourcesMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/sources$/);
    if (req.method === "PUT" && planSourcesMatch) {
      const session = await databaseSession(req, res);
      const body = await readJson(req);
      sendJson(res, 200, await replacePlanSourcesForUser(
        session.userId,
        decodePart(planSourcesMatch[1]),
        body.sourceIds
      ));
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
      const planId = decodePart(taskMatch[1]);
      const taskKey = decodePart(taskMatch[2]);
      const result = await updateTaskProgressForUser(
        session.userId,
        planId,
        taskKey,
        body.completed
      );
      await recordLearningEventForUser(session.userId, planId, {
        type: body.completed ? "task_completed" : "task_reopened",
        eventKey: `task-progress:${taskKey}:${Boolean(body.completed)}`,
        payload: { taskKey, completed: Boolean(body.completed) }
      });
      sendJson(res, 200, result);
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

    const pathRevisionsMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/path-revisions$/);
    if (req.method === "GET" && pathRevisionsMatch) {
      const session = await databaseSession(req, res);
      sendJson(res, 200, await listPathRevisionsForUser(
        session.userId,
        decodePart(pathRevisionsMatch[1])
      ));
      return;
    }

    const replanMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/replanning\/evaluate$/);
    if (req.method === "POST" && replanMatch) {
      const session = await databaseSession(req, res);
      const body = await readJson(req);
      sendJson(res, 200, await evaluatePathReplanningForUser(
        session.userId,
        decodePart(replanMatch[1]),
        {
          triggerType: body.triggerType || "manual",
          payload: body.payload || {},
          eventKey: body.eventKey,
          force: Boolean(body.force)
        }
      ));
      return;
    }

    const pathRevisionActionMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/path-revisions\/([^/]+)(?:\/(apply|reject|undo))?$/);
    if (pathRevisionActionMatch) {
      const session = await databaseSession(req, res);
      const planId = decodePart(pathRevisionActionMatch[1]);
      const revisionId = decodePart(pathRevisionActionMatch[2]);
      const action = pathRevisionActionMatch[3] || "";
      if (req.method === "GET" && !action) {
        sendJson(res, 200, await getPathRevisionForUser(session.userId, planId, revisionId));
        return;
      }
      if (req.method === "POST" && action === "apply") {
        sendJson(res, 200, await applyPathRevisionForUser(session.userId, planId, revisionId));
        return;
      }
      if (req.method === "POST" && action === "reject") {
        sendJson(res, 200, await rejectPathRevisionForUser(session.userId, planId, revisionId));
        return;
      }
      if (req.method === "POST" && action === "undo") {
        sendJson(res, 200, await undoPathRevisionForUser(session.userId, planId, revisionId));
        return;
      }
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
      const input = await groundedInput(req, res, await readJson(req));
      const result = await generateLearningPlan(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate-stream") {
      const input = await groundedInput(req, res, await readJson(req));
      await streamLearningPlan(res, input);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/daily-materials") {
      const body = await readJson(req);
      const input = await groundedInput(req, res, body.input || {}, [
        body.day?.title,
        body.day?.focus,
        ...ensureArray(body.day?.tasks, [])
      ].filter(Boolean).join(" "));
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
      if (result.planId) {
        await recordLearningEventForUser(session.userId, result.planId, {
          type: "quiz_attempt_evaluated",
          eventKey: `quiz-attempt:${attemptMatch[1]}:${Date.now()}`,
          payload: {
            questionId: decodePart(attemptMatch[1]),
            correct: result.correct,
            score: result.score,
            maxScore: result.maxScore,
            dimension: result.dimension
          }
        });
        if (result.correct === false) {
          await evaluatePathReplanningForUser(session.userId, result.planId, {
            triggerType: "quiz_attempt_evaluated",
            recordEvent: false
          });
        }
      }
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
      let grounding = null;
      if (ensureArray(body.sourceIds, []).length || body.planId) {
        const session = await databaseSession(req, res);
        grounding = await loadFullSourceContextForUser(session.userId, {
          sourceIds: body.sourceIds,
          planId: body.planId
        });
      }
      const question = clean(body.question, 1000);
      const tutorMode = clean(body.mode, 30);
      const hintLevel = Number(body.hintLevel || 1);
      const history = ensureArray(body.history, []).slice(-8);
      const result = grounding?.citations?.length
        ? await answerGroundedQuestion({
          question,
          grounding,
          context: clean(body.context, 5000),
          history,
          persona: "tutor",
          tutorMode,
          hintLevel
        })
        : await answerTutorQuestion({
          question,
          context: clean(body.context, 5000),
          mode: tutorMode,
          hintLevel,
          history
        });
      sendJson(res, 200, { ...result, citations: result.citations || [] });
      return;
    }

    sendJson(res, 404, { message: "接口不存在" });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    sendJson(res, status, {
      message: status >= 500 ? "服务端处理失败" : error.message,
      detail: error instanceof Error ? error.message : String(error),
      ...(error?.source ? { source: error.source } : {})
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

async function groundedInput(req, res, value, queryOverride = "") {
  const input = normalizeInput(value || {});
  if (!input.knowledgeSourceIds.length) return input;
  const session = await databaseSession(req, res);
  const grounding = await loadFullSourceContextForUser(session.userId, {
    sourceIds: input.knowledgeSourceIds
  });
  const sources = (await listSourcesForUser(session.userId))
    .filter((source) => input.knowledgeSourceIds.includes(source.id));
  return {
    ...input,
    knowledgeSources: sources.map(({ checksum, metadata, ...source }) => source),
    knowledgeGrounding: {
      context: grounding.context,
      citations: grounding.citations,
      instruction: grounding.instruction,
      mode: grounding.mode,
      sourceCount: grounding.sourceCount,
      loadedChunks: grounding.loadedChunks,
      fullContextChars: grounding.fullContextChars,
      searchedChunks: 0
    }
  };
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
