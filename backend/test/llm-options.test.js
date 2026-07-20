import test from "node:test";
import assert from "node:assert/strict";

import { requestChatCompletion } from "../src/llm.js";

test("model requests can omit both output and client-side time limits", async () => {
  const originalFetch = global.fetch;
  let capturedOptions;
  try {
    global.fetch = async (_url, options) => {
      capturedOptions = options;
      return {
        ok: true,
        headers: { get: () => "application/json" },
        async text() { return JSON.stringify({ output_text: "ok" }); }
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
    assert.equal(body.stream, false);
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
        headers: { get: () => "text/event-stream" },
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

test("non-stream requests accept SSE returned by a compatible gateway", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      headers: { get: () => "text/event-stream; charset=utf-8" },
      async text() {
        return [
          "event: codex/response",
          'data: {"type":"response.output_text.delta","delta":"大模型"}',
          "",
          "event: codex/response",
          'data: {"type":"response.output_text.delta","delta":"连接成功"}',
          "",
          "data: [DONE]"
        ].join("\n");
      }
    });

    const result = await requestChatCompletion(
      [{ role: "user", content: "connection test" }],
      { stream: false }
    );

    assert.equal(result, "大模型连接成功");
  } finally {
    global.fetch = originalFetch;
  }
});

test("event-stream bodies are detected even when the gateway reports JSON", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      headers: { get: () => "application/json" },
      async text() {
        return 'event: response.output_text.delta\ndata: {"delta":"兼容成功"}\n\ndata: [DONE]';
      }
    });

    const result = await requestChatCompletion([{ role: "user", content: "test" }]);
    assert.equal(result, "兼容成功");
  } finally {
    global.fetch = originalFetch;
  }
});
