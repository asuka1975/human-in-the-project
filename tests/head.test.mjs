// 記録の連鎖を丸ごと作り直されたときの検知（STORAGE.md「hook と改ざん検知」）。
// 書き込み系はリーダーの画面に記録の末尾を出し、verify --head でそれが壊れていない連鎖の中にあるかを確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { project, proposal } from "./helpers.mjs";
import { eventHash } from "../.apm/skills/hitp/scripts/lib/store.mjs";
import { guardBash } from "../.apm/skills/hitp/scripts/lib/guard.mjs";

function setup(t) {
  const p = project();
  t.after(p.cleanup);
  return p;
}

/** 連鎖を先頭から作り直し、HEAD も合わせる（エージェントがスクリプトで記録を作り直した場合）。 */
function rebuild(p, change) {
  const events = p.events();
  change(events);
  let prev = "";
  for (const ev of events) {
    ev.prev = prev;
    ev.hash = eventHash(prev, ev);
    prev = ev.hash;
  }
  p.writeEventsText(events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(join(p.dir, ".hitp", "records", "HEAD"), JSON.stringify({ seq: events.at(-1).seq, hash: prev }) + "\n");
}

test("書き込み系は、終わると記録の末尾（何番目とハッシュの先頭 12 文字）を出す", (t) => {
  const p = setup(t);
  const init = p.run("init", "テスト");
  const first = p.events()[0];
  assert.match(init.stdout, new RegExp(`記録の末尾: 1 番目 ${first.hash.slice(0, 12)}（あとで照らし合わせるとき: ! hitp verify --head ${first.hash.slice(0, 12)}）`));
  p.draft(proposal("PRP-0001", "advice", {}));
  const a = p.json("approve", "PRP-0001");
  assert.deepEqual(a.body.head, { seq: 2, hash: p.events()[1].hash.slice(0, 12) });
  p.draft(proposal("PRP-0002", "advice", {}));
  assert.match(p.run("reject", "PRP-0002", "--reason", "要らない").stdout, /記録の末尾: 3 番目 [0-9a-f]{12}/);
  // 受け付けなかったときは出さない（記録は増えていない）
  const bad = p.run("approve", "PRP-0099");
  assert.equal(bad.code, 1);
  assert.doesNotMatch(bad.stdout, /記録の末尾/);
});

test("verify --head: 控えた末尾が今の末尾なら、そう言う。そのあとに記録があれば並べる", (t) => {
  const p = setup(t);
  p.run("init", "テスト");
  const h1 = p.events()[0].hash.slice(0, 12);
  const now = p.run("verify", "--head", h1);
  assert.equal(now.code, 0);
  assert.match(now.stdout, new RegExp(`控えた末尾（1 番目 ${h1}）が、今の記録の末尾です。`));
  p.draft(proposal("PRP-0001", "advice", {}));
  p.approve("PRP-0001");
  const later = p.json("verify", "--head", h1);
  assert.equal(later.code, 0);
  assert.equal(later.body.head.seq, 1);
  assert.deepEqual(later.body.head.following.map((e) => [e.seq, e.type, e.target]), [[2, "approved", "PRP-0001"]]);
  assert.match(p.run("verify", "--head", h1).stdout, /そのあとの記録が 1 件あります。[\s\S]*2 番目 承認 PRP-0001/);
  // 8 文字でも照らし合わせられる
  assert.equal(p.run("verify", "--head", h1.slice(0, 8)).code, 0);
});

test("verify --head: 連鎖と HEAD をまとめて作り直されると、--head なしでは通るが、控えた末尾では止まる", (t) => {
  const p = setup(t);
  p.run("init", "テスト");
  p.draft(proposal("PRP-0001", "advice", {}));
  const head = p.approve("PRP-0001").head.hash;
  rebuild(p, (events) => { events[0].data.project.name = "書き換えたプロジェクト"; });
  assert.equal(p.run("verify").code, 0, "連鎖と HEAD が揃っていれば、--head なしでは分からない");
  const r = p.run("verify", "--head", head);
  assert.equal(r.code, 1);
  assert.match(r.stdout, new RegExp(`控えた記録の末尾 ${head} が、壊れていない記録の連鎖の中にありません`));
});

test("verify --head: 控えた hash を名乗っていても、中身と合わない行は数えない", (t) => {
  const p = setup(t);
  p.run("init", "テスト");
  p.draft(proposal("PRP-0001", "advice", {}));
  const head = p.approve("PRP-0001").head.hash;
  const events = p.events();
  events[0].data.project.name = "書き換えたプロジェクト"; // hash はそのまま（名乗るだけ）
  p.writeEventsText(events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const r = p.json("verify", "--head", head);
  assert.equal(r.code, 1);
  assert.equal(r.body.head.found, false);
});

test("verify --head: 形の誤りは使い方の誤り（終了コード 2）。hook はエージェントの verify --head を止めない", (t) => {
  const p = setup(t);
  p.run("init", "テスト");
  for (const bad of ["xyz", "abc123", "ABCDEF12"]) assert.equal(p.run("verify", "--head", bad).code, 2, bad);
  assert.equal(guardBash("hitp verify --head 3f9a1c2b7d4e"), null);
  assert.equal(guardBash("node .claude/skills/hitp/scripts/hitp.mjs verify --head=3f9a1c2b7d4e --json"), null);
});
