import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { friendlyJudgeError } from "../src/judge.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

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

test("python judge keeps student print output out of its JSON protocol", () => {
  const payload = {
    language: "python",
    code: "print('module debug')\ndef solve(x):\n    print('case debug', x)\n    return x + 1",
    tests: [{ function: "solve", args: [1], expected: 2 }]
  };
  const completed = spawnSync("python", [
    path.resolve(TEST_DIR, "../judge/python/run_python.py")
  ], {
    input: JSON.stringify(payload),
    encoding: "utf8"
  });

  assert.equal(completed.status, 0, completed.stderr);
  const result = JSON.parse(completed.stdout);
  assert.equal(result.passed, 1);
  assert.equal(result.results[0].stdout, "case debug 1");
});
