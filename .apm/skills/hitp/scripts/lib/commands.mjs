// コマンドの本体（CLI.md）。結果はオブジェクトで返し、表示は render.mjs が作る。
// 書き込み系は「イベントを作る → applyEvent で受け付けるか確かめる → 書く」の順。受け付けなければ何も書かない。
import { existsSync, readFileSync, copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { HitpError, UsageError, idPrefix, formatId, canonical, sha256, isNonEmptyString, now } from "./util.mjs";
import { isTerminal } from "./labels.mjs";
import { draftProblems, referencedIds, createdIds } from "./schema.mjs";
import { emptyState, applyEvent, lookup, maxNumbers, activeGates } from "./model.mjs";
import { forecast, localDate, remainingOf, weekdaysBetween } from "./forecast.mjs";
import { findRoot, paths, ensureDirs, readEvents, readEventLines, makeEvent, appendEvent, eventHash, headProblem, readDrafts, removeDraft, listDeliverableFiles } from "./store.mjs";

export function requireRoot() {
  const root = findRoot();
  if (!root) throw new HitpError(".hitp/ が見つかりません。プロジェクトのルートで実行するか、リーダーが hitp init <名前> で始めてください");
  return root;
}

/**
 * 記録を先頭から畳み込む。壊れていれば止める（壊れ方は verify で見る）。
 * strict（書き込み系）のときは、記録の末尾が HEAD と一致しなければ止める。末尾を消された記録に書き足すと、消えたことが分からなくなるため。
 */
export function loadProject(root, { strict = false } = {}) {
  const events = readEvents(root);
  if (!events.length) throw new HitpError("記録がありません。リーダーが hitp init <名前> でプロジェクトを始めてください");
  const head = headProblem(root, events);
  if (strict && head) throw new HitpError([head, "書き込みを止めました。hitp verify で確かめてください"]);
  let state = emptyState();
  for (const [i, ev] of events.entries()) {
    try { state = applyEvent(state, ev).state; } catch (e) {
      if (e instanceof HitpError) throw new HitpError([`記録の ${i + 1} 行目のイベントを当てられません。hitp verify で確かめてください`, ...e.problems]);
      throw e;
    }
  }
  return { events, state, head };
}

/** 接頭辞ごとの次の ID。記録と下書きの両方を見る。 */
/** 使えない ID の下書きを直す手順。Bash の mv ではなく、新しい ID で書き直してもらう（L4 で mv して hook に止められたため）。 */
function renameHint(state, drafts, id) {
  const next = nextIds(state, drafts)[idPrefix(id)];
  return `別の ID にしてください。次に使える ID は ${next} です。Write で ${next} の下書きを書き直し、${id} の下書きは消してください`;
}

export function nextIds(state, drafts) {
  const max = maxNumbers(state);
  const see = (id) => { const p = idPrefix(id); if (p) max[p] = Math.max(max[p] ?? 0, Number(id.split("-")[1])); };
  for (const d of Object.values(drafts)) {
    see(d.id);
    // 提案の中でエージェントが採番した ID も数える（2 つの下書きが同じ ID を新しく作らないように）。
    JSON.stringify(d.json ?? {}, (k, v) => { if (typeof v === "string") see(v); return v; });
  }
  const out = {};
  for (const p of ["PRP", "DRF", "EST", "OBJ", "PRM", "MEM", "PLAN", "WI", "QG", "GATE"]) out[p] = formatId(p, (max[p] ?? 0) + 1);
  return out;
}

const nextOf = (state, prefix, offset = 0) => formatId(prefix, (maxNumbers(state)[prefix] ?? 0) + 1 + offset);

// ---------------------------------------------------------------- 書き込み系

export function init(name, cwd = process.cwd()) {
  if (!isNonEmptyString(name)) throw new UsageError("使い方: hitp init <プロジェクト名>");
  const root = process.env.HITP_PROJECT_DIR ? resolve(process.env.HITP_PROJECT_DIR) : resolve(cwd);
  if (readEventLines(root).length) throw new HitpError(`${paths(root).events} にすでに記録があります`);
  ensureDirs(root);
  const ev = makeEvent([], "initialized", { project: { name } });
  applyEvent(emptyState(), ev);
  appendEvent(root, ev);
  return { root, event: ev };
}

/** 承認したときに記録へ写し取る推定（下書きにあり、提案から辿れるもの）。 */
function copiedEstimates(state, drafts, draft) {
  const estimates = [];
  const seen = new Set();
  const queue = referencedIds(draft);
  while (queue.length) {
    const id = queue.shift();
    if (idPrefix(id) !== "EST" || seen.has(id)) continue;
    seen.add(id);
    if (state.estimates[id]) continue;
    const d = drafts[id];
    if (!d?.json) continue; // 見つからない参照は applyEvent が報告する
    estimates.push(d.json);
    queue.push(...referencedIds(d.json));
  }
  return estimates;
}

/** 提案から辿れる推定のすべて（記録にあるものは記録の中身、まだ下書きのものは下書きの中身）。ID の順。 */
function boundEstimates(state, drafts, draft) {
  const out = {};
  const queue = referencedIds(draft);
  while (queue.length) {
    const id = queue.shift();
    if (idPrefix(id) !== "EST" || out[id]) continue;
    const recorded = state.estimates[id];
    const e = recorded ? (({ recordedBy, ...rest }) => rest)(recorded) : drafts[id]?.json;
    if (!e) continue;
    out[id] = e;
    queue.push(...referencedIds(e));
  }
  return Object.keys(out).sort().map((id) => out[id]);
}

/**
 * 承認する中身のハッシュ: 下書きと、それが辿る推定をまとめた sha256。
 * リーダーが読んだ中身を承認したことを確かめるため、approve --expect で先頭を照らし合わせる。
 * 推定は記録にあっても下書きにあっても同じ中身として数えるので、同じ推定を参照する別の提案を先に承認してもハッシュは変わらない。
 */
export const contentHash = (state, drafts, draft) => sha256(canonical({ draft, estimates: boundEstimates(state, drafts, draft) }));
export const EXPECT_LENGTH = 8;

/** 承認のイベントの data を組み立てる。参照されている推定（下書きにあるもの）を写し取る。 */
function approvalData(state, drafts, draft) {
  const estimates = copiedEstimates(state, drafts, draft);
  const data = { draft, draftSha256: sha256(canonical(draft)), estimates };
  if (idPrefix(draft.id) === "PRP") data.decision = nextOf(state, "DEC");
  else data.record = nextOf(state, draft.kind === "incident" ? "INC" : "RPT");
  return data;
}

function draftFor(drafts, id, allowed) {
  if (!idPrefix(id)) throw new UsageError(`${id} は ID ではありません`);
  if (!allowed.includes(idPrefix(id))) throw new HitpError(`${id} は対象になりません（${allowed.join("・")} だけ）`);
  const d = drafts[id];
  if (!d) throw new HitpError(`下書き ${id} がありません（.hitp/drafts/${id}.json）`);
  if (d.error) throw new HitpError(d.error);
  return d;
}

/** 受け付けるか確かめ、effects を data に入れてから書く（effects もハッシュに含める）。 */
function commit(root, events, state, type, data) {
  const trial = makeEvent(events, type, data);
  const { effects } = applyEvent(state, trial);
  const ev = Object.keys(effects).length ? makeEvent(events, type, { ...data, effects }) : trial;
  appendEvent(root, ev);
  return { event: ev, effects };
}

/** expect: 承認する中身のハッシュの先頭（6 文字以上）。今の中身と合わなければ承認しない（読んだあとに書き換えられている）。 */
export function approve(id, { expect } = {}) {
  if (expect !== undefined && !/^[0-9a-f]{6,64}$/.test(expect)) throw new UsageError(`--expect はハッシュの先頭 6 文字以上（0-9a-f）にしてください（${expect}）`);
  const root = requireRoot();
  const { events, state } = loadProject(root, { strict: true });
  const drafts = readDrafts(root);
  if (idPrefix(id) === "EST") throw new HitpError("推定（EST）は承認しません。推定を参照する提案を承認すると、その時点の推定が記録に写し取られます");
  const d = draftFor(drafts, id, ["PRP", "DRF"]);
  const hash = contentHash(state, drafts, d.json);
  if (expect !== undefined && !hash.startsWith(expect)) {
    throw new HitpError(`${id} の中身が --expect ${expect} と一致しません（今の中身は ${hash.slice(0, EXPECT_LENGTH)}）。読んだあとに下書きか、参照している推定が書き換えられています。承認していません。\`hitp show ${id}\` で読み直してください`);
  }
  const data = approvalData(state, drafts, d.json);
  const result = commit(root, events, state, "approved", data);
  removeDraft(root, id);
  for (const e of data.estimates) removeDraft(root, e.id);
  return { ...result, draft: d.json, estimates: data.estimates.map((e) => e.id), hash: hash.slice(0, EXPECT_LENGTH), expected: expect ?? null };
}

export function reject(id, reason) {
  const root = requireRoot();
  const { events, state } = loadProject(root, { strict: true });
  const drafts = readDrafts(root);
  const d = draftFor(drafts, id, ["PRP"]);
  const draft = d.json;
  const data = { draft, draftSha256: sha256(canonical(draft)), decision: nextOf(state, "DEC"), ...(reason !== undefined ? { reason } : {}) };
  const result = commit(root, events, state, "rejected", data);
  removeDraft(root, id);
  return { ...result, draft };
}

/** --file <種類>=<パス> */
export function parseFileSpec(spec) {
  const i = spec.indexOf("=");
  if (i <= 0 || i === spec.length - 1) throw new UsageError(`--file は <種類>=<パス> の形で指定します（${spec}）`);
  return { kind: spec.slice(0, i), path: spec.slice(i + 1) };
}

/** --gate id=GATE-0001,by=部長,at=2026-11-20,result=pass */
export function parseGateSpec(spec) {
  const out = {};
  for (const part of spec.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) throw new UsageError(`--gate は id=…,by=…,at=…,result=… の形で指定します（${spec}）`);
    const k = part.slice(0, i).trim();
    if (!["id", "by", "at", "result"].includes(k)) throw new UsageError(`--gate の未知の項目 ${k}（${spec}）`);
    if (k in out) throw new UsageError(`--gate の ${k} が 2 回あります（${spec}）`);
    out[k] = part.slice(i + 1).trim();
  }
  for (const k of ["id", "by", "at", "result"]) if (!(k in out)) throw new UsageError(`--gate に ${k} がありません（${spec}）`);
  return out;
}

export function submit(workItem, fileSpecs, gateSpecs, cwd = process.cwd()) {
  if (!idPrefix(workItem)) throw new UsageError("使い方: hitp submit <WI> --file <種類>=<パス> … --gate id=…,by=…,at=…,result=… …");
  const root = requireRoot();
  const { events, state } = loadProject(root, { strict: true });
  const pre = [];
  const files = fileSpecs.map(parseFileSpec);
  const gates = gateSpecs.map(parseGateSpec);

  const deliverables = files.map((f, i) => {
    const src = resolve(cwd, f.path);
    let hash = "0".repeat(64);
    let bytes = 0;
    if (!existsSync(src) || !statSync(src).isFile()) pre.push(`ファイル ${f.path} がありません`);
    else { const buf = readFileSync(src); hash = sha256(buf); bytes = buf.length; }
    return { id: nextOf(state, "DLV", i), kind: f.kind, path: `deliverables/${workItem}/${f.kind}/${basename(src)}`, sha256: hash, bytes, src };
  });
  const gateRecords = gates.map((g, i) => ({ id: nextOf(state, "GR", i), gate: g.id, by: g.by, at: g.at, result: g.result }));
  const data = { workItem, deliverables: deliverables.map(({ src, ...rest }) => rest), gateRecords };

  // INV-15: 不足はまとめて示し、何も保存しない。
  let reducerProblems = [];
  try { applyEvent(state, makeEvent(events, "submitted", data)); } catch (e) {
    if (!(e instanceof HitpError)) throw e;
    reducerProblems = e.problems;
  }
  const problems = [...pre, ...reducerProblems];
  if (problems.length) throw new HitpError(problems);

  const copied = [];
  try {
    for (const x of deliverables) {
      const dest = join(paths(root).hitp, x.path);
      if (existsSync(dest)) throw new HitpError(`${x.path} がすでにあります`);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(x.src, dest);
      copied.push(dest);
    }
    const result = commit(root, events, state, "submitted", data);
    return { ...result, workItem, deliverables: data.deliverables, gateRecords };
  } catch (e) {
    for (const f of copied) rmSync(f, { force: true });
    throw e;
  }
}

/** リーダーが WorkItem のチェックポイントの通過を記録する（PHASE-EXECUTING.md「決めたこと」1）。 */
export function checkpoint(workItem, n, { date, note } = {}) {
  if (!idPrefix(workItem) || !/^\d+$/.test(String(n ?? ""))) throw new UsageError("使い方: hitp checkpoint <WI> <番号> [--date <YYYY-MM-DD>] [--note <ひとこと>]");
  const root = requireRoot();
  const { events, state } = loadProject(root, { strict: true });
  const data = { workItem, checkpoint: Number(n), date: date ?? localDate(now()), report: nextOf(state, "RPT"), ...(note ? { note } : {}) };
  return { ...commit(root, events, state, "checkpointed", data), data };
}

// ---------------------------------------------------------------- 読み取り系

/** 下書き 1 つを、承認と同じ検査にかける（記録は書かない）。 */
export function checkDraft(state, events, drafts, entry) {
  return tryDraft(state, events, drafts, entry).problems;
}

/** 下書きを承認したとしたらどうなるか。問題の一覧と、問題が無ければ承認後の状態を返す（記録は書かない）。 */
function tryDraft(state, events, drafts, entry) {
  const problems = draftOnlyProblems(state, drafts, entry);
  if (problems) return { problems };
  try {
    const event = makeEvent(events, "approved", approvalData(state, drafts, entry.json));
    return { problems: [], state: applyEvent(state, event).state, event };
  } catch (e) {
    if (e instanceof HitpError) return { problems: e.problems };
    throw e;
  }
}

function draftOnlyProblems(state, drafts, entry) {
  if (entry.error) return [entry.error];
  const d = entry.json;
  const shape = draftProblems(d);
  if (shape.length) return shape;
  const prefix = idPrefix(d.id);
  if (prefix === "EST") {
    if (state.estimates[d.id]) return [`${d.id} はすでに記録されています。${renameHint(state, drafts, d.id)}`];
    return d.inputs.filter((r) => typeof r === "string" && !lookup(state, r) && !drafts[r]).map((r) => `${d.id} inputs の ${r} が見つかりません`);
  }
  if (state.consumed[d.id]) return [`${d.id} はすでに${state.consumed[d.id].outcome === "rejected" ? "却下" : "承認"}されています。${renameHint(state, drafts, d.id)}`];
  return null;
}

/** 計画の下書きが参照する ID（根拠・推定・担当・検証する前提）。 */
function planRefs(d) {
  const ids = new Set(referencedIds(d));
  for (const w of d.payload?.workItems ?? []) {
    if (typeof w?.assignee === "string") ids.add(w.assignee);
    for (const t of Array.isArray(w?.tests) ? w.tests : []) ids.add(t);
  }
  return ids;
}

/**
 * 計画の下書きなら、承認したとしたときの見通し。計画が参照する ID を新しく作る、承認待ちのメンバー・前提の提案があれば、
 * それらも番号の順に承認したとして計算し、assumedDrafts に挙げる（最初の計画では、メンバー・前提・計画が同時に承認待ちになるため）。
 */
function draftForecast(state, events, drafts, entry, capacity) {
  // メンバー（稼働・不在）と進捗報告（残り・チェックポイント）の下書きは、承認したときの今の計画の見通しを出す
  if ((entry.json?.kind === "members" && idPrefix(entry.id) === "PRP") || (entry.json?.kind === "progress" && idPrefix(entry.id) === "DRF")) {
    if (!state.currentPlan) return undefined;
    const t = tryDraft(state, events, drafts, entry);
    return t.state ? { ...forecast(t.state, { today: localDate(now()), capacity }), assumedDrafts: [] } : undefined;
  }
  if (entry.json?.kind !== "plan" || idPrefix(entry.id) !== "PRP") return undefined;
  const wanted = planRefs(entry.json);
  const assumedDrafts = [];
  let s = state;
  let evs = events;
  const pending = Object.values(drafts).filter((x) => x.json && idPrefix(x.id) === "PRP" && ["members", "premises"].includes(x.json.kind)).sort((a, b) => a.id.localeCompare(b.id));
  for (const d of pending) {
    if (!createdIds(d.json, (x) => lookup(s, x) !== null).some((id) => wanted.has(id))) continue;
    const t = tryDraft(s, evs, drafts, d);
    if (!t.state) continue;
    s = t.state;
    evs = [...evs, t.event];
    assumedDrafts.push(d.id);
  }
  const t = tryDraft(s, evs, drafts, entry);
  return t.state ? { ...forecast(t.state, { today: localDate(now()), capacity }), assumedDrafts } : undefined;
}

/** 未承認の下書きどうしが、同じ ID を新しく作ろうとしていないか（STORAGE.md「ID」）。 */
export function draftCollisions(state, drafts) {
  const creators = {};
  for (const d of Object.values(drafts)) {
    if (!d.json || idPrefix(d.id) !== "PRP") continue;
    for (const id of new Set(createdIds(d.json, (x) => lookup(state, x) !== null))) (creators[id] ??= []).push(d.id);
  }
  for (const d of Object.values(drafts)) if (idPrefix(d.id) === "EST") (creators[d.id] ??= []).push(d.id);
  const out = {};
  // 同じ計画を置き換える計画の案どうしは、同じ ID を作ってよい（承認できるのは 1 つだけなので）
  const planBase = (x) => { const j = drafts[x]?.json; return j?.kind === "plan" && j.payload && "replaces" in j.payload ? JSON.stringify(j.payload.replaces) : null; };
  for (const [id, by] of Object.entries(creators)) {
    if (by.length < 2) continue;
    if (by.every((x) => planBase(x) !== null && planBase(x) === planBase(by[0]))) continue;
    for (const d of by) (out[d] ??= []).push(`${id} は ${by.filter((x) => x !== d).join("・")} でも新しく作られます。どちらかの ID を変えてください`);
  }
  return out;
}

export function check(ids = []) {
  const root = requireRoot();
  const { events, state } = loadProject(root);
  const drafts = readDrafts(root);
  for (const id of ids) if (!drafts[id]) throw new HitpError(`下書き ${id} がありません`);
  const targets = ids.length ? ids : Object.keys(drafts);
  const collisions = draftCollisions(state, drafts);
  const results = targets.map((id) => {
    const problems = [...checkDraft(state, events, drafts, drafts[id]), ...(collisions[id] ?? [])];
    const out = { id, kind: drafts[id].json?.kind ?? null, title: drafts[id].json?.title ?? drafts[id].json?.subject ?? null, problems };
    if (!problems.length && ["PRP", "DRF"].includes(idPrefix(id))) out.expect = contentHash(state, drafts, drafts[id].json).slice(0, EXPECT_LENGTH);
    // 計画の下書きの問題が、承認待ちのメンバー・前提の提案だけによるものなら、見通しも出せる
    const f = draftForecast(state, events, drafts, drafts[id]);
    if (f) out.forecast = f;
    return out;
  });
  return { ok: results.every((r) => !r.problems.length), results };
}

/** 書き込み系のあとにリーダーの画面に出す、記録の末尾のハッシュの長さ（verify --head で照らし合わせる）。 */
export const HEAD_LENGTH = 12;

/** 記録の末尾（seq とハッシュの先頭）。書き込み系の結果に添える。 */
export const headOf = (ev) => ({ seq: ev.seq, hash: ev.hash.slice(0, HEAD_LENGTH) });

/** イベントの短い説明（verify --head で、控えた末尾のあとの記録を並べるため）。 */
const describeEvent = (ev) => ({ seq: ev.seq, at: ev.at, type: ev.type, target: ev.data?.draft?.id ?? ev.data?.workItem ?? ev.data?.project?.name ?? null });

/**
 * 改ざん検査。head（書き込み系のあとに出た記録の末尾のハッシュの先頭）を渡すと、それが壊れていない連鎖の中にあるかも確かめる。
 * 連鎖と records/HEAD をまとめて作り直されると、それだけでは分からない。リーダーの画面に出た末尾は、エージェントには書き換えられない。
 */
export function verify({ head } = {}) {
  const root = requireRoot();
  const problems = [];
  const lines = readEventLines(root);
  let prev = "";
  let state = emptyState();
  let replayed = 0;
  let broken = false;
  const matches = [];
  const events = [];
  lines.forEach((line, i) => {
    if (broken) return;
    let ev;
    try { ev = JSON.parse(line); } catch { problems.push(`${i + 1} 行目が JSON として読めません`); broken = true; return; }
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) { problems.push(`${i + 1} 行目がイベントの形ではありません`); broken = true; return; }
    const keys = Object.keys(ev).sort().join(",");
    if (keys !== "actor,at,data,hash,prev,seq,type") problems.push(`${i + 1} 行目の項目が不正です（${keys}）`);
    if (ev.actor !== "leader") problems.push(`${i + 1} 行目の actor が leader ではありません`);
    if (ev.prev !== prev) problems.push(`${i + 1} 行目で連鎖が切れています（prev が前の行の hash と一致しない）`);
    if (ev.hash !== eventHash(ev.prev ?? "", ev)) problems.push(`${i + 1} 行目の hash が中身と一致しません（書き換えられています）`);
    prev = ev.hash;
    try {
      const r = applyEvent(state, ev);
      state = r.state;
      replayed++;
      if (canonical(r.effects) !== canonical(ev.data?.effects ?? {})) problems.push(`${i + 1} 行目の effects が再計算と一致しません`);
    } catch (e) {
      if (!(e instanceof HitpError)) throw e;
      problems.push(`${i + 1} 行目のイベントを当てられません: ${e.problems.join(" / ")}`);
      broken = true;
    }
    events.push(ev);
    // 控えた末尾は、そこまでに問題の無い行だけで探す（中身と合わない hash を名乗る行は数えない）
    if (head && !problems.length && typeof ev.hash === "string" && ev.hash.startsWith(head)) matches.push(i);
  });
  let headResult = null;
  if (head) {
    const i = matches.length === 1 ? matches[0] : null;
    headResult = { given: head, found: i !== null, seq: i === null ? null : events[i].seq, following: i === null ? [] : events.slice(i + 1).map(describeEvent) };
    if (!matches.length) problems.push(`控えた記録の末尾 ${head} が、壊れていない記録の連鎖の中にありません。記録が作り直されたか、控えた値が違います`);
    else if (matches.length > 1) problems.push(`控えた記録の末尾 ${head} が、記録の ${matches.length} 行に当たります。控えた文字をすべて書いてください`);
  }
  if (!lines.length) problems.push("記録がありません");
  else if (!broken) {
    const head = headProblem(root, lines.map((l) => JSON.parse(l)));
    if (head) problems.push(head);
  }

  const recorded = new Map(Object.values(state.deliverables).map((x) => [x.path, x]));
  const onDisk = listDeliverableFiles(root);
  if (broken) {
    problems.push("記録を最後まで当てられないため、成果物は検査していません");
    return { ok: false, events: lines.length, replayed, deliverables: recorded.size, head: headResult, problems };
  }
  for (const f of onDisk) {
    const x = recorded.get(f);
    if (!x) { problems.push(`${f} は記録にない成果物です`); continue; }
    if (sha256(readFileSync(join(paths(root).hitp, f))) !== x.sha256) problems.push(`${f} の中身が提出時と一致しません（${x.id}）`);
  }
  for (const [f, x] of recorded) if (!onDisk.includes(f)) problems.push(`${x.id} のファイル ${f} がありません`);
  return { ok: problems.length === 0, events: lines.length, replayed, deliverables: recorded.size, head: headResult, problems };
}

/**
 * 見直しが要るもの: 未完了の WorkItem のうち、棄却された仮定を確かめた探索型の WorkItem に（たどって）依存するもの。
 * 棄却のあとに承認された計画に載っていれば、見直しは済んだとみなして出さない。
 */
function needsReview(s) {
  const planSeq = s.currentPlan ? (s.plans[s.currentPlan].approvedSeq ?? 0) : 0;
  const rejected = new Set(Object.values(s.premises).filter((p) => p.type === "assumption" && p.verification === "rejected" && !p.removed && (p.verifiedSeq ?? Infinity) > planSeq).map((p) => p.id));
  const out = [];
  for (const w of Object.values(s.workItems)) {
    if (isTerminal(w.state)) continue;
    const seen = new Set();
    const stack = [...w.dependsOn];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const d = s.workItems[id];
      if (!d) continue;
      for (const t of d.type === "explore" ? d.tests : []) if (rejected.has(t)) out.push({ workItem: w.id, via: d.id, premise: t, note: s.premises[t].note ?? null });
      stack.push(...d.dependsOn);
    }
  }
  return out;
}

export function status() {
  const root = requireRoot();
  const { events, state: s, head } = loadProject(root);
  const drafts = readDrafts(root);
  const wis = Object.values(s.workItems);
  const today = localDate(now());
  const count = (pred) => wis.filter(pred).length;
  const remaining = {};
  for (const w of wis) {
    if (isTerminal(w.state) || !w.estimate || !s.estimates[w.estimate]) continue;
    const v = s.estimates[w.estimate].value;
    remaining[v.unit] ??= { low: 0, high: 0 };
    remaining[v.unit].low += v.low;
    remaining[v.unit].high += v.high;
  }
  const assumptions = Object.values(s.premises).filter((p) => p.type === "assumption" && !p.removed);
  return {
    project: s.project, phase: s.phase, events: events.length,
    warnings: head ? [head] : [],
    plan: s.currentPlan ? s.plans[s.currentPlan] : null,
    charter: s.charter,
    axes: {
      work: { todo: count((w) => w.state === "todo"), doing: count((w) => w.state === "doing"), done: count((w) => w.state === "done"), cancelled: count((w) => w.state === "cancelled"), remaining },
      outcome: Object.values(s.objectives).map((o) => ({ id: o.id, statement: o.statement, status: o.status })),
      uncertainty: {
        unverified: assumptions.filter((p) => p.verification === "unverified").length,
        supported: assumptions.filter((p) => p.verification === "supported").length,
        rejected: assumptions.filter((p) => p.verification === "rejected").length,
      },
    },
    premises: Object.values(s.premises).filter((p) => !p.removed).sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => ({ id: p.id, type: p.type, statement: p.statement, ...(p.type === "assumption" ? { verification: p.verification, note: p.note } : {}) })),
    estimates: Object.values(s.estimates).sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({ id: e.id, subject: e.subject, method: e.method, value: e.value })),
    members: Object.values(s.members).filter((m) => !m.removed).sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({ id: m.id, name: m.name, role: m.role, ability: m.ability, availability: m.availability, capacity: m.capacity ?? null, away: m.away ?? [] })),
    forecast: forecast(s, { today: localDate(now()) }),
    workItems: wis.map((w) => {
      const reports = Object.values(s.reports).filter((r) => r.workItem === w.id);
      const last = reports.at(-1);
      const passed = Math.max(0, ...reports.map((r) => r.checkpoint ?? 0));
      const rest = w.state === "doing" ? remainingOf(s, w) : null;
      return {
        id: w.id, title: w.title, type: w.type, state: w.state, assignee: w.assignee, deliverables: w.deliverables, gates: activeGates(s, w.id).map((g) => g.id),
        estimate: w.estimate && s.estimates[w.estimate] ? { id: w.estimate, ...s.estimates[w.estimate].value } : null, waitDays: w.waitDays ?? 0, dependsOn: w.dependsOn,
        checkpoints: { total: (w.checkpoints ?? []).length, passed, next: (w.checkpoints ?? [])[passed]?.title ?? null },
        remaining: rest && rest.from !== w.estimate ? { low: rest.low, high: rest.high, report: rest.from } : null,
        lastReport: last ? { id: last.id, date: last.date, businessDaysAgo: Math.max(0, weekdaysBetween(last.date, today) - 1) } : null,
      };
    }),
    recentReports: Object.values(s.reports).slice(-5).reverse().map((r) => ({ id: r.id, workItem: r.workItem, date: r.date, text: r.text })),
    incidents: Object.values(s.incidents).slice(-5).reverse().map((x) => ({ id: x.id, date: x.date, text: x.text, workItems: x.workItems })),
    needsReview: needsReview(s),
    drafts: (() => {
      const collisions = draftCollisions(s, drafts);
      return Object.values(drafts).map((d) => {
        const problems = checkDraft(s, events, drafts, d).length + (collisions[d.id]?.length ?? 0);
        const expect = !problems && ["PRP", "DRF"].includes(idPrefix(d.id)) ? contentHash(s, drafts, d.json).slice(0, EXPECT_LENGTH) : undefined;
        return { id: d.id, kind: d.json?.kind ?? null, title: d.json?.title ?? d.json?.subject ?? null, problems, ...(expect ? { expect } : {}) };
      });
    })(),
    nextIds: nextIds(s, drafts),
  };
}

/** capacity: { "MEM-0002": 3 } のように、見通しの計算でだけメンバーの週の稼働日を置き換える（計画の下書きと、今の計画）。 */
export function show(id, { capacity = {} } = {}) {
  const root = requireRoot();
  const { events, state: s } = loadProject(root);
  const drafts = readDrafts(root);
  for (const [m, v] of Object.entries(capacity)) {
    if (!s.members[m] || s.members[m].removed) throw new UsageError(`--capacity の ${m} はメンバーにいません`);
    if (!(Number.isFinite(v) && v >= 0 && v <= 5)) throw new UsageError(`--capacity の ${m} は 0〜5 の数にしてください`);
  }
  if (drafts[id]) {
    const d = drafts[id];
    const out = { source: "draft", id, draft: d.json, error: d.error };
    if (d.json && ["PRP", "DRF"].includes(idPrefix(id))) {
      out.hash = contentHash(s, drafts, d.json).slice(0, EXPECT_LENGTH);
      out.boundEstimates = boundEstimates(s, drafts, d.json).map((e) => e.id);
    }
    const f = d.json ? draftForecast(s, events, drafts, d, capacity) : undefined;
    if (f) out.forecast = f;
    else if (["plan", "members", "progress"].includes(d.json?.kind)) out.forecastProblems = checkDraft(s, events, drafts, d);
    return out;
  }
  const entity = lookup(s, id);
  if (!entity) throw new HitpError(`${id} は下書きにも記録にもありません`);
  const out = { source: "record", id, record: entity };
  if (idPrefix(id) === "PLAN" && s.currentPlan === id) out.forecast = forecast(s, { today: localDate(now()), capacity });
  if (idPrefix(id) === "WI") {
    out.gates = Object.values(s.gates).filter((g) => g.workItem === id);
    out.reports = Object.values(s.reports).filter((r) => r.workItem === id);
    out.deliverables = Object.values(s.deliverables).filter((x) => x.workItem === id);
    out.gateRecords = Object.values(s.gateRecords).filter((r) => r.workItem === id);
  }
  return out;
}

