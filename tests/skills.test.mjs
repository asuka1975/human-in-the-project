// スキルに載せた下書きの例が、いまの hitp で検査と承認を通ること。例が形式の変更に取り残されないように。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { project, proposal, estimate } from "./helpers.mjs";

const examples = (path) => [...readFileSync(new URL(path, import.meta.url), "utf8").matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));

test("hitp-ideation の下書きの例は、書いた順に検査と承認を通る", (t) => {
  const p = project();
  t.after(p.cleanup);
  p.run("init", "受注処理の自動化");
  const ex = Object.fromEntries(examples("../.apm/skills/hitp-ideation/SKILL.md").map((d) => [d.id, d]));
  assert.deepEqual(Object.keys(ex).sort(), ["EST-0001", "PRP-0001", "PRP-0002", "PRP-0003", "PRP-0005"]);

  p.draft(ex["PRP-0001"]);
  p.draft(ex["EST-0001"]);
  assert.equal(p.json("check").code, 0, JSON.stringify(p.json("check").body));
  p.approve("PRP-0001");
  p.approve(p.draft(ex["PRP-0002"]));
  // 例が参照する EST-0002（効果の人年換算）と OBJ-0001 は、例の外で用意する
  p.draft(estimate("EST-0002", { subject: "効果の大きさ（人年換算）", method: "scale", value: { low: 0.55, high: 0.89, unit: "人年/年" }, derivation: "EST-0001 × 12 か月 ÷ 1,800 時間", inputs: ["EST-0001", { assume: "1 人年は 1,800 時間" }] }));
  p.approve(p.draft(ex["PRP-0003"]));
  p.approve(p.draft(proposal("PRP-0004", "objectives", { add: [{ id: "OBJ-0001", statement: "受注処理の手入力の時間を月 80 時間以上減らす" }] }, ["EST-0001"])));
  const r = p.approve(p.draft(ex["PRP-0005"]));
  assert.deepEqual(r.effects.phase, { from: "ideation", to: "planning" });

  const s = p.json("status").body;
  assert.equal(s.charter.direction, "AI-OCR で注文書の読み取りを自動化する");
  assert.deepEqual(s.estimates.map((e) => e.id), ["EST-0001", "EST-0002"]);
  assert.deepEqual(s.premises.map((x) => x.id), ["PRM-0001", "PRM-0002", "PRM-0003"]);
});

/** 計画の例を、書いた順に承認する（推進の例の前提にもなる）。修正案 PRP-0009 を選び、フェーズは推進になる。 */
function throughPlanning(p) {
  p.run("init", "受注処理の自動化");
  // 企画の記録（例が参照する PRM-0003 など）
  p.approve(p.draft(proposal("PRP-0001", "charter", { problem: "月末に受注入力の残業が集中する", direction: "AI-OCR で注文書の読み取りを自動化する" })));
  p.approve(p.draft(proposal("PRP-0002", "premises", { add: [
    { id: "PRM-0001", type: "constraint", statement: "使える人員は 3 人（増やせない）" },
    { id: "PRM-0002", type: "assumption", statement: "期間は半年程度（目安）" },
    { id: "PRM-0003", type: "assumption", statement: "注文書のうち自動で読める割合は 50〜80%" },
  ] })));
  p.approve(p.draft(proposal("PRP-0003", "objectives", { add: [{ id: "OBJ-0001", statement: "受注の手入力の時間を月 80 時間以上減らす" }] })));
  p.approve(p.draft(proposal("PRP-0004", "phase", { to: "planning" })));

  const ex = Object.fromEntries(examples("../.apm/skills/hitp-planning/SKILL.md").map((d) => [d.id, d]));
  assert.deepEqual(Object.keys(ex).sort(), ["EST-0002", "PRP-0006", "PRP-0007", "PRP-0008", "PRP-0009", "PRP-0010", "PRP-0011"]);
  p.approve(p.draft(ex["PRP-0006"]));
  p.approve(p.draft(ex["PRP-0007"]));
  // 例が参照する EST-0001・EST-0003 は、例の外で用意する
  p.draft(estimate("EST-0001", { subject: "読み取り率の検証の工数", value: { low: 4, high: 8, unit: "人日" } }));
  p.draft(estimate("EST-0003", { subject: "試行運用の工数", value: { low: 10, high: 15, unit: "人日" } }));
  p.draft(ex["EST-0002"]);
  p.draft(ex["PRP-0008"]);
  p.draft(ex["PRP-0009"]);
  const by = Object.fromEntries(p.json("check").body.results.map((r) => [r.id, r]));
  for (const id of ["EST-0001", "EST-0002", "EST-0003", "PRP-0008", "PRP-0009"]) assert.deepEqual(by[id].problems, [], id);
  // スキルの比べる表と同じ数字
  assert.deepEqual([by["PRP-0008"].forecast.finish, by["PRP-0008"].forecast.availableDays, by["PRP-0008"].forecast.overBy.high], [{ low: 44, high: 83 }, 65, 18]);
  assert.deepEqual([by["PRP-0009"].forecast.availableDays, by["PRP-0009"].forecast.overBy.high], [85, 0]);

  p.approve("PRP-0009");
  assert.ok(p.json("check", "PRP-0008").body.results[0].problems.some((x) => x.includes("今の計画は PLAN-0001 です")));
  assert.equal(p.json("reject", "PRP-0008", "--reason", "案 A を選んだ").code, 0);
  p.approve(p.draft(ex["PRP-0010"]));
  const r = p.approve(p.draft(ex["PRP-0011"]));
  assert.deepEqual(r.effects.phase, { from: "planning", to: "executing" });
}

test("hitp-planning の下書きの例は、書いた順に検査と承認を通り、修正案どうしは並べられる", (t) => {
  const p = project({ now: "2026-11-02T12:00:00.000Z" });
  t.after(p.cleanup);
  throughPlanning(p);
});

/** スキルに載せた「! hitp …」のコマンドを、引用符を外して引数に分ける。 */
const leaderCommands = (path) => readFileSync(new URL(path, import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("! hitp "))
  .map((l) => [...l.slice("! hitp ".length).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]));

test("hitp-executing の例は、計画の例の続きとして、リーダーのコマンドも含めて通る", (t) => {
  const p = project({ now: "2026-11-02T12:00:00.000Z" });
  t.after(p.cleanup);
  throughPlanning(p);
  const ex = Object.fromEntries(examples("../.apm/skills/hitp-executing/SKILL.md").map((d) => [d.id, d]));
  assert.deepEqual(Object.keys(ex).sort(), ["DRF-0001", "DRF-0002", "EST-0004", "PRP-0012", "PRP-0013", "PRP-0014", "PRP-0015", "PRP-0016"]);
  const cmds = leaderCommands("../.apm/skills/hitp-executing/SKILL.md");
  assert.deepEqual(cmds.map((c) => c[0]), ["checkpoint", "checkpoint", "submit"]);

  p.setNow("2026-11-09T12:00:00.000Z");
  p.approve(p.draft(ex["DRF-0001"]));
  assert.deepEqual(p.json("status").body.workItems.find((w) => w.id === "WI-0001").remaining, { low: 1, high: 2, report: "RPT-0001" });
  for (const c of cmds.filter((x) => x[0] === "checkpoint")) assert.equal(p.json(...c).code, 0, c.join(" "));

  p.setNow("2026-11-18T12:00:00.000Z");
  p.approve(p.draft(ex["DRF-0002"]));
  p.approve(p.draft(ex["PRP-0012"]));
  assert.equal(p.json("status").body.forecast.members.find((m) => m.id === "MEM-0003").awayDays, 10);
  p.approve(p.draft(ex["PRP-0013"]));

  p.setNow("2026-11-20T12:00:00.000Z");
  p.file("docs/検証報告.md", "全体 42%（FAX 20%、PDF 64%）");
  const submit = cmds.find((x) => x[0] === "submit");
  assert.equal(p.json(...submit).code, 0, submit.join(" "));
  p.approve(p.draft(ex["PRP-0014"]));
  assert.deepEqual(p.json("status").body.needsReview.map((n) => n.workItem), ["WI-0002", "WI-0003"]);
  p.draft(ex["EST-0004"]);
  p.approve(p.draft(ex["PRP-0015"]));
  assert.deepEqual(p.json("status").body.needsReview, [], "再計画で見直しは済む");
  p.draft(ex["PRP-0016"]);
  assert.deepEqual(p.json("check", "PRP-0016").body.results[0].problems, []);
});
