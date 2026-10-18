// .hitp/ の読み書き（STORAGE.md）。記録は追記だけ、行ごとにハッシュ連鎖を持つ。
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { HitpError, idPrefix, canonical, sha256, now } from "./util.mjs";

/** プロジェクトのルート。HITP_PROJECT_DIR が無ければ、start から .hitp/ を持つ祖先を探す。 */
export function findRoot(start = process.cwd()) {
  if (process.env.HITP_PROJECT_DIR) return resolve(process.env.HITP_PROJECT_DIR);
  let d = resolve(start);
  for (;;) {
    if (existsSync(join(d, ".hitp"))) return d;
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

export function paths(root) {
  const hitp = join(root, ".hitp");
  return {
    hitp,
    drafts: join(hitp, "drafts"),
    records: join(hitp, "records"),
    events: join(hitp, "records", "events.jsonl"),
    head: join(hitp, "records", "HEAD"),
    deliverables: join(hitp, "deliverables"),
  };
}

export function ensureDirs(root) {
  const p = paths(root);
  for (const d of [p.drafts, p.records, p.deliverables]) mkdirSync(d, { recursive: true });
}

/** 行のハッシュ: 前の行の hash と、seq・at・type・actor・data を正規化した JSON を連結した文字列の sha256。 */
export const eventHash = (prev, ev) => sha256(prev + canonical({ seq: ev.seq, at: ev.at, type: ev.type, actor: ev.actor, data: ev.data }));

/** 記録の生の行（空行を除く）。ファイルが無ければ空。 */
export function readEventLines(root) {
  const file = paths(root).events;
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
}

/** 記録を読む。形の検査とハッシュ連鎖の検査は verify が行う。ここでは読めなければ止める。 */
export function readEvents(root) {
  return readEventLines(root).map((line, i) => {
    try { return JSON.parse(line); } catch { throw new HitpError(`記録の ${i + 1} 行目が JSON として読めません。hitp verify で確かめてください`); }
  });
}

/** 次のイベントを作る（まだ書かない）。 */
export function makeEvent(events, type, data) {
  const last = events.at(-1);
  const ev = { seq: (last?.seq ?? 0) + 1, at: now(), type, actor: "leader", data };
  return { ...ev, prev: last?.hash ?? "", hash: eventHash(last?.hash ?? "", ev) };
}

/** 1 行を追記し、末尾の seq と hash を HEAD に書く。HEAD は末尾の行の削除を検知するため（連鎖だけでは末尾の削除が分からない）。 */
export function appendEvent(root, ev) {
  appendFileSync(paths(root).events, JSON.stringify(ev) + "\n");
  writeFileSync(paths(root).head, JSON.stringify({ seq: ev.seq, hash: ev.hash }) + "\n");
}

/** 記録の末尾が HEAD と一致しなければ、その問題の文を返す。 */
export function headProblem(root, events) {
  const file = paths(root).head;
  const last = events.at(-1);
  if (!existsSync(file)) return last ? "records/HEAD がありません（記録の末尾を確かめられません）" : null;
  let head;
  try { head = JSON.parse(readFileSync(file, "utf8")); } catch { return "records/HEAD が読めません"; }
  if (!last || head?.seq !== last.seq || head?.hash !== last.hash) {
    return `記録の末尾（${last ? `${last.seq} 番目` : "空"}）が records/HEAD（${head?.seq} 番目）と一致しません。行が削除・追加された可能性があります`;
  }
  return null;
}

/** 下書きを読む。読めない下書きも error 付きで返す（check が報告する）。 */
export function readDrafts(root) {
  const dir = paths(root).drafts;
  const drafts = {};
  if (!existsSync(dir)) return drafts;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    const file = join(dir, name);
    const entry = { id, file, json: null, error: null };
    if (!idPrefix(id) || !["PRP", "DRF", "EST"].includes(idPrefix(id))) entry.error = `ファイル名 ${name} は <PRP|DRF|EST>-0000.json の形でなければなりません`;
    else {
      try { entry.json = JSON.parse(readFileSync(file, "utf8")); } catch (e) { entry.error = `${name} が JSON として読めません（${e.message}）`; }
      if (entry.json && entry.json.id !== id) entry.error = `${name} の id が ${JSON.stringify(entry.json.id)} です。ファイル名と一致させてください`;
    }
    drafts[id] = entry;
  }
  return drafts;
}

export function removeDraft(root, id) {
  rmSync(join(paths(root).drafts, `${id}.json`), { force: true });
}

/** deliverables/ の下のファイルを、.hitp/ からの相対パスで列挙する。 */
export function listDeliverableFiles(root) {
  const base = paths(root).hitp;
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full.slice(base.length + 1));
    }
  };
  walk(paths(root).deliverables);
  return out.sort();
}
