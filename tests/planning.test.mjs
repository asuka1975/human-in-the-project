// 計画フェーズのための hitp（docs/PHASE-PLANNING.md）: 稼働、工数の単位、replaces、見通し、表示。
import { test } from "node:test";
import assert from "node:assert/strict";
import { project, proposal, estimate } from "./helpers.mjs";

// 正午（UTC）にしておけば、どの時間帯の機械でも今日は 2026-11-02（月）になる
const NOW = "2026-11-02T12:00:00.000Z";

const effort = (id, subject, low, high) => estimate(id, { subject, value: { low, high, unit: "人日" } });
const wi = (id, title, assignee, est, more = {}) => ({ id, title, type: "execute", assignee, estimate: est, deliverables: [title], ...more });
const firstPlan = (id = "PRP-0004", deadline = "2027-01-29", over = {}) => proposal(id, "plan", { id: "PLAN-0001", replaces: null, deadline, workItems: [
  wi("WI-0001", "企画書", "MEM-0001", "EST-0005"),
  { ...wi("WI-0002", "検証報告", "MEM-0002", "EST-0001"), type: "explore", question: "自動で読める割合は 50% 以上か", tests: ["PRM-0001"] },
  wi("WI-0003", "業務フロー図", "MEM-0001", "EST-0002"),
  wi("WI-0004", "連携プログラム", "MEM-0003", over.implEstimate ?? "EST-0003", { dependsOn: ["WI-0002", "WI-0003"] }),
  wi("WI-0005", "試行報告", "MEM-0001", "EST-0004", { dependsOn: ["WI-0004"] }),
] }, ["PRM-0001"]);

/** PHASE-PLANNING.md の例: 佐藤（週 5）、鈴木（週 2）、田中（週 5）、工数の推定 5 件。計画はまだ下書きだけ。 */
function example(t, { capacity = { "MEM-0001": 5, "MEM-0002": 2, "MEM-0003": 5 } } = {}) {
  const p = project({ now: NOW });
  t.after(p.cleanup);
  p.run("init", "受注処理の自動化");
  p.approve(p.draft(proposal("PRP-0001", "premises", { add: [{ id: "PRM-0001", type: "assumption", statement: "自動で読める割合は 50〜80%" }] })));
  const member = (id, name, availability) => ({ id, name, availability, ...(capacity[id] === undefined ? {} : { capacity: capacity[id] }) });
  p.approve(p.draft(proposal("PRP-0002", "members", { add: [member("MEM-0001", "佐藤", "専任"), member("MEM-0002", "鈴木", "兼務で週 2 日"), member("MEM-0003", "田中", "専任")] })));
  p.draft(effort("EST-0001", "読み取り率の検証", 4, 8));
  p.draft(effort("EST-0002", "業務フローの整理", 5, 8));
  p.draft(effort("EST-0003", "OCR 連携の実装", 24, 48));
  p.draft(effort("EST-0004", "試行運用", 10, 15));
  p.draft(effort("EST-0005", "企画書の作成", 2, 3));
  return p;
}

test("見通し: 依存の鎖をたどった完了見込みと、人ごとの負荷を、下限と上限で出す", (t) => {
  const p = example(t);
  p.draft(firstPlan());
  const draft = p.json("check", "PRP-0004").body.results[0];
  assert.deepEqual(draft.problems, []);
  assert.deepEqual(draft.forecast.finish, { low: 44, high: 83 });
  assert.equal(draft.forecast.availableDays, 65);
  assert.deepEqual(draft.forecast.overBy, { low: 0, high: 18 });
  assert.deepEqual(draft.forecast.members.map((m) => [m.id, m.load.low, m.load.high, m.capacityDays]), [["MEM-0001", 17, 26, 65], ["MEM-0002", 4, 8, 26], ["MEM-0003", 24, 48, 65]]);
  assert.match(p.run("check", "PRP-0004").stdout, /承認したときの見通し:\n    完了見込み: 44〜83 営業日／期限 2027-01-29 まで 65 営業日（上限で 18 営業日超える）/);

  p.approve("PRP-0004");
  const s = p.json("status").body;
  assert.deepEqual(s.forecast.finish, { low: 44, high: 83 });
  const text = p.run("status").stdout;
  assert.match(text, /^計画の見通し\n  完了見込み: 44〜83 営業日／期限 2027-01-29 まで 65 営業日（上限で 18 営業日超える）\n  人ごとの負荷: MEM-0001 佐藤 17〜26 人日／稼働 65 人日、MEM-0002 鈴木 4〜8 人日／稼働 26 人日、MEM-0003 田中 24〜48 人日／稼働 65 人日\n  （2026-11-02 から。/m);
});

test("見通し: 期限を延ばす・範囲を減らす案は、計画の下書きどうしで並べて比べられる", (t) => {
  const p = example(t);
  p.draft(firstPlan("PRP-0004"));
  p.draft({ ...firstPlan("PRP-0005", "2027-02-26"), title: "案 A: 期限を 2 月末に" });
  p.draft(effort("EST-0006", "OCR 連携の実装（PDF だけ）", 16, 32));
  p.draft({ ...firstPlan("PRP-0006", "2027-01-29", { implEstimate: "EST-0006" }), title: "案 C: 範囲を PDF だけに" });
  const by = Object.fromEntries(p.json("check").body.results.map((r) => [r.id, r]));
  for (const id of ["PRP-0004", "PRP-0005", "PRP-0006"]) assert.deepEqual(by[id].problems, [], `${id}: 同じ計画を置き換える案どうしは同じ WI を作ってよい`);
  assert.deepEqual([by["PRP-0005"].forecast.availableDays, by["PRP-0005"].forecast.overBy.high], [85, 0]);
  assert.deepEqual([by["PRP-0006"].forecast.finish.high, by["PRP-0006"].forecast.overBy.high], [67, 2]);
  assert.match(p.run("check", "PRP-0005").stdout, /上限まで収まる/);
});

test("見通し: show --capacity で稼働を仮に置き換えて比べられる。記録は変わらない", (t) => {
  const p = example(t);
  p.draft(firstPlan());
  const r = p.json("show", "PRP-0004", "--capacity", "MEM-0002=3");
  assert.deepEqual(r.body.forecast.finish, { low: 41, high: 76.3 });
  assert.match(p.run("show", "PRP-0004", "--capacity", "MEM-0002=3").stdout, /仮に置き換えた稼働: MEM-0002 週 3 日/);
  p.approve("PRP-0004");
  assert.deepEqual(p.json("show", "PLAN-0001", "--capacity", "MEM-0002=3").body.forecast.finish, { low: 41, high: 76.3 });
  assert.equal(p.json("status").body.members.find((m) => m.id === "MEM-0002").capacity, 2);
  assert.equal(p.json("show", "PRP-0004", "--capacity", "MEM-0009=3").code, 2);
  assert.equal(p.json("show", "PLAN-0001", "--capacity", "MEM-0002=週3").code, 2);
});

test("見通し: 稼働の無い担当や推定の無い WorkItem は、見通しに入れずに挙げる。完了した WorkItem は 0 で数える", (t) => {
  const p = example(t, { capacity: { "MEM-0001": 5, "MEM-0003": 5 } });
  p.approve(p.draft(firstPlan()));
  const f = p.json("status").body.forecast;
  assert.deepEqual(f.missing, ["WI-0002 の担当 MEM-0002 に週の稼働日がありません"]);
  assert.match(p.run("status").stdout, /見通しに入っていないもの: WI-0002 の担当 MEM-0002 に週の稼働日がありません/);
  assert.match(p.run("status").stdout, /営業日（上限[^）]*。見通しに入っていないものを除いた数字）/);
  p.file("plan.md", "企画書");
  p.approve(p.draft(proposal("PRP-0005", "quality", { gates: { add: [] }, goals: { add: [{ id: "QG-0001", target: "WI-0001", type: "qualitative", statement: "x" }] } }, ["WI-0001"])));
  assert.equal(p.json("submit", "WI-0001", "--file", "企画書=plan.md").code, 0);
  const after = p.json("status").body.forecast;
  assert.deepEqual(after.items.find((x) => x.id === "WI-0001").finish, { low: 0, high: 0 });
  assert.deepEqual(after.members.find((m) => m.id === "MEM-0001").load, { low: 15, high: 23 });
});

test("replaces: 今の計画と一致しない案は承認できない。1 つを承認すると、ほかの案は承認できなくなる", (t) => {
  const p = example(t);
  p.draft(firstPlan("PRP-0004"));
  p.draft({ ...firstPlan("PRP-0005", "2027-02-26"), title: "案 A" });
  p.approve("PRP-0005");
  const stale = p.json("check", "PRP-0004").body.results[0].problems;
  assert.ok(stale.some((x) => x.includes("今の計画は PLAN-0001 です") && x.includes('replaces: "PLAN-0001"')), JSON.stringify(stale));
  assert.equal(p.json("reject", "PRP-0004", "--reason", "案 A を選んだ").code, 0);
  // 置き換える計画を書けば、次の計画として承認できる
  p.draft(proposal("PRP-0006", "plan", { ...firstPlan().payload, id: "PLAN-0002", replaces: "PLAN-0001" }, ["PRM-0001"]));
  assert.equal(p.json("approve", "PRP-0006").code, 0);
});

test("replaces は必須で、計画の ID か null", (t) => {
  const p = example(t);
  const { replaces, ...noReplaces } = firstPlan().payload;
  p.draft(proposal("PRP-0004", "plan", noReplaces, ["PRM-0001"]));
  p.draft(proposal("PRP-0005", "plan", { ...firstPlan().payload, replaces: "WI-0001" }, ["PRM-0001"]));
  const by = Object.fromEntries(p.json("check").body.results.map((r) => [r.id, r.problems]));
  assert.ok(by["PRP-0004"].some((x) => x.includes("replaces がありません")));
  assert.ok(by["PRP-0005"].some((x) => x.includes("replaces は PLAN-0000 の形")));
});

test("計画の WorkItem の推定は、工数見積で単位が人日のものだけ", (t) => {
  const p = example(t);
  p.draft(estimate("EST-0006", { subject: "効果", method: "fermi", value: { low: 1, high: 2, unit: "人日" } }));
  p.draft(estimate("EST-0007", { subject: "工数（時間）", value: { low: 30, high: 60, unit: "時間" } }));
  const plan = firstPlan().payload;
  plan.workItems[0] = { ...plan.workItems[0], estimate: "EST-0006" };
  plan.workItems[2] = { ...plan.workItems[2], estimate: "EST-0007" };
  p.draft(proposal("PRP-0004", "plan", plan, ["PRM-0001"]));
  const problems = p.json("check", "PRP-0004").body.results[0].problems;
  assert.ok(problems.some((x) => x.includes("WI-0001 の推定 EST-0006 は工数見積（effort）で単位が「人日」") && x.includes("fermi")));
  assert.ok(problems.some((x) => x.includes("WI-0003 の推定 EST-0007") && x.includes("時間")));
});

test("メンバーの稼働は 0〜5 の数", (t) => {
  const p = example(t);
  p.draft(proposal("PRP-0004", "members", { add: [{ id: "MEM-0004", name: "山田", capacity: 6 }, { id: "MEM-0005", name: "高橋", capacity: "週 3" }, { id: "MEM-0006", name: "伊藤", capacity: 2.5 }] }));
  const problems = p.json("check", "PRP-0004").body.results[0].problems;
  assert.equal(problems.filter((x) => x.includes("capacity は週の稼働日")).length, 2);
});

test("status はメンバーの一覧と、WorkItem の工数の幅・依存先を出す", (t) => {
  const p = example(t);
  p.approve(p.draft(firstPlan()));
  const text = p.run("status").stdout;
  assert.match(text, /^メンバー\n  MEM-0001 佐藤 週の稼働日 5（専任）\n  MEM-0002 鈴木 週の稼働日 2（兼務で週 2 日）\n  MEM-0003 田中 週の稼働日 5（専任）$/m);
  assert.match(text, /WI-0004 \[未着手\] 連携プログラム（実行、担当 MEM-0003、工数 24〜48 人日、WI-0002・WI-0003 のあと、成果物 連携プログラム）/);
});

test("参照が見つからなくても、提案の中身の問題まで一度に出す", (t) => {
  const p = example(t);
  const plan = firstPlan().payload;
  plan.workItems[0] = { ...plan.workItems[0], assignee: "MEM-0009" };
  p.draft(proposal("PRP-0004", "plan", plan, ["PRM-0009"]));
  const problems = p.json("check", "PRP-0004").body.results[0].problems;
  assert.ok(problems.some((x) => x.includes("PRM-0009 が見つかりません")));
  assert.ok(problems.some((x) => x.includes("MEM-0009 がメンバーにいません")));
});

test("見通し: 計画が参照する承認待ちのメンバー・前提の提案も、承認したとして計算し、そのことを示す", (t) => {
  const p = project({ now: NOW });
  t.after(p.cleanup);
  p.run("init", "受注処理の自動化");
  p.draft(proposal("PRP-0001", "premises", { add: [{ id: "PRM-0001", type: "assumption", statement: "自動で読める割合は 50〜80%" }] }));
  p.draft(proposal("PRP-0002", "members", { add: [
    { id: "MEM-0001", name: "佐藤", capacity: 5 }, { id: "MEM-0002", name: "鈴木", capacity: 2 }, { id: "MEM-0003", name: "田中", capacity: 5 },
  ] }));
  p.draft(proposal("PRP-0003", "members", { add: [{ id: "MEM-0004", name: "関係ない人", capacity: 5 }] }));
  for (const [id, subject, low, high] of [["EST-0001", "検証", 4, 8], ["EST-0002", "業務フロー", 5, 8], ["EST-0003", "実装", 24, 48], ["EST-0004", "試行", 10, 15], ["EST-0005", "企画書", 2, 3]]) p.draft(effort(id, subject, low, high));
  p.draft(firstPlan());
  const r = p.json("check", "PRP-0004").body.results[0];
  assert.ok(r.problems.some((x) => x.includes("がメンバーにいません")), "計画そのものはまだ承認できない");
  assert.deepEqual(r.forecast.assumedDrafts, ["PRP-0001", "PRP-0002"], "計画が参照しないメンバーの提案は入れない");
  assert.deepEqual(r.forecast.finish, { low: 44, high: 83 });
  assert.match(p.run("check", "PRP-0004").stdout, /問題が \d+ 件[\s\S]*承認したときの見通し:\n    完了見込み: 44〜83 営業日[\s\S]*承認待ちの PRP-0001・PRP-0002 も承認したとして計算した/);
});

test("待ち: 待ちの営業日は依存の鎖に足し、担当者の負荷には入れない。待ちの間、担当者はほかを進める", (t) => {
  const p = example(t);
  p.draft(effort("EST-0006", "承認待ちのある作業", 2, 3));
  p.draft(effort("EST-0007", "並行する作業", 5, 8));
  p.draft(effort("EST-0008", "待ちのあとの作業", 10, 10));
  p.draft(proposal("PRP-0004", "plan", { id: "PLAN-0001", replaces: null, deadline: "2027-01-29", workItems: [
    wi("WI-0001", "企画書", "MEM-0001", "EST-0006", { waitDays: 5 }),
    wi("WI-0002", "業務フロー図", "MEM-0001", "EST-0007"),
    wi("WI-0003", "連携プログラム", "MEM-0003", "EST-0008", { dependsOn: ["WI-0001"] }),
    { id: "WI-0004", title: "ベンダーの納品待ち", type: "execute", waitDays: 3, dependsOn: ["WI-0003"] },
  ] }, ["PRM-0001"]));
  const f = p.json("check", "PRP-0004").body.results[0].forecast;
  // 佐藤: 企画書 2〜3 → 承認待ち 5（その間に業務フロー 5〜8）。田中は承認のあと 10。納品待ち 3
  assert.deepEqual(f.items.map((x) => [x.id, x.finish.low, x.finish.high]), [["WI-0001", 7, 8], ["WI-0002", 7, 11], ["WI-0003", 17, 18], ["WI-0004", 20, 21]]);
  assert.deepEqual(f.finish, { low: 20, high: 21 });
  assert.deepEqual(f.missing, [], "待ちだけの WorkItem は、担当・工数が無くても見通しに入る");
  assert.deepEqual(f.members.find((m) => m.id === "MEM-0001").load, { low: 7, high: 11 }, "待ちは負荷に入らない");
  p.approve("PRP-0004");
  assert.match(p.run("status").stdout, /WI-0001 \[未着手\] 企画書（実行、担当 MEM-0001、工数 2〜3 人日、待ち 5 営業日、/);
});

test("待ちの営業日は 0 以上の数", (t) => {
  const p = example(t);
  const plan = firstPlan().payload;
  plan.workItems[0] = { ...plan.workItems[0], waitDays: -1 };
  plan.workItems[2] = { ...plan.workItems[2], waitDays: "1 週間" };
  p.draft(proposal("PRP-0004", "plan", plan, ["PRM-0001"]));
  assert.equal(p.json("check", "PRP-0004").body.results[0].problems.filter((x) => x.includes("waitDays は待ちの営業日")).length, 2);
});
