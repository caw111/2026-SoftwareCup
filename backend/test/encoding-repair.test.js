import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { containsLegacyMojibake, repairLegacyMojibake } from "../src/encoding-repair.js";

const require = createRequire(import.meta.url);
const iconv = require("iconv-lite");

function garbleUtf8AsGbk(value) {
  return iconv.decode(Buffer.from(value, "utf8"), "gbk");
}

test("历史缓存中的 GBK 错读乱码可以修复为正常中文", () => {
  const badTitle = garbleUtf8AsGbk("机器学习基础 思维导图");
  const badTask = garbleUtf8AsGbk("生成课程项目任务");

  assert.equal(containsLegacyMojibake(badTitle), true);

  const result = repairLegacyMojibake({
    title: badTitle,
    sections: [{ name: badTask }]
  });

  assert.equal(result.changed, true);
  assert.equal(result.value.title, "机器学习基础 思维导图");
  assert.equal(result.value.sections[0].name, "生成课程项目任务");
});

