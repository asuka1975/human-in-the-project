// 読んだ中身を承認したことの確かめ（approve --expect。INV-1 の弱いところを補う）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { project, base, proposal, record, estimate } from "./helpers.mjs";

function setup(t) {
  const p = project();
  t.after(p.cleanup);
  return base(p);
}

test("check・show・status が同じハッシュを出し、それを付けた承認は通る", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "advice", {}));
  const c = p.json("check", "PRP-0005").body.results[0];
  assert.match(c.expect, /^[0-9a-f]{8}$/);
  assert.equal(p.json("show", "PRP-0005").body.hash, c.expect);
  assert.equal(p.json("status").body.drafts.find((d) => d.id === "PRP-0005").expect, c.expect);
  assert.match(p.run("check", "PRP-0005").stdout, new RegExp(`承認するとき: ! hitp approve PRP-0005 --expect ${c.expect}`));
  assert.match(p.run("status").stdout, new RegExp(`PRP-0005 .*承認するとき: ! hitp approve PRP-0005 --expect ${c.expect}`));
  assert.match(p.run("show", "PRP-0005").stdout, new RegExp(`中身のハッシュ: ${c.expect}`));
  const r = p.json("approve", "PRP-0005", "--expect", c.expect);
  assert.equal(r.code, 0);
  assert.equal(r.body.hash, c.expect);
  assert.match(r.body.event.data.decision, /^DEC-\d{4}$/);
});

test("読んだあとに下書きが書き換えられていれば、承認せずに止める（記録は増えず、下書きは残る）", (t) => {
  const p = setup(t);
  const d = proposal("PRP-0005", "advice", {});
  p.draft(d);
  const read = p.json("show", "PRP-0005").body.hash;
  p.draft({ ...d, title: "書き換えた提案" });
  const before = p.events().length;
  const r = p.run("approve", "PRP-0005", "--expect", read);
  assert.equal(r.code, 1);
  assert.match(r.stderr + r.stdout, new RegExp(`PRP-0005 の中身が --expect ${read} と一致しません.*承認していません`));
  assert.equal(p.events().length, before);
  assert.equal(p.hasDraft("PRP-0005"), true);
});

test("承認で写し取る推定が書き換えられても止める", (t) => {
  const p = setup(t);
  p.draft(estimate("EST-0002", { subject: "市場規模", method: "fermi" }));
  p.draft(estimate("EST-0003", { subject: "売上", method: "fermi", inputs: ["EST-0002"] }));
  p.draft(proposal("PRP-0005", "advice", {}, ["EST-0003"]));
  const shown = p.json("show", "PRP-0005").body;
  assert.deepEqual(shown.boundEstimates, ["EST-0002", "EST-0003"]);
  p.draft(estimate("EST-0002", { subject: "市場規模", method: "fermi", value: { low: 30, high: 50, unit: "人日" } }));
  assert.notEqual(p.json("show", "PRP-0005").body.hash, shown.hash, "辿った先の推定の変更でもハッシュが変わる");
  assert.equal(p.run("approve", "PRP-0005", "--expect", shown.hash).code, 1);
});

test("同じ推定を参照する別の提案を先に承認しても、ハッシュは変わらない（続けて打つ承認のコマンドが通る）", (t) => {
  const p = setup(t);
  p.draft(estimate("EST-0002", { subject: "市場規模", method: "fermi" }));
  p.draft(proposal("PRP-0005", "advice", {}, ["EST-0002"]));
  p.draft({ ...proposal("PRP-0006", "advice", {}, ["EST-0002"]), title: "別の提案" });
  const [a, b] = ["PRP-0005", "PRP-0006"].map((id) => p.json("check", id).body.results[0].expect);
  assert.equal(p.json("approve", "PRP-0005", "--expect", a).code, 0);
  assert.equal(p.hasDraft("EST-0002"), false, "推定は記録に写し取られた");
  assert.equal(p.json("check", "PRP-0006").body.results[0].expect, b);
  assert.equal(p.json("approve", "PRP-0006", "--expect", b).code, 0);
});

test("記録の下書き（DRF）にも使える。--expect なしの承認は今までどおり。形の悪い --expect は使い方の誤り", (t) => {
  const p = setup(t);
  p.draft(record("DRF-0001", "incident", { date: "2026-10-13", text: "鈴木さんが 1 週間休む" }));
  const h = p.json("check", "DRF-0001").body.results[0].expect;
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.equal(p.json("approve", "DRF-0001", "--expect", h.slice(0, 6)).code, 0, "先頭 6 文字でもよい");
  assert.equal(p.json("approve", p.draft(proposal("PRP-0005", "advice", {}))).code, 0);
  p.draft(proposal("PRP-0006", "advice", {}));
  assert.equal(p.run("approve", "PRP-0006", "--expect", "abc").code, 2);
  assert.equal(p.run("approve", "PRP-0006", "--expect", "XYZ12345").code, 2);
  assert.equal(p.hasDraft("PRP-0006"), true);
});

test("問題のある下書きには承認のコマンドを出さない", (t) => {
  const p = setup(t);
  p.draft(proposal("PRP-0005", "advice", {}, []));
  const c = p.json("check", "PRP-0005").body.results[0];
  assert.ok(c.problems.length);
  assert.equal(c.expect, undefined);
});
