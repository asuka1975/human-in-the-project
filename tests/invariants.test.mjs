// 不変条件 INV-1〜15（docs/DOMAIN-MODEL.md）の決定論的テスト（L1）。
// テスト名の先頭の INV 番号が、どの不変条件を確かめているかを表す。INV-1 の hook 側は hook.test.mjs、INV-8・INV-9 は hitp では守れない（CLI.md）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { project, base, proposal, record, estimate } from "./helpers.mjs";

function setup(t, withBase = true) {
  const p = project();
  t.after(p.cleanup);
  return withBase ? base(p) : p;
}

const gate = (id = "GATE-0001", over = "") => `id=${id},by=部長,at=2026-11-20,result=pass${over}`;

// ---------------------------------------------------------------- INV-1

test("INV-01 記録の行を書き換えると verify が検知する", (t) => {
  const p = setup(t);
  assert.equal(p.json("verify").body.ok, true);
  p.writeEventsText(p.eventsText().replace("部長の承認", "課長の承認"));
  const r = p.json("verify");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("hash が中身と一致しません")));
});

test("INV-01 記録の行を消すと連鎖が切れて verify が検知する", (t) => {
  const p = setup(t);
  const lines = p.eventsText().split("\n").filter(Boolean);
  lines.splice(2, 1);
  p.writeEventsText(lines.join("\n") + "\n");
  const r = p.json("verify");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("連鎖が切れています")));
});

test("INV-01 actor が leader でない行を verify が検知する", (t) => {
  const p = setup(t);
  p.writeEventsText(p.eventsText().replace('"actor":"leader"', '"actor":"agent"'));
  const r = p.json("verify");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("actor が leader ではありません")));
});

test("INV-01 記録が壊れていると書き込み系は何もしない", (t) => {
  const p = setup(t);
  p.writeEventsText(p.eventsText() + "{壊れた行\n");
  p.draft(proposal("PRP-0005", "advice", {}));
  const r = p.json("approve", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(p.hasDraft("PRP-0005"));
});

// ---------------------------------------------------------------- INV-2

test("INV-02 制約は premises の提案の承認でだけ変わり、決定が残る", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "premises", { update: [{ id: "PRM-0001", type: "constraint", statement: "期限は 4 か月" }] }));
  const r = p.approve("PRP-0005");
  assert.deepEqual(r.effects.constraints, ["PRM-0001"]);
  const shown = p.json("show", "PRM-0001").body.record;
  assert.equal(shown.statement, "期限は 4 か月");
  assert.equal(p.json("show", r.event.data.decision).body.record.outcome, "approved");
});

test("INV-02 ほかの種類の提案に前提を紛れ込ませると受け付けない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "advice", { premises: [{ id: "PRM-0001", statement: "期限なし" }] }));
  const r = p.json("approve", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("未知の項目 premises")));
  assert.equal(p.json("show", "PRM-0001").body.record.statement, "期限は 3 か月");
});

// ---------------------------------------------------------------- INV-3

test("INV-03 承認されていないゲートは提出時に要求されない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "quality", { gates: { add: [{ id: "GATE-0002", workItem: "WI-0002", type: "adversarial-review", description: "敵対的レビュー" }] } }));
  p.file("report.md", "検証結果");
  const r = p.json("submit", "WI-0002", "--file", "検証報告=report.md");
  assert.equal(r.code, 0, JSON.stringify(r.body));
});

test("INV-03 却下・廃止したゲートは提出時に要求されない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "quality", { gates: { add: [{ id: "GATE-0002", workItem: "WI-0002", type: "adversarial-review", description: "敵対的レビュー" }] } }));
  assert.equal(p.json("reject", "PRP-0005", "--reason", "不要").code, 0);
  p.draft(proposal("PRP-0006", "quality", { gates: { retire: ["GATE-0001"] } }));
  p.approve("PRP-0006");
  p.file("design.md", "設計");
  p.file("report.md", "検証結果");
  assert.equal(p.json("submit", "WI-0001", "--file", "設計書=design.md").code, 0);
  assert.equal(p.json("submit", "WI-0002", "--file", "検証報告=report.md").code, 0);
});

// ---------------------------------------------------------------- INV-4

test("INV-04 付いているゲートの通過記録が無ければ受け付けない", (t) => {
  const p = setup(t);
  p.file("design.md", "設計");
  const r = p.json("submit", "WI-0001", "--file", "設計書=design.md");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("GATE-0001") && x.includes("通過記録がありません")));
});

test("INV-04 不通過のゲートがあれば受け付けない", (t) => {
  const p = setup(t);
  p.file("design.md", "設計");
  const r = p.json("submit", "WI-0001", "--file", "設計書=design.md", "--gate", "id=GATE-0001,by=部長,at=2026-11-20,result=fail");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("不通過")));
});

test("INV-04 付いていないゲート・重複・誰が／いつの不備を受け付けない", (t) => {
  const p = setup(t);
  p.file("design.md", "設計");
  const r = p.json("submit", "WI-0001", "--file", "設計書=design.md",
    "--gate", gate(), "--gate", gate(), "--gate", "id=GATE-0009,by=部長,at=2026-11-20,result=pass");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("GATE-0009") && x.includes("付いていません")));
  assert.ok(r.body.problems.some((x) => x.includes("記録が 2 つあります")));
  const bad = p.json("submit", "WI-0001", "--file", "設計書=design.md", "--gate", "id=GATE-0001,by= ,at=来週,result=pass");
  assert.ok(bad.body.problems.some((x) => x.includes("by")));
  assert.ok(bad.body.problems.some((x) => x.includes("at")));
});

test("INV-04 すべてのゲートが通過なら受け付け、通過記録を残す", (t) => {
  const p = setup(t);
  p.file("design.md", "設計");
  const r = p.json("submit", "WI-0001", "--file", "設計書=design.md", "--gate", gate());
  assert.equal(r.code, 0, JSON.stringify(r.body));
  const wi = p.json("show", "WI-0001").body;
  assert.equal(wi.record.state, "done");
  assert.deepEqual(wi.gateRecords.map((g) => [g.gate, g.by, g.at, g.result]), [["GATE-0001", "部長", "2026-11-20", "pass"]]);
});

// ---------------------------------------------------------------- INV-5

test("INV-05 下書きは WorkItem の状態を書けない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-01-31", workItems: [
    { id: "WI-0001", title: "設計", type: "execute", deliverables: ["設計書"], state: "done" },
  ] }));
  const r = p.json("check", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.results[0].problems.some((x) => x.includes("未知の項目 state")));
});

test("INV-05 進捗報告は WorkItem を進行中にするだけで完了にしない", (t) => {
  const p = setup(t);
  p.draft(record("DRF-0001", "progress", { workItem: "WI-0001", date: "2026-10-20", text: "完了しました" }));
  const r = p.approve("DRF-0001");
  assert.equal(r.effects.started, "WI-0001");
  assert.equal(p.json("show", "WI-0001").body.record.state, "doing");
});

// ---------------------------------------------------------------- INV-6

test("INV-06 導出や入力の無い推定は検査で落ちる", (t) => {
  const p = setup(t);
  p.draft(estimate("EST-0002", { derivation: "" }));
  p.draft(estimate("EST-0003", { inputs: [] }));
  const r = p.json("check");
  assert.equal(r.code, 1);
  const by = Object.fromEntries(r.body.results.map((x) => [x.id, x.problems]));
  assert.ok(by["EST-0002"].some((x) => x.includes("INV-6")));
  assert.ok(by["EST-0003"].some((x) => x.includes("INV-6")));
});

test("INV-06 導出の無い推定を参照する提案は承認できない", (t) => {
  const p = setup(t);
  p.draft(estimate("EST-0002", { derivation: "" }));
  p.draft(proposal("PRP-0005", "advice", {}, ["EST-0002"]));
  const r = p.json("approve", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("INV-6")));
});

test("INV-06 推定の入力には仮置きを使え、前提の承認を待たずに検査を通る（PHASE-IDEATION.md「決めたこと」2）", (t) => {
  const p = setup(t);
  p.draft(estimate("EST-0002", { subject: "減る手入力の時間", method: "fermi", value: { low: 83, high: 133, unit: "時間/月" },
    derivation: "2,000 枚/月 × 5 分 × 自動で読める割合 50〜80% ÷ 60",
    inputs: [{ quote: "月に 2,000 枚くらい" }, { quote: "1 枚 5 分くらい" }, { assume: "自動で読める割合は 50〜80%" }] }));
  assert.equal(p.json("check", "EST-0002").code, 0);
  const r = p.approve(p.draft(proposal("PRP-0005", "advice", {}, ["EST-0002"])));
  assert.deepEqual(r.estimates, ["EST-0002"]);
  assert.deepEqual(p.json("show", "EST-0002").body.record.inputs[2], { assume: "自動で読める割合は 50〜80%" });
});

test("INV-06 仮置きは空にできず、引用と一緒にも持てない", (t) => {
  const p = setup(t);
  p.draft(estimate("EST-0002", { inputs: [{ assume: "" }] }));
  p.draft(estimate("EST-0003", { inputs: [{ assume: "割合は 50%", quote: "半分くらい" }] }));
  const by = Object.fromEntries(p.json("check").body.results.map((x) => [x.id, x.problems]));
  assert.ok(by["EST-0002"].some((x) => x.includes("inputs[0].assume")));
  assert.ok(by["EST-0003"].some((x) => x.includes("どれか 1 つだけ")));
});

// ---------------------------------------------------------------- INV-7

test("INV-07 仮置きは提案の根拠にならない。根拠は記録・推定・リーダーの発言だけ", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "advice", {}, [{ assume: "割合は 50%" }]));
  const r = p.json("check", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.results[0].problems.some((x) => x.includes("未知の項目 assume")));
});

test("INV-07 根拠の無い提案は承認できない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "advice", {}, []));
  const r = p.json("approve", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("INV-7")));
});

test("INV-07 解決できない根拠を持つ提案は承認できない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "advice", {}, ["RPT-0042"]));
  const r = p.json("approve", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("RPT-0042")));
});

// ---------------------------------------------------------------- INV-10

test("INV-10 成果物を生む WorkItem に完了報告は使えない", (t) => {
  const p = setup(t);
  p.draft(record("DRF-0001", "completion", { workItem: "WI-0001", date: "2026-10-20", text: "終わった" }));
  const r = p.json("approve", "DRF-0001");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("INV-10")));
  assert.equal(p.json("show", "WI-0001").body.record.state, "todo");
});

// ---------------------------------------------------------------- INV-11

test("INV-11 フェーズは次への遷移と前への戻りだけ許す", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "phase", { to: "executing" }));
  const skip = p.json("approve", "PRP-0005");
  assert.equal(skip.code, 1);
  assert.ok(skip.body.problems.some((x) => x.includes("INV-11")));
  p.draft(proposal("PRP-0005", "phase", { to: "planning" }));
  assert.deepEqual(p.approve("PRP-0005").effects.phase, { from: "ideation", to: "planning" });
  p.draft(proposal("PRP-0006", "phase", { to: "ideation" }));
  assert.equal(p.approve("PRP-0006").effects.phase.to, "ideation");
});

test("INV-11 終了したらフェーズは変えられない", (t) => {
  const p = setup(t);
  for (const [id, to] of [["PRP-0005", "planning"], ["PRP-0006", "executing"], ["PRP-0007", "closed"]]) {
    p.draft(proposal(id, "phase", { to }));
    p.approve(id);
  }
  p.draft(proposal("PRP-0008", "phase", { to: "executing" }));
  const r = p.json("approve", "PRP-0008");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("終了")));
});

test("INV-11 フェーズ遷移の提案以外ではフェーズが変わらない", (t) => {
  const p = setup(t);
  assert.equal(p.json("status").body.phase, "ideation");
  p.draft(record("DRF-0001", "completion", { workItem: "WI-0003", date: "2026-10-20", text: "実施した" }));
  p.approve("DRF-0001");
  assert.equal(p.json("status").body.phase, "ideation");
});

// ---------------------------------------------------------------- INV-12

test("INV-12 2 回目の提出は受け付けない", (t) => {
  const p = setup(t);
  p.file("design.md", "設計");
  assert.equal(p.json("submit", "WI-0001", "--file", "設計書=design.md", "--gate", gate()).code, 0);
  p.file("design2.md", "設計の改訂");
  const r = p.json("submit", "WI-0001", "--file", "設計書=design2.md", "--gate", gate());
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("INV-12")));
  assert.deepEqual(p.deliverableFiles(), ["WI-0001/設計書/design.md"]);
});

test("INV-12 提出した成果物を書き換える・足すと verify が検知する", (t) => {
  const p = setup(t);
  p.file("design.md", "設計");
  p.json("submit", "WI-0001", "--file", "設計書=design.md", "--gate", gate());
  assert.equal(p.json("verify").body.ok, true);
  p.file(".hitp/deliverables/WI-0001/設計書/design.md", "差し替え");
  p.file(".hitp/deliverables/WI-0001/設計書/extra.md", "追加");
  const r = p.json("verify");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("一致しません")));
  assert.ok(r.body.problems.some((x) => x.includes("記録にない成果物")));
});

test("INV-12 完了した WorkItem は新しい計画に載せられない", (t) => {
  const p = setup(t);
  p.draft(record("DRF-0001", "completion", { workItem: "WI-0003", date: "2026-10-20", text: "実施した" }));
  p.approve("DRF-0001");
  p.draft(proposal("PRP-0005", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-02-28", workItems: [
    { id: "WI-0001", title: "設計", type: "execute", deliverables: ["設計書"] },
    { id: "WI-0003", title: "キックオフ（やり直し）", type: "execute" },
  ] }));
  const r = p.json("approve", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("WI-0003") && x.includes("完了")));
});

// ---------------------------------------------------------------- INV-13

test("INV-13 成果物を生まない WorkItem にゲートは付けられない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "quality", { gates: { add: [{ id: "GATE-0002", workItem: "WI-0003", type: "other", description: "確認" }] } }));
  const r = p.json("approve", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("INV-13")));
});

test("INV-13 ゲートが付いた WorkItem から成果物を消す計画は承認できない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-01-31", workItems: [
    { id: "WI-0001", title: "設計", type: "execute", deliverables: [] },
    { id: "WI-0002", title: "API の応答時間の検証", type: "explore", question: "1 秒以内に応答するか", tests: ["PRM-0002"], deliverables: ["検証報告"] },
    { id: "WI-0003", title: "キックオフ", type: "execute" },
  ] }));
  const r = p.json("approve", "PRP-0005");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("INV-13")));
});

// ---------------------------------------------------------------- INV-14

test("INV-14 成果物を生まない WorkItem は提出できない", (t) => {
  const p = setup(t);
  p.file("memo.md", "議事録");
  const r = p.json("submit", "WI-0003", "--file", "議事録=memo.md");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("INV-14")));
});

test("INV-14 成果物を生まない WorkItem は完了報告の承認で完了する", (t) => {
  const p = setup(t);
  p.draft(record("DRF-0001", "completion", { workItem: "WI-0003", date: "2026-10-20", text: "キックオフを実施した" }));
  const r = p.approve("DRF-0001");
  assert.equal(r.event.data.record, "RPT-0001");
  assert.equal(r.effects.completed, "WI-0003");
  const shown = p.json("show", "RPT-0001").body.record;
  assert.equal(shown.completion, true);
});

// ---------------------------------------------------------------- INV-15

test("INV-15 不足のある提出は不足をまとめて示し、何も保存しない", (t) => {
  const p = setup(t);
  const before = p.eventsText();
  p.file("design.md", "設計");
  const r = p.json("submit", "WI-0001", "--file", "設計書=design.md", "--file", "見積書=missing.xlsx");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("missing.xlsx")));
  assert.ok(r.body.problems.some((x) => x.includes("見積書") && x.includes("宣言されていません")));
  assert.ok(r.body.problems.some((x) => x.includes("GATE-0001")));
  assert.equal(p.eventsText(), before);
  assert.deepEqual(p.deliverableFiles(), []);
});

test("INV-15 宣言した成果物の種類が欠けた提出は受け付けない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-01-31", workItems: [
    { id: "WI-0001", title: "設計", type: "execute", deliverables: ["設計書", "見積書"] },
    { id: "WI-0002", title: "API の応答時間の検証", type: "explore", question: "1 秒以内に応答するか", tests: ["PRM-0002"], deliverables: ["検証報告"] },
    { id: "WI-0003", title: "キックオフ", type: "execute" },
  ] }));
  p.approve("PRP-0005");
  p.file("design.md", "設計");
  const r = p.json("submit", "WI-0001", "--file", "設計書=design.md", "--gate", gate());
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("見積書") && x.includes("ありません")));
  assert.deepEqual(p.deliverableFiles(), []);
});
