import test from "node:test";
import assert from "node:assert/strict";

import { resolveModelProviderConfig } from "../src/config.js";
import { requestChatCompletion } from "../src/llm.js";

test("讯飞星火 provider has explicit OpenAI-compatible defaults", () => {
  const config = resolveModelProviderConfig({
    LLM_PROVIDER: "iflytek",
    IFLYTEK_API_PASSWORD: "spark-password"
  });

  assert.equal(config.provider, "iflytek-spark");
  assert.equal(config.displayName, "讯飞星火大模型");
  assert.equal(config.apiKey, "spark-password");
  assert.equal(config.baseUrl, "https://spark-api-open.xf-yun.com/v1");
  assert.equal(config.model, "4.0Ultra");
  assert.equal(config.wireApi, "chat");
});

test("generic LLM aliases override provider defaults without breaking OpenAI compatibility", () => {
  const config = resolveModelProviderConfig({
    LLM_PROVIDER: "spark",
    LLM_API_KEY: "shared-secret",
    LLM_BASE_URL: "https://example.com/v1/",
    LLM_MODEL: "custom-model",
    LLM_WIRE_API: "chat",
    LLM_TIMEOUT_MS: "45000"
  });

  assert.equal(config.provider, "iflytek-spark");
  assert.equal(config.apiKey, "shared-secret");
  assert.equal(config.baseUrl, "https://example.com/v1");
  assert.equal(config.model, "custom-model");
  assert.equal(config.timeoutMs, 45000);
});

test("model requests can omit both output and client-side time limits", async () => {
  const originalFetch = global.fetch;
  let capturedOptions;
  try {
    global.fetch = async (_url, options) => {
      capturedOptions = options;
      return {
        ok: true,
        async json() {
          return { output_text: "ok" };
        }
      };
    };

    const result = await requestChatCompletion(
      [{ role: "user", content: "generate a detailed lesson" }],
      { timeoutMs: 0 }
    );
    const body = JSON.parse(capturedOptions.body);

    assert.equal(result, "ok");
    assert.equal(capturedOptions.signal, undefined);
    assert.equal(body.max_output_tokens, undefined);
    assert.equal(body.max_tokens, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test("streaming model responses are accumulated from SSE deltas", async () => {
  const originalFetch = global.fetch;
  let requestBody;
  try {
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async text() {
          return [
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"# 讲义\\n"}',
            "",
            'data: {"type":"response.output_text.delta","delta":"详细内容"}',
            "",
            "data: [DONE]"
          ].join("\n");
        }
      };
    };

    const result = await requestChatCompletion(
      [{ role: "user", content: "generate markdown" }],
      { timeoutMs: 0, stream: true }
    );

    assert.equal(requestBody.stream, true);
    assert.equal(result, "# 讲义\n详细内容");
  } finally {
    global.fetch = originalFetch;
  }
});
