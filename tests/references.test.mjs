// スキルに同梱した下書きの形式（references/drafts.md）が、docs/STORAGE.md の該当節と食い違っていないこと。
// APM で入れた先には docs/ が届かないので、エージェントが読むのは同梱のほう。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("references/drafts.md は STORAGE.md の「値の表記」〜「下書きの形式」と同じ", () => {
  const storage = read("../docs/STORAGE.md");
  const section = storage.slice(storage.indexOf("## 値の表記"), storage.indexOf("## 記録の形式")).trim();
  const bundled = read("../.apm/skills/hitp/references/drafts.md");
  assert.equal(bundled.slice(bundled.indexOf("## 値の表記")).trim(), section);
});
