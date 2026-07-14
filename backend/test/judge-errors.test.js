import assert from "node:assert/strict";
import test from "node:test";

import { friendlyJudgeError } from "../src/judge.js";

test("judge reports registry failures separately from engine failures", () => {
  const registryError = new Error(
    "docker build failed: failed to resolve source metadata: 401 Unauthorized"
  );
  const engineError = new Error(
    "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine"
  );

  assert.match(friendlyJudgeError(registryError), /镜像拉取失败/);
  assert.match(friendlyJudgeError(engineError), /容器运行时不可用/);
});
