// 記録の作り（docs/STORAGE.md）のテスト — 自己完結、ID、再計画、再実行の決定性。
import { test } from "node:test";
import assert from "node:assert/strict";
import { project, base, proposal, record, estimate } from "./helpers.mjs";

function setup(t, withBase = true) {
  const p = project();
  t.after(p.cleanup);
  return withBase ? base(p) : p;
}

test("承認すると参照された推定が記録に写し取られ、推定の下書きは消える", (t) => {
  const p = setup(t);
  const planEvent = p.events().find((e) => e.data?.draft?.kind === "plan");
  assert.deepEqual(planEvent.data.estimates.map((e) => e.id), ["EST-0001"]);
  assert.equal(p.hasDraft("EST-0001"), false);
  assert.equal(p.hasDraft("PRP-0003"), false);
  assert.equal(p.json("show", "EST-0001").body.source, "record");
});

test("推定の入力が別の推定を指していれば、それも写し取る", (t) => {
  const p = setup(t);
  p.draft(estimate("EST-0002", { subject: "市場規模", method: "fermi" }));
  p.draft(estimate("EST-0003", { subject: "売上", method: "fermi", inputs: ["EST-0002"] }));
  const r = p.approve(p.draft(proposal("PRP-0005", "advice", {}, ["EST-0003"])));
  assert.deepEqual(r.estimates.sort(), ["EST-0002", "EST-0003"]);
});

test("推定そのものは承認できない", (t) => {
  const p = setup(t);
  p.draft(estimate("EST-0002"));
  const r = p.json("approve", "EST-0002");
  assert.equal(r.code, 1);
});

test("承認・却下した下書きの ID は再利用できない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0001", "advice", {}));
  const c = p.json("check", "PRP-0001");
  assert.equal(c.code, 1);
  assert.ok(c.body.results[0].problems.some((x) => x.includes("すでに承認されています")));
  assert.equal(p.json("approve", "PRP-0001").code, 1);
});

test("却下は決定を残し、理由を記録する。記録の下書きは却下できない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "advice", {}));
  const r = p.json("reject", "PRP-0005", "--reason", "今は不要");
  assert.equal(r.code, 0);
  const dec = p.json("show", r.body.event.data.decision).body.record;
  assert.equal(dec.outcome, "rejected");
  assert.equal(dec.reason, "今は不要");
  p.draft(record("DRF-0001", "progress", { workItem: "WI-0001", date: "2026-10-20", text: "着手" }));
  assert.equal(p.json("reject", "DRF-0001").code, 1);
});

test("新しい計画に載らない未完了の WorkItem は中止になる", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-02-28", workItems: [
    { id: "WI-0001", title: "設計（見直し）", type: "execute", deliverables: ["設計書"] },
    { id: "WI-0002", title: "API の応答時間の検証", type: "explore", question: "1 秒以内に応答するか", tests: ["PRM-0002"], deliverables: ["検証報告"] },
  ] }));
  const r = p.approve("PRP-0005");
  assert.deepEqual(r.effects.cancelled, ["WI-0003"]);
  const s = p.json("status").body;
  assert.equal(s.plan.id, "PLAN-0002");
  assert.equal(s.workItems.find((w) => w.id === "WI-0001").title, "設計（見直し）");
  assert.equal(s.workItems.find((w) => w.id === "WI-0003").state, "cancelled");
});

test("依存の循環は承認できない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-01-31", workItems: [
    { id: "WI-0001", title: "設計", type: "execute", deliverables: ["設計書"], dependsOn: ["WI-0003"] },
    { id: "WI-0002", title: "API の応答時間の検証", type: "explore", question: "1 秒以内に応答するか", tests: ["PRM-0002"], deliverables: ["検証報告"] },
    { id: "WI-0003", title: "キックオフ", type: "execute", dependsOn: ["WI-0001"] },
  ] }));
  const r = p.json("approve", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("循環")));
});

test("探索型が検証するのは仮定だけ。制約は指せない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-01-31", workItems: [
    { id: "WI-0001", title: "設計", type: "execute", deliverables: ["設計書"] },
    { id: "WI-0002", title: "期限の検証", type: "explore", question: "期限は守れるか", tests: ["PRM-0001"], deliverables: ["検証報告"] },
    { id: "WI-0003", title: "キックオフ", type: "execute" },
  ] }));
  const r = p.json("approve", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("PRM-0001") && x.includes("仮定ではありません")));
});

test("仮定の検証状態は不確実性の解消度に、目的の達成状況は成果達成度に出る", (t) => {
  const p = setup(t);
  p.approve(p.draft(proposal("PRP-0005", "objectives", { add: [{ id: "OBJ-0001", statement: "受注処理を自動化する" }] })));
  p.approve(p.draft(proposal("PRP-0006", "assumption-status", { updates: [{ id: "PRM-0002", verification: "rejected", note: "平均 2.3 秒" }] })));
  const s = p.json("status").body;
  assert.deepEqual(s.axes.uncertainty, { unverified: 0, supported: 0, rejected: 1 });
  assert.deepEqual(s.axes.outcome.map((o) => o.status), ["unmet"]);
  const bad = p.json("approve", p.draft(proposal("PRP-0007", "assumption-status", { updates: [{ id: "PRM-0001", verification: "supported" }] })));
  assert.equal(bad.code, 1);
});

test("status は前提の一覧を出す。仮定には検証状態を添え、削除した前提は出さない", (t) => {
  const p = setup(t);
  p.approve(p.draft(proposal("PRP-0005", "assumption-status", { updates: [{ id: "PRM-0002", verification: "rejected", note: "平均 2.3 秒" }] })));
  p.approve(p.draft(proposal("PRP-0006", "premises", { add: [{ id: "PRM-0003", type: "constraint", statement: "予算は 500 万円" }] })));
  p.approve(p.draft(proposal("PRP-0007", "premises", { remove: ["PRM-0003"] })));
  assert.deepEqual(p.json("status").body.premises, [
    { id: "PRM-0001", type: "constraint", statement: "期限は 3 か月" },
    { id: "PRM-0002", type: "assumption", statement: "連携先 API は 1 秒以内に応答する", verification: "rejected", note: "平均 2.3 秒" },
  ]);
  const text = p.run("status").stdout;
  assert.match(text, /^前提\n  PRM-0001 \[制約\] 期限は 3 か月\n  PRM-0002 \[仮定・棄却\] 連携先 API は 1 秒以内に応答する（平均 2\.3 秒）$/m);
  assert.doesNotMatch(text, /PRM-0003/);
});

test("企画の骨子は承認で置き換わり、status に出る", (t) => {
  const p = setup(t, false);
  p.run("init", "受注処理の自動化");
  assert.equal(p.json("status").body.charter, null);
  assert.match(p.run("status").stdout, /^企画の骨子\n  まだありません$/m);
  const r = p.approve(p.draft(proposal("PRP-0001", "charter", { problem: "月末に受注入力の残業が集中する", direction: "AI-OCR で注文書の読み取りを自動化する", scope: { in: ["FAX・PDF の注文書"], out: ["EDI の注文"] } })));
  assert.equal(r.effects.charter, true);
  p.approve(p.draft(proposal("PRP-0002", "charter", { problem: "月末に受注入力の残業が集中する", direction: "入力の手順を見直し、OCR は PDF だけに使う" })));
  assert.deepEqual(p.json("status").body.charter, { problem: "月末に受注入力の残業が集中する", direction: "入力の手順を見直し、OCR は PDF だけに使う", scope: { in: [], out: [] } });
  assert.match(p.run("status").stdout, /^企画の骨子\n  問題意識: 月末に受注入力の残業が集中する\n  方向性: 入力の手順を見直し、OCR は PDF だけに使う\n\n/m);
});

test("方向性の選択肢は骨子の提案を並べて出し、1 つを承認してほかを却下する（PHASE-IDEATION.md「決めたこと」5）", (t) => {
  const p = setup(t, false);
  p.run("init", "受注処理の自動化");
  p.draft(proposal("PRP-0001", "charter", { problem: "月末の残業", direction: "AI-OCR で自動化する" }));
  p.draft(proposal("PRP-0002", "charter", { problem: "月末の残業", direction: "取引先に EDI への移行を頼む" }));
  assert.equal(p.json("check").code, 0, "骨子どうしは ID を作らないので衝突しない");
  p.approve("PRP-0002");
  assert.equal(p.json("reject", "PRP-0001", "--reason", "取引先の協力が得やすい EDI を選ぶ").code, 0);
  assert.equal(p.json("status").body.charter.direction, "取引先に EDI への移行を頼む");
});

test("骨子は問題意識と方向性が要り、範囲は文字列の配列だけ", (t) => {
  const p = setup(t, false);
  p.run("init", "x");
  p.draft(proposal("PRP-0001", "charter", { problem: "", direction: "d", scope: { in: "全部", other: [] } }));
  const problems = p.json("check", "PRP-0001").body.results[0].problems;
  assert.ok(problems.some((x) => x.includes("payload.problem")));
  assert.ok(problems.some((x) => x.includes("scope.in は配列")));
  assert.ok(problems.some((x) => x.includes("未知の項目 other")));
});

test("status は記録にある推定の一覧を出す（PHASE-IDEATION.md「決めたこと」7）", (t) => {
  const p = setup(t);
  p.draft(estimate("EST-0002", { subject: "減る手入力の時間", method: "fermi", value: { low: 83, high: 133, unit: "時間/月" } }));
  p.approve(p.draft(proposal("PRP-0005", "advice", {}, ["EST-0002"])));
  p.draft(estimate("EST-0003", { subject: "まだ参照されていない推定" }));
  assert.deepEqual(p.json("status").body.estimates.map((e) => e.id), ["EST-0001", "EST-0002"]);
  assert.match(p.run("status").stdout, /^推定\n  EST-0001 \[工数見積\] 工数: 3〜5 人日\n  EST-0002 \[フェルミ推定\] 減る手入力の時間: 83〜133 時間\/月$/m);
});

test("status の nextIds は記録と下書きの両方で使われている ID を避ける", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0007", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-01-31", workItems: [{ id: "WI-0009", title: "x", type: "execute" }] }));
  const n = p.json("status").body.nextIds;
  assert.equal(n.PRP, "PRP-0008");
  assert.equal(n.WI, "WI-0010");
  assert.equal(n.MEM, "MEM-0003");
  assert.equal(n.EST, "EST-0002");
});

test("check は下書きを検査するだけで記録を書かない", (t) => {
  const p = setup(t);
  const before = p.eventsText();
  p.draft(proposal("PRP-0005", "advice", {}));
  assert.equal(p.json("check").code, 0);
  assert.equal(p.eventsText(), before);
  assert.ok(p.hasDraft("PRP-0005"));
});

test("同じ操作を同じ時刻で行えば、記録はバイト単位で同じになる（再実行の決定性）", (t) => {
  const a = setup(t);
  const b = setup(t);
  assert.equal(a.eventsText(), b.eventsText());
});

test("verify は記録の無いプロジェクトを問題として報告する", (t) => {
  const p = setup(t, false);
  p.file(".hitp/drafts/.keep", "");
  const r = p.json("verify");
  assert.equal(r.code, 1);
});

test("使い方の誤りは終了コード 2", (t) => {
  const p = setup(t);
  assert.equal(p.run("frobnicate").code, 2);
  assert.equal(p.run("submit", "WI-0001", "--file", "設計書").code, 2);
  assert.equal(p.run("submit", "WI-0001", "--gate", "id=GATE-0001,who=部長").code, 2);
});

test("init は二度目を受け付けない", (t) => {
  const p = setup(t);
  assert.equal(p.json("init", "もう一度").code, 1);
});
