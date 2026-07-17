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
