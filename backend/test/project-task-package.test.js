import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeInput, runLocalAgents } from "../src/learning.js";

const onlineReadingRecommendations = [
  {
    title: "Scikit-learn: Machine Learning in Python",
    authors: ["Fabian Pedregosa"],
    year: 2011,
    venue: "Journal of Machine Learning Research",
    url: "https://jmlr.org/papers/v12/pedregosa11a.html",
    provider: "JMLR",
    citationCount: 60000
  },
  {
    title: "Random Forests",
    authors: ["Leo Breiman"],
    year: 2001,
    venue: "Machine Learning",
    doi: "10.1023/A:1010933404324",
    url: "https://doi.org/10.1023/A:1010933404324",
    provider: "Crossref",
    citationCount: 114000
  },
  {
    title: "A Survey on Transfer Learning",
    authors: ["Sinno Pan", "Qiang Yang"],
    year: 2010,
    venue: "IEEE TKDE",
    doi: "10.1109/TKDE.2009.191",
    url: "https://doi.org/10.1109/TKDE.2009.191",
    provider: "Crossref",
    citationCount: 19000
  }
];

test("代码实操项目包的起始文件可以真实运行并通过单元测试", async () => {
  const plan = runLocalAgents(normalizeInput({
    topic: "机器学习基础",
    goal: "完成校园能耗预测项目",
    level: "Python 入门",
    duration: "2周",
    style: "项目实战",
    onlineReadingRecommendations
  }));
  const task = plan.projectTasks[0];
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "software-cup-project-"));

  for (const file of task.starterFiles) {
    const target = path.join(workdir, file.filename);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content || "", "utf8");
  }

  execFileSync("python", ["src/pipeline.py", "--data", "sample_data.csv", "--out", "artifacts/metrics.json"], {
    cwd: workdir,
    stdio: "pipe"
  });
  execFileSync("python", ["-m", "unittest", "discover", "-s", "tests"], {
    cwd: workdir,
    stdio: "pipe"
  });

  const metrics = JSON.parse(await fs.readFile(path.join(workdir, "artifacts", "metrics.json"), "utf8"));
  assert.equal(metrics.baseline, "mean_target");
  assert.equal(typeof metrics.mae, "number");
  assert.equal(typeof metrics.rmse, "number");
});
