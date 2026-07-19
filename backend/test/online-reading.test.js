import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOnlineReadingQueries,
  collectOnlineReadingRecommendations
} from "../src/online-reading.js";

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => String(body)
  };
}

test("在线拓展阅读从成熟资料元数据源生成且必须带 URL 或 DOI", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    calls.push(parsed.hostname);
    if (parsed.hostname.includes("openalex")) {
      return response({
        results: [
          {
            id: "https://openalex.org/W1",
            doi: "https://doi.org/10.5555/example",
            display_name: "A Mature Survey of Machine Learning Evaluation",
            publication_year: 2021,
            cited_by_count: 320,
            authorships: [{ author: { display_name: "Ada Scholar" } }],
            primary_location: {
              landing_page_url: "https://doi.org/10.5555/example",
              source: { display_name: "Journal of Reliable AI", host_organization_name: "Example Publisher" }
            },
            abstract_inverted_index: { Evaluation: [0], requires: [1], evidence: [2] },
            type: "article"
          }
        ]
      });
    }
    if (parsed.hostname.includes("crossref")) {
      return response({
        message: {
          items: [
            {
              DOI: "10.5555/example",
              title: ["A Mature Survey of Machine Learning Evaluation"],
              author: [{ given: "Ada", family: "Scholar" }],
              issued: { "date-parts": [[2021]] },
              URL: "https://doi.org/10.5555/example",
              type: "journal-article",
              "container-title": ["Journal of Reliable AI"],
              publisher: "Example Publisher",
              "is-referenced-by-count": 320,
              abstract: "<jats:p>Evaluation requires evidence.</jats:p>"
            },
            {
              DOI: "10.7777/second",
              title: ["Scikit-learn: Machine Learning in Python"],
              author: [{ given: "Fabian", family: "Pedregosa" }],
              issued: { "date-parts": [[2011]] },
              URL: "https://jmlr.org/papers/v12/pedregosa11a.html",
              type: "journal-article",
              "container-title": ["Journal of Machine Learning Research"],
              publisher: "JMLR",
              "is-referenced-by-count": 60000
            }
          ]
        }
      });
    }
    return response([
      "<feed>",
      "<entry>",
      "<id>https://arxiv.org/abs/1603.04467</id>",
      "<title>TensorFlow: Large-Scale Machine Learning on Heterogeneous Distributed Systems</title>",
      "<published>2016-03-14T00:00:00Z</published>",
      "<author><name>Martin Abadi</name></author>",
      "<summary>TensorFlow is a system for machine learning.</summary>",
      "</entry>",
      "</feed>"
    ].join(""));
  };

  const result = await collectOnlineReadingRecommendations({
    topic: "机器学习基础",
    goal: "解释模型评估结果"
  }, { fetchImpl, limit: 5 });

  assert.ok(calls.some((host) => host.includes("openalex")));
  assert.ok(calls.some((host) => host.includes("crossref")));
  assert.ok(calls.some((host) => host.includes("arxiv")));
  assert.equal(result.recommendations.length >= 3, true);
  assert.equal(result.recommendations.every((item) => item.url || item.doi), true);
  assert.equal(result.recommendations.every((item) => item.source === "online-scholarship"), true);
  assert.equal(result.recommendations.filter((item) => item.doi === "10.5555/example").length, 1);
  assert.match(result.status.query, /machine learning/);
});

test("在线拓展阅读检索失败时不使用本地模板伪造条目", async () => {
  const result = await collectOnlineReadingRecommendations({
    topic: "机器学习基础",
    goal: "解释模型评估结果"
  }, {
    fetchImpl: async () => {
      throw new Error("network unavailable");
    }
  });

  assert.deepEqual(result.recommendations, []);
  assert.match(result.status.warning, /不会用本地模板伪造/);
});

test("中文学习主题会生成可用于在线学术检索的扩展查询", () => {
  const queries = buildOnlineReadingQueries({
    topic: "机器学习基础",
    goal: "完成预测项目"
  });
  assert.match(queries.join(" "), /machine learning/);
  assert.match(queries.join(" "), /survey/);
});

test("数据结构与算法主题不会被宽泛的数据关键词误判为机器学习", () => {
  const queries = buildOnlineReadingQueries({
    topic: "数据结构与算法",
    goal: "通过代码题训练复杂度分析"
  }).join(" ");

  assert.match(queries, /data structures algorithms/);
  assert.doesNotMatch(queries, /machine learning model evaluation/);
});
