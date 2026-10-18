// 推進フェーズのための hitp（docs/PHASE-EXECUTING.md）: チェックポイント、残りの工数、不在、見直しが要るもの、最近の報告。
import { test } from "node:test";
import assert from "node:assert/strict";
import { project, proposal, record, estimate } from "./helpers.mjs";
import { guardBash } from "../.apm/skills/hitp/scripts/lib/guard.mjs";

const noon = (date) => `${date}T12:00:00.000Z`;
const effort = (id, subject, low, high) => estimate(id, { subject, value: { low, high, unit: "人日" } });

/** PHASE-EXECUTING.md の例: 検証（鈴木・探索）→ 実装（田中）→ 試行（佐藤）、期限 2027-02-26。 */
function example(t, { checkpoints = [] } = {}) {
  const p = project({ now: noon("2026-10-13") });
  t.after(p.cleanup);
  p.run("init", "受注処理の自動化");
  p.approve(p.draft(proposal("PRP-0001", "premises", { add: [{ id: "PRM-0001", type: "assumption", statement: "自動で読める割合は 50〜80%" }] })));
  p.approve(p.draft(proposal("PRP-0002", "members", { add: [
    { id: "MEM-0001", name: "佐藤", capacity: 5 }, { id: "MEM-0002", name: "鈴木", capacity: 2 }, { id: "MEM-0003", name: "田中", capacity: 5 },
  ] })));
  p.draft(effort("EST-0001", "読み取り率の検証", 4, 8));
  p.draft(effort("EST-0002", "OCR 連携の実装", 24, 48));
  p.draft(effort("EST-0003", "試行運用", 10, 15));
  p.approve(p.draft(proposal("PRP-0003", "plan", { id: "PLAN-0001", replaces: null, deadline: "2027-02-26", workItems: [
    { id: "WI-0001", title: "読み取り率の検証", type: "explore", assignee: "MEM-0002", estimate: "EST-0001", question: "50% 以上か", tests: ["PRM-0001"], deliverables: ["検証報告"], ...(checkpoints.length ? { checkpoints } : {}) },
    { id: "WI-0002", title: "OCR 連携の実装", type: "execute", assignee: "MEM-0003", estimate: "EST-0002", dependsOn: ["WI-0001"], deliverables: ["連携プログラム"] },
    { id: "WI-0003", title: "試行運用", type: "execute", assignee: "MEM-0001", estimate: "EST-0003", dependsOn: ["WI-0002"], deliverables: ["試行報告"] },
  ] }, ["PRM-0001"])));
  return p;
}

const CHECKPOINTS = [
  { title: "サンプル 200 枚を集める", remaining: { low: 3, high: 6 } },
  { title: "200 枚を読み取る", remaining: { low: 1, high: 2 } },
  { title: "検証報告を書く", remaining: { low: 0, high: 0 } },
];

test("チェックポイント: リーダーは hitp checkpoint で通過を 1 行で記録でき、計画に書いた残りが見通しに入る", (t) => {
  const p = example(t, { checkpoints: CHECKPOINTS });
  p.setNow(noon("2026-11-09"));
  const before = p.json("status").body.forecast.finish;
  assert.deepEqual(before, { low: 44, high: 83 }, "通過の前は推定の全量");
  const r = p.json("checkpoint", "WI-0001", "2");
  assert.equal(r.code, 0, JSON.stringify(r.body));
  assert.match(p.run("show", "RPT-0001").stdout, /チェックポイント 2「200 枚を読み取る」を通過/);
  const s = p.json("status").body;
  assert.equal(s.workItems[0].state, "doing");
  assert.deepEqual(s.forecast.finish, { low: 36.5, high: 68 });
  assert.equal(s.forecast.availableDays, 80);
  assert.match(p.run("status").stdout, /WI-0001 \[進行中\] 読み取り率の検証（[^\n]*）\n      チェックポイント 2\/3 通過（次: 検証報告を書く）、残り 1〜2 人日（RPT-0001）、最後の報告から 0 営業日/);
});

test("チェックポイント: 日付とひとことを付けられる。無い番号は受け付けない", (t) => {
  const p = example(t, { checkpoints: CHECKPOINTS });
  assert.equal(p.json("checkpoint", "WI-0001", "1", "--date", "2026-10-20", "--note", "FAX 100 枚、PDF 100 枚").code, 0);
  assert.match(p.run("show", "RPT-0001").stdout, /2026-10-20[\s\S]*チェックポイント 1「サンプル 200 枚を集める」を通過。FAX 100 枚、PDF 100 枚/);
  const bad = p.json("checkpoint", "WI-0001", "4");
  assert.equal(bad.code, 1);
  assert.ok(bad.body.problems.some((x) => x.includes("チェックポイント 4 はありません（3 個）")));
  assert.equal(p.json("checkpoint", "WI-0002", "1").code, 1, "チェックポイントの無い WorkItem");
  assert.equal(p.json("verify").code, 0);
});

test("チェックポイント: エージェントが hitp checkpoint を打つと hook が拒否する（INV-1）", () => {
  for (const c of ["hitp checkpoint WI-0001 2", "node .claude/skills/hitp/scripts/hitp.mjs checkpoint WI-0001 2"]) assert.match(guardBash(c) ?? "", /checkpoint/, c);
});

test("チェックポイント: 残りは後ろほど少なく、推定の上限を超えない", (t) => {
  const p = example(t);
  p.draft(proposal("PRP-0004", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-02-26", workItems: [
    { id: "WI-0001", title: "読み取り率の検証", type: "explore", assignee: "MEM-0002", estimate: "EST-0001", question: "50% 以上か", tests: ["PRM-0001"], deliverables: ["検証報告"],
      checkpoints: [{ title: "a", remaining: { low: 2, high: 3 } }, { title: "b", remaining: { low: 3, high: 9 } }] },
    { id: "WI-0002", title: "OCR 連携の実装", type: "execute", assignee: "MEM-0003", estimate: "EST-0002", dependsOn: ["WI-0001"], deliverables: ["連携プログラム"] },
    { id: "WI-0003", title: "試行運用", type: "execute", assignee: "MEM-0001", estimate: "EST-0003", dependsOn: ["WI-0002"], deliverables: ["試行報告"] },
  ] }, ["PRM-0001"]));
  const problems = p.json("check", "PRP-0004").body.results[0].problems;
  assert.ok(problems.some((x) => x.includes("checkpoints[1].remaining は前のチェックポイントより多く")));
  p.draft(proposal("PRP-0005", "plan", { ...p.json("show", "PRP-0004").body.draft.payload, workItems: p.json("show", "PRP-0004").body.draft.payload.workItems.map((w, i) => i === 0 ? { ...w, checkpoints: [{ title: "a", remaining: { low: 5, high: 9 } }] } : w) }, ["PRM-0001"]));
  assert.ok(p.json("check", "PRP-0005").body.results[0].problems.some((x) => x.includes("チェックポイント 1 の残り（上限 9 人日）が、推定 EST-0001 の上限（8 人日）より多く")));
});

test("進捗報告: 残りの工数を書けば、見通しは進行中の作業をその残りで数える。チェックポイントの番号だけでも残りが決まる", (t) => {
  const p = example(t, { checkpoints: CHECKPOINTS });
  p.setNow(noon("2026-11-09"));
  p.approve(p.draft(record("DRF-0001", "progress", { workItem: "WI-0001", date: "2026-11-09", text: "200 枚のうち 120 枚を読み取った。残りは 1〜2 日", remaining: { low: 1, high: 2 } })));
  assert.deepEqual(p.json("status").body.forecast.finish, { low: 36.5, high: 68 });
  p.approve(p.draft(record("DRF-0002", "progress", { workItem: "WI-0001", date: "2026-11-10", text: "集め直しが要る", checkpoint: 1 })));
  assert.deepEqual(p.json("show", "RPT-0002").body.record.remaining, { low: 3, high: 6 }, "番号だけなら計画の残り");
  p.draft(record("DRF-0003", "progress", { workItem: "WI-0001", date: "2026-11-10", text: "x", checkpoint: 9 }));
  assert.ok(p.json("check", "DRF-0003").body.results[0].problems.some((x) => x.includes("チェックポイント 9 はありません")));
});

test("不在: 担当者の不在の営業日は作業を進めず、稼働からも除く", (t) => {
  const p = example(t);
  p.setNow(noon("2026-11-20"));
  p.file("report.md", "全体 42%");
  assert.equal(p.json("submit", "WI-0001", "--file", "検証報告=report.md").code, 0);
  assert.deepEqual(p.json("status").body.forecast.finish, { low: 34, high: 63 });
  p.approve(p.draft(record("DRF-0001", "incident", { date: "2026-11-18", text: "田中さんが 11/30 から 2 週間、別案件の応援に入る", workItems: ["WI-0002"] })));
  p.approve(p.draft(proposal("PRP-0004", "members", { update: [{ id: "MEM-0003", name: "田中", capacity: 5, away: [{ from: "2026-11-30", to: "2026-12-11" }] }] }, ["INC-0001"])));
  const f = p.json("status").body.forecast;
  assert.deepEqual([f.finish, f.availableDays, f.overBy.high], [{ low: 44, high: 73 }, 71, 2]);
  const tanaka = f.members.find((m) => m.id === "MEM-0003");
  assert.deepEqual([tanaka.capacityDays, tanaka.awayDays], [61, 10]);
  const text = p.run("status").stdout;
  assert.match(text, /MEM-0003 田中 週の稼働日 5／不在 2026-11-30〜2026-12-11/);
  assert.match(text, /MEM-0003 田中 24〜48 人日／稼働 61 人日（不在 10 営業日を除く）/);
  assert.match(text, /^不測の事態\n  2026-11-18 田中さんが 11\/30 から 2 週間、別案件の応援に入る（WI-0002）（INC-0001）$/m);
  p.draft(proposal("PRP-0005", "members", { update: [{ id: "MEM-0003", name: "田中", away: [{ from: "2026-12-11", to: "2026-11-30" }] }] }));
  assert.ok(p.json("check", "PRP-0005").body.results[0].problems.some((x) => x.includes("from が to より後")));
});

test("見直しが要るもの: 棄却された仮定を確かめた探索型に（たどって）依存する、未完了の WorkItem を出す", (t) => {
  const p = example(t);
  assert.deepEqual(p.json("status").body.needsReview, []);
  p.file("report.md", "全体 42%");
  p.json("submit", "WI-0001", "--file", "検証報告=report.md");
  p.approve(p.draft(proposal("PRP-0004", "assumption-status", { updates: [{ id: "PRM-0001", verification: "rejected", note: "全体 42%" }] }, ["DLV-0001"])));
  assert.deepEqual(p.json("status").body.needsReview.map((n) => [n.workItem, n.via, n.premise]), [["WI-0002", "WI-0001", "PRM-0001"], ["WI-0003", "WI-0001", "PRM-0001"]]);
  assert.match(p.run("status").stdout, /^見直しが要るもの\n  WI-0002: 依存先の WI-0001 が確かめた仮定 PRM-0001 は棄却されました（全体 42%）\n  WI-0003: /m);
  // 棄却のあとにリーダーが再計画を承認すれば、見直しは済んだとみなす
  p.approve(p.draft(proposal("PRP-0005", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-02-26", workItems: [
    { id: "WI-0002", title: "OCR 連携の実装（PDF だけ）", type: "execute", assignee: "MEM-0003", estimate: "EST-0002", dependsOn: ["WI-0001"], deliverables: ["連携プログラム"] },
    { id: "WI-0003", title: "試行運用", type: "execute", assignee: "MEM-0001", estimate: "EST-0003", dependsOn: ["WI-0002"], deliverables: ["試行報告"] },
  ] }, ["PRM-0001", "DLV-0001"])));
  assert.deepEqual(p.json("status").body.needsReview, []);
});

test("status: 最近の報告と、進行中の作業の最後の報告からの営業日を出す", (t) => {
  const p = example(t);
  p.setNow(noon("2026-11-18"));
  p.approve(p.draft(record("DRF-0001", "progress", { workItem: "WI-0001", date: "2026-11-09", text: "120 枚まで" })));
  const s = p.json("status").body;
  assert.deepEqual(s.workItems[0].lastReport, { id: "RPT-0001", date: "2026-11-09", businessDaysAgo: 7 });
  assert.match(p.run("status").stdout, /^最近の報告\n  2026-11-09 WI-0001 120 枚まで（RPT-0001）$/m);
  assert.match(p.run("status").stdout, /最後の報告から 7 営業日/);
  p.approve(p.draft(record("DRF-0002", "progress", { workItem: "WI-0001", date: "2026-11-18", text: "200 枚まで" })));
  assert.match(p.run("status").stdout, /^最近の報告\n  2026-11-18 WI-0001 200 枚まで（RPT-0002）\n  2026-11-09 WI-0001 120 枚まで（RPT-0001）$/m, "新しい順に 1 行ずつ");
});

test("見通し: メンバーの更新（不在）と進捗報告の下書きにも、承認したときの今の計画の見通しを出す", (t) => {
  const p = example(t, { checkpoints: CHECKPOINTS });
  p.setNow(noon("2026-11-20"));
  p.file("report.md", "全体 42%");
  p.json("submit", "WI-0001", "--file", "検証報告=report.md");
  p.draft(proposal("PRP-0004", "members", { update: [{ id: "MEM-0003", name: "田中", capacity: 5, away: [{ from: "2026-11-30", to: "2026-12-11" }] }] }));
  const m = p.json("check", "PRP-0004").body.results[0];
  assert.deepEqual([m.problems, m.forecast.finish, m.forecast.overBy.high], [[], { low: 44, high: 73 }, 2]);
  assert.match(p.run("check", "PRP-0004").stdout, /PRP-0004（[^）]*）: OK\n  承認したときの見通し:\n    完了見込み: 44〜73 営業日／期限 2027-02-26 まで 71 営業日（上限で 2 営業日超える）/);
  assert.deepEqual(p.json("show", "PRP-0004").body.forecast.finish, { low: 44, high: 73 });

  const q = example(t, { checkpoints: CHECKPOINTS });
  q.setNow(noon("2026-11-09"));
  q.draft(record("DRF-0001", "progress", { workItem: "WI-0001", date: "2026-11-09", text: "残りは 1〜2 日", remaining: { low: 1, high: 2 } }));
  assert.deepEqual(q.json("check", "DRF-0001").body.results[0].forecast.finish, { low: 36.5, high: 68 });
});

test("成果物の数字は、推定の入力と提案の根拠に成果物の ID（DLV）で書ける（quote はリーダーの発言だけ）", (t) => {
  const p = example(t);
  p.setNow(noon("2026-11-20"));
  p.file("report.md", "全体 42%（FAX 20%、PDF 64%）");
  assert.equal(p.json("submit", "WI-0001", "--file", "検証報告=report.md").code, 0);
  p.draft(estimate("EST-0009", { subject: "今の読み取り率で減らせる手入力の時間", method: "fermi", value: { low: 67, high: 67, unit: "時間/月" },
    derivation: "FAX 月 90 時間 × 20% ＋ PDF 月 77 時間 × 64%", inputs: ["DLV-0001", { quote: "FAX が月 90 時間、PDF が月 77 時間" }] }));
  assert.deepEqual(p.json("check", "EST-0009").body.results[0].problems, []);
  p.approve(p.draft(proposal("PRP-0004", "advice", {}, ["DLV-0001", "EST-0009"])));
  assert.deepEqual(p.json("show", "DEC-0004").code, 0);
});
