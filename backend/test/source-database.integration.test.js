import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";

import { closeDatabasePool, getDatabasePool, isDatabaseConfigured } from "../src/db/pool.js";
import { createAnonymousUserSession } from "../src/repositories/user-repository.js";
import { createPlanForUser, getWorkspaceForUser } from "../src/services/plan-service.js";
import {
  deleteSourceForUser,
  listSourcesForUser,
  replacePlanSourcesForUser,
  searchSourcesForUser,
  uploadSourceForUser
} from "../src/services/source-service.js";
import { migrateDatabase } from "../../scripts/migrate.js";

const configured = isDatabaseConfigured();
let testUserId;

test("MySQL 持久化课程资料、分块、RAG 引用与课程绑定", { skip: !configured }, async () => {
  await migrateDatabase({ log: () => {} });
  const session = await createAnonymousUserSession(
    crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex"),
    new Date(Date.now() + 60_000)
  );
  testUserId = session.userId;
  const markdown = [
    "# 梯度下降",
    "梯度下降沿损失函数的负梯度方向更新参数，学习率控制每一步的长度。",
    "",
    "## 学习率选择",
    "学习率过大会导致震荡甚至发散，学习率过小会导致收敛缓慢。可以使用学习率衰减。"
  ].join("\n");
  const uploaded = await uploadSourceForUser(testUserId, {
    filename: "优化方法.md",
    mimeType: "text/markdown",
    contentBase64: Buffer.from(markdown).toString("base64")
  });

  assert.equal(uploaded.source.status, "ready");
  assert.equal(uploaded.source.chunkCount >= 2, true);
  const duplicate = await uploadSourceForUser(testUserId, {
    filename: "重复文件名.md",
    contentBase64: Buffer.from(markdown).toString("base64")
  });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.source.id, uploaded.source.id);

  const search = await searchSourcesForUser(testUserId, {
    sourceIds: [uploaded.source.id],
    query: "学习率太大会发生什么？"
  });
  assert.equal(search.citations.length > 0, true);
  assert.equal(search.citations[0].sourceId, uploaded.source.id);
  assert.match(search.citations[0].quote, /学习率|震荡/);

  const plan = await createPlanForUser(testUserId, {
    id: `source-plan-${crypto.randomUUID()}`,
    title: "资料增强课程",
    data: {
      input: {
        topic: "优化方法",
        knowledgeSourceIds: [uploaded.source.id],
        knowledgeSources: [uploaded.source]
      },
      dailyPlan: [{ day: 1, tasks: ["解释学习率"] }]
    }
  });
  const listed = await listSourcesForUser(testUserId, plan.id);
  assert.equal(listed.find((source) => source.id === uploaded.source.id)?.linked, true);

  await replacePlanSourcesForUser(testUserId, plan.id, []);
  let workspace = await getWorkspaceForUser(testUserId);
  assert.deepEqual(workspace.plans[0].data.input.knowledgeSourceIds, []);

  await replacePlanSourcesForUser(testUserId, plan.id, [uploaded.source.id]);
  await deleteSourceForUser(testUserId, uploaded.source.id);
  workspace = await getWorkspaceForUser(testUserId);
  assert.deepEqual(workspace.plans[0].data.input.knowledgeSourceIds, []);
  assert.equal((await listSourcesForUser(testUserId)).length, 0);
});

after(async () => {
  if (!configured) return;
  if (testUserId) await getDatabasePool().execute("DELETE FROM users WHERE id = ?", [testUserId]);
  await closeDatabasePool();
});
