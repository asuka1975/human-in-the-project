// コードレビューで見つかった問題の再発防止。
import { test } from "node:test";
import assert from "node:assert/strict";
import { project, base, proposal } from "./helpers.mjs";
import { guardBash } from "../.apm/skills/hitp/scripts/lib/guard.mjs";

function setup(t, withBase = true) {
  const p = project();
  t.after(p.cleanup);
  return withBase ? base(p) : p;
}

const gate2 = (workItem, type = "adversarial-review") => ({ gates: { add: [{ id: "GATE-0002", workItem, type, description: "レビュー" }] } });

test("指摘 1: 2 つの下書きが同じ ID を新しく作ると check が両方に問題を出し、2 つ目の承認は通らない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "quality", gate2("WI-0002")));
  p.draft(proposal("PRP-0006", "quality", gate2("WI-0001", "presentation-feedback")));
  const c = p.json("check");
  assert.equal(c.code, 1);
  for (const r of c.body.results) assert.ok(r.problems.some((x) => x.includes("GATE-0002") && x.includes("でも新しく作られます")), r.id);
  p.approve("PRP-0005");
  const second = p.json("approve", "PRP-0006");
  assert.equal(second.code, 1);
  assert.ok(second.body.problems.some((x) => x.includes("GATE-0002 はすでに使われています")));
  assert.equal(p.json("show", "GATE-0002").body.record.workItem, "WI-0002");
});

test("指摘 1: 既存の ID を変えるには update が要り、承認の結果に「更新」として出る", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "quality", { gates: { update: [{ id: "GATE-0001", workItem: "WI-0001", type: "supervisor-approval", description: "本部長の承認" }] } }));
  const r = p.approve("PRP-0005");
  assert.deepEqual(r.effects.updated, ["GATE-0001"]);
  assert.match(p.run("show", "GATE-0001").stdout, /本部長/);
  p.draft(proposal("PRP-0006", "objectives", { update: [{ id: "OBJ-0009", statement: "存在しない" }] }));
  assert.ok(p.json("approve", "PRP-0006").body.problems.some((x) => x.includes("更新する OBJ-0009 が見つかりません")));
});

test("指摘 2: 記録の末尾を消すと verify が検知し、書き込み系は止まる", (t) => {
  const p = setup(t);
  p.approve(p.draft(proposal("PRP-0005", "cancel", { workItems: ["WI-0003"] })));
  const lines = p.eventsText().split("\n").filter(Boolean);
  p.writeEventsText(lines.slice(0, -1).join("\n") + "\n");
  const v = p.json("verify");
  assert.equal(v.code, 1);
  assert.ok(v.body.problems.some((x) => x.includes("HEAD") && x.includes("一致しません")));
  p.draft(proposal("PRP-0006", "advice", {}));
  const a = p.json("approve", "PRP-0006");
  assert.equal(a.code, 1);
  assert.ok(a.body.problems.some((x) => x.includes("書き込みを止めました")));
  assert.equal(p.json("status").body.warnings.length, 1);
});

test("指摘 3: 引用符・drafts/..・cd・パイプによるすり抜けを拒否する", () => {
  for (const c of [
    'hitp "approve" PRP-0009',
    "node .claude/skills/hitp/scripts/hitp.mjs 'submit' WI-0001 --file a=b",
    "bash -c 'hitp approve PRP-0001'",
    "echo $(hitp approve PRP-0001)",
    "sed -i '$d' .hitp/drafts/../records/events.jsonl",
    "cp x .hitp/drafts/../deliverables/WI-0001/設計書/a.md",
    "cd .hitp/drafts && echo x >> ../records/events.jsonl",
    "ls -d .hitp/records/events.jsonl | xargs rm -f",
  ]) {
    assert.ok(guardBash(c), c);
  }
});

test("指摘 4: 削除した前提の ID は再発行も再利用もされない", (t) => {
  const p = setup(t);
  p.approve(p.draft(proposal("PRP-0005", "premises", { add: [{ id: "PRM-0003", type: "constraint", statement: "予算は 500 万円" }] })));
  p.approve(p.draft(proposal("PRP-0006", "premises", { remove: ["PRM-0003"] })));
  assert.equal(p.json("status").body.nextIds.PRM, "PRM-0004");
  p.draft(proposal("PRP-0007", "premises", { add: [{ id: "PRM-0003", type: "assumption", statement: "ユーザーは 1 万人" }] }));
  assert.ok(p.json("approve", "PRP-0007").body.problems.some((x) => x.includes("PRM-0003 はすでに使われています")));
  p.draft(proposal("PRP-0008", "premises", { update: [{ id: "PRM-0003", type: "assumption", statement: "ユーザーは 1 万人" }] }));
  assert.ok(p.json("approve", "PRP-0008").body.problems.some((x) => x.includes("削除済み")));
  assert.equal(p.json("show", "PRM-0003").body.record.statement, "予算は 500 万円");
});

test("指摘 4: 削除したメンバーを担当にした計画は承認できない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "members", { remove: ["MEM-0001"] }));
  assert.equal(p.json("approve", "PRP-0005").code, 1, "未完了の WI-0001 の担当なので削除できない");
});

test("指摘 5: 廃止したゲートは update で復活させられない", (t) => {
  const p = setup(t);
  p.approve(p.draft(proposal("PRP-0005", "quality", { gates: { retire: ["GATE-0001"] } })));
  p.draft(proposal("PRP-0006", "quality", { gates: { update: [{ id: "GATE-0001", workItem: "WI-0001", type: "supervisor-approval", description: "説明の修正" }] } }));
  const r = p.json("approve", "PRP-0006");
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("廃止済み")));
});

test("指摘 6: 実在しない日付と、桁の違う同じ番号の ID を受け付けない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-02-30", workItems: [{ id: "WI-00001", title: "x", type: "execute" }] }));
  const r = p.json("check", "PRP-0005");
  assert.ok(r.body.results[0].problems.some((x) => x.includes("deadline")));
  assert.ok(r.body.results[0].problems.some((x) => x.includes("WI-00001")));
  p.file("design.md", "設計");
  const s = p.json("submit", "WI-0001", "--file", "設計書=design.md", "--gate", "id=GATE-0001,by=部長,at=2026-02-30,result=pass");
  assert.ok(s.body.problems.some((x) => x.includes("at")));
});

test("指摘 7: 壊れた行や init 前でも、落ちずに問題として報告する", (t) => {
  const p = setup(t);
  p.writeEventsText(p.eventsText() + "null\n");
  const v = p.json("verify");
  assert.equal(v.code, 1);
  assert.ok(v.body.problems.some((x) => x.includes("イベントの形ではありません")));
  assert.equal(p.json("status").code, 1);

  const q = setup(t, false);
  q.draft(proposal("PRP-0001", "advice", {}));
  const s = q.json("status");
  assert.equal(s.code, 1);
  assert.ok(s.body.problems[0].includes("hitp init"));
});

test("指摘 8: よく使う読み取りのコマンドは止めない", () => {
  for (const c of [
    "jq 'select(.seq > 3)' .hitp/records/events.jsonl",
    "grep -c '=>' .hitp/records/events.jsonl",
    'grep -rn "hitp approve" docs/',
    "cat .claude/skills/hitp/scripts/lib/schema.mjs",
    "find .hitp -name '*.json'",
    "tree .hitp",
    "sed -n '1,3p' .hitp/records/events.jsonl",
    "test -f .hitp/records/events.jsonl && echo ある",
    "git --no-pager log -- .hitp/records/events.jsonl",
    "jq . < .hitp/records/events.jsonl",
  ]) {
    assert.equal(guardBash(c), null, c);
  }
  for (const c of ["find .hitp -name '*.jsonl' -delete", "sed -i 's/a/b/' .hitp/records/events.jsonl", "sed -n 'w out' .hitp/records/events.jsonl"]) {
    assert.ok(guardBash(c), c);
  }
});

test("指摘 9（仕様）: ほかの未完了 WorkItem が依存している WorkItem は中止できない", (t) => {
  const p = setup(t);
  p.approve(p.draft(proposal("PRP-0005", "plan", { id: "PLAN-0002", replaces: "PLAN-0001", deadline: "2027-01-31", workItems: [
    { id: "WI-0001", title: "設計", type: "execute", deliverables: ["設計書"] },
    { id: "WI-0002", title: "API の応答時間の検証", type: "explore", question: "1 秒以内に応答するか", tests: ["PRM-0002"], deliverables: ["検証報告"] },
    { id: "WI-0003", title: "キックオフ", type: "execute", dependsOn: ["WI-0002"] },
  ] })));
  const r = p.json("approve", p.draft(proposal("PRP-0006", "cancel", { workItems: ["WI-0002"] })));
  assert.equal(r.code, 1);
  assert.ok(r.body.problems.some((x) => x.includes("WI-0003") && x.includes("中止")));
});

test("L4 の観察: 使えない ID の下書きには、次に使える ID と、Write で書き直す手順を示す", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0001", "advice", {}));
  const problems = p.json("check", "PRP-0001").body.results[0].problems;
  assert.ok(problems.some((x) => x.includes("PRP-0001 はすでに承認されています") && x.includes("次に使える ID は PRP-0005") && x.includes("Write で PRP-0005 の下書きを書き直し")), JSON.stringify(problems));
  p.draft(proposal("PRP-0006", "premises", { add: [{ id: "PRM-0001", type: "constraint", statement: "x" }] }));
  assert.ok(p.json("check", "PRP-0006").body.results[0].problems.some((x) => x.includes("PRM-0001 はすでに使われています（記録で次に空いている ID は PRM-0003")));
});
