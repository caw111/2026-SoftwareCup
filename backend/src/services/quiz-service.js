import { evaluateAnswer } from "../judge.js";
import {
  createQuizAttemptRecord,
  createQuizSessionRecord,
  getQuizQuestionForUser
} from "../repositories/quiz-repository.js";

export async function saveGeneratedQuizForUser(userId, planId, generated, roundNumber) {
  const created = await createQuizSessionRecord(userId, planId, {
    roundNumber,
    mode: generated.mode,
    summary: generated.source,
    quiz: generated.quiz
  });
  if (!created) {
    const error = new Error("学习方案不存在");
    error.statusCode = 404;
    throw error;
  }
  return { ...generated, quiz: created.quiz, sessionId: created.sessionId };
}

export async function evaluateStoredQuestionForUser(userId, questionId, answer) {
  const stored = await getQuizQuestionForUser(userId, questionId);
  if (!stored) {
    const error = new Error("测评题不存在");
    error.statusCode = 404;
    throw error;
  }
  const result = await evaluateAnswer({ question: stored.question, answer });
  await createQuizAttemptRecord(userId, questionId, answer, result);
  return { ...result, planId: stored.plan_id };
}
