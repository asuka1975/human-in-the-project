// テストの道具 — 一時ディレクトリにプロジェクトを作り、hitp を別プロセスで動かす（リーダーが ! で打つのと同じ入口）。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", ".apm", "skills", "hitp", "scripts");
export const HITP = join(SCRIPTS, "hitp.mjs");

export function project({ now = "2026-10-13T00:00:00.000Z" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hitp-test-"));
  const env = { ...process.env, HITP_PROJECT_DIR: dir, HITP_NOW: now };
  const p = {
    dir,
    run(...args) {
      const r = spawnSync(process.execPath, [HITP, ...args], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    /** --json 付きで実行し、結果を JSON で返す。 */
    json(...args) {
      const r = p.run(...args, "--json");
      return { code: r.code, body: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
    },
    draft(d) {
      mkdirSync(join(dir, ".hitp", "drafts"), { recursive: true });
      writeFileSync(join(dir, ".hitp", "drafts", `${d.id}.json`), JSON.stringify(d, null, 2));
      return d.id;
    },
    hasDraft: (id) => existsSync(join(dir, ".hitp", "drafts", `${id}.json`)),
    file(name, content) {
      const f = join(dir, name);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, content);
      return name;
    },
    events: () => readFileSync(join(dir, ".hitp", "records", "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    eventsText: () => readFileSync(join(dir, ".hitp", "records", "events.jsonl"), "utf8"),
    writeEventsText: (t) => writeFileSync(join(dir, ".hitp", "records", "events.jsonl"), t),
    deliverableFiles() {
      const base = join(dir, ".hitp", "deliverables");
      const out = [];
      const walk = (d) => { if (existsSync(d)) for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : out.push(join(d, e.name).slice(base.length + 1)); };
      walk(base);
      return out.sort();
    },
    /** 承認して、成功したことを確かめる。 */
    approve(id) {
      const r = p.json("approve", id);
      if (r.code !== 0) throw new Error(`approve ${id} が失敗しました: ${JSON.stringify(r.body)}`);
      return r.body;
    },
    /** 今日を変える（日付を進めながら確かめるため）。 */
    setNow(iso) { env.HITP_NOW = iso; },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
  return p;
}

const quote = (q) => ({ quote: q });

/** 提案の下書き。 */
export const proposal = (id, kind, payload, refs = [quote("リーダーの発言")]) => ({ id, kind, title: `${kind} の提案`, rationale: { refs }, payload });

/** 記録の下書き。 */
export const record = (id, kind, payload) => ({ id, kind, title: `${kind} の下書き`, payload });

export const estimate = (id, over = {}) => ({
  id, kind: "estimate", subject: "工数", method: "effort", value: { low: 3, high: 5, unit: "人日" },
  derivation: "類似作業 2 件の実績から", inputs: [quote("前は 1 週間弱だった")], ...over,
});

/**
 * 基本の状況: メンバー 2 人、制約と仮定、計画（成果物を生む実行型 WI-0001、仮定を検証する探索型 WI-0002、成果物を生まない WI-0003）、
 * WI-0001 に上長承認のゲート GATE-0001。
 */
export function base(p) {
  if (p.run("init", "テスト").code !== 0) throw new Error("init が失敗しました");
  p.draft(proposal("PRP-0001", "members", { add: [{ id: "MEM-0001", name: "佐藤" }, { id: "MEM-0002", name: "鈴木" }] }));
  p.approve("PRP-0001");
  p.draft(proposal("PRP-0002", "premises", { add: [
    { id: "PRM-0001", type: "constraint", statement: "期限は 3 か月" },
    { id: "PRM-0002", type: "assumption", statement: "連携先 API は 1 秒以内に応答する" },
  ] }));
  p.approve("PRP-0002");
  p.draft(estimate("EST-0001"));
  p.draft(proposal("PRP-0003", "plan", { id: "PLAN-0001", replaces: null, deadline: "2027-01-31", workItems: [
    { id: "WI-0001", title: "設計", type: "execute", assignee: "MEM-0001", estimate: "EST-0001", deliverables: ["設計書"] },
    { id: "WI-0002", title: "API の応答時間の検証", type: "explore", assignee: "MEM-0002", question: "1 秒以内に応答するか", tests: ["PRM-0002"], deliverables: ["検証報告"] },
    { id: "WI-0003", title: "キックオフ", type: "execute", dependsOn: [] },
  ] }, ["PRM-0001", "EST-0001"]));
  p.approve("PRP-0003");
  p.draft(proposal("PRP-0004", "quality", { gates: { add: [{ id: "GATE-0001", workItem: "WI-0001", type: "supervisor-approval", description: "部長の承認" }] } }, ["WI-0001"]));
  p.approve("PRP-0004");
  return p;
}
