// 状態の畳み込み — イベントを 1 つずつ当て、不変条件に反すれば HitpError を投げる。
// 承認・提出のコマンドも verify も同じ applyEvent を通るので、受け付ける条件は 1 か所にしかない。
import { HitpError, idPrefix, idNumber, formatId, canonical, sha256, isNonEmptyString, isDate, isDateTime } from "./util.mjs";
import { PHASES, label, isTerminal } from "./labels.mjs";
import { draftProblems } from "./schema.mjs";

const ENTITY_MAPS = {
  OBJ: "objectives", PRM: "premises", MEM: "members", PLAN: "plans", WI: "workItems", QG: "goals", GATE: "gates",
  EST: "estimates", DEC: "decisions", RPT: "reports", INC: "incidents", DLV: "deliverables", GR: "gateRecords",
};

export function emptyState() {
  return {
    seq: 0, project: null, phase: null, currentPlan: null, charter: null,
    objectives: {}, premises: {}, members: {}, plans: {}, workItems: {}, goals: {}, gates: {},
    estimates: {}, decisions: {}, reports: {}, incidents: {}, deliverables: {}, gateRecords: {},
    consumed: {}, // 承認・却下済みの下書きの ID（再利用させない）
  };
}

/** ID が記録のどこかで使われているか。 */
export function lookup(s, id) {
  const prefix = idPrefix(id);
  if (!prefix) return null;
  if (prefix === "PRP" || prefix === "DRF") return s.consumed[id] ?? null;
  return s[ENTITY_MAPS[prefix]]?.[id] ?? null;
}
const isUsed = (s, id) => lookup(s, id) !== null;

/** 接頭辞ごとの、記録で使われている最大の番号。 */
export function maxNumbers(s) {
  const max = {};
  const see = (id) => { const p = idPrefix(id); if (p) max[p] = Math.max(max[p] ?? 0, idNumber(id)); };
  for (const map of Object.values(ENTITY_MAPS)) for (const id of Object.keys(s[map])) see(id);
  for (const id of Object.keys(s.consumed)) see(id);
  return max;
}

export const activeGates = (s, wi) => Object.values(s.gates).filter((g) => g.active && g.workItem === wi);

export function applyEvent(state, event) {
  const s = structuredClone(state);
  const problems = [];
  let effects = {};
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new HitpError("イベントがオブジェクトではありません");
  if (event.seq !== s.seq + 1) problems.push(`イベントの seq が ${s.seq + 1} ではありません（${event.seq}）`);
  else if (s.seq === 0 && event.type !== "initialized") problems.push("最初のイベントは initialized でなければなりません");
  else if (s.seq > 0 && event.type === "initialized") problems.push("プロジェクトはすでに始まっています");
  else {
    const data = event.data ?? {};
    switch (event.type) {
      case "initialized": applyInitialized(s, data, problems); break;
      case "approved": effects = applyApproved(s, data, event.at, problems); break;
      case "rejected": applyRejected(s, data, event.at, problems); break;
      case "submitted": applySubmitted(s, data, event.at, problems); break;
      case "checkpointed": applyCheckpointed(s, data, event.at, problems, (e) => { effects = e; }); break;
      default: problems.push(`未知のイベント ${event.type}`);
    }
  }
  // 不変条件はほかの問題があっても見る（問題を一度に出すため）。イベントの形が壊れているときは見ない
  if (event.seq === s.seq + 1 && s.project) for (const x of invariantProblems(s)) if (!problems.includes(x)) problems.push(x);
  if (problems.length) throw new HitpError(problems);
  s.seq = event.seq;
  return { state: s, effects };
}

function applyInitialized(s, data, problems) {
  if (!isNonEmptyString(data.project?.name)) { problems.push("プロジェクト名が空です"); return; }
  s.project = { name: data.project.name };
  s.phase = "ideation";
}

/** 下書きの中身が記録したハッシュと一致し、まだ使われていないこと。 */
function checkDraftEnvelope(s, data, prefixes, problems) {
  const d = data.draft;
  if (!d || typeof d !== "object" || !prefixes.includes(idPrefix(d.id))) { problems.push(`下書きは ${prefixes.join("・")} でなければなりません`); return null; }
  if (data.draftSha256 !== sha256(canonical(d))) problems.push(`${d.id} の中身が記録したハッシュと一致しません`);
  if (s.consumed[d.id]) problems.push(`${d.id} はすでに${s.consumed[d.id].outcome === "rejected" ? "却下" : "承認"}されています`);
  return d;
}

/** 新しく作る ID が、その接頭辞のものでまだ使われていないこと。 */
function requireFresh(s, id, prefix, problems) {
  if (idPrefix(id) !== prefix) problems.push(`${id} は ${prefix} の ID ではありません`);
  else if (isUsed(s, id)) problems.push(`${id} はすでに使われています（記録で次に空いている ID は ${formatId(prefix, (maxNumbers(s)[prefix] ?? 0) + 1)}。hitp status --json の nextIds も見てください）`);
}

function checkRefs(s, refs, where, problems) {
  for (const r of refs ?? []) if (typeof r === "string" && !isUsed(s, r)) problems.push(`${where} の ${r} が見つかりません`);
}

function applyApproved(s, data, at, problems) {
  const d = checkDraftEnvelope(s, data, ["PRP", "DRF"], problems);
  if (!d) return {};
  const shape = draftProblems(d);
  if (shape.length) { problems.push(...shape); return {}; }

  // 写し取った推定を先に入れる（根拠と WorkItem の推定は、これを指せる）。
  const estimates = Array.isArray(data.estimates) ? data.estimates : [];
  for (const e of estimates) {
    const ep = draftProblems(e);
    if (idPrefix(e?.id) !== "EST") ep.push(`写し取った推定 ${e?.id} は EST の ID ではありません`);
    if (ep.length) { problems.push(...ep); continue; }
    if (isUsed(s, e.id)) { problems.push(`${e.id} はすでに記録されています`); continue; }
    s.estimates[e.id] = { ...e, recordedBy: data.decision ?? data.record };
  }
  for (const e of estimates) if (s.estimates[e?.id]) checkRefs(s, e.inputs, `${e.id} inputs`, problems);
  checkRefs(s, d.rationale?.refs, `${d.id} rationale.refs`, problems);
  // 参照の問題があっても止めず、提案の中身の問題まで一度に出す（どちらにしても問題があれば承認しない）

  const effects = {};
  if (idPrefix(d.id) === "PRP") {
    const before = problems.length;
    requireFresh(s, data.decision, "DEC", problems);
    if (problems.length > before) return {};
    const own = []; // 提案の処理は、ほかの問題があっても最後まで見る
    PROPOSAL[d.kind](s, d.payload, own, effects, d.id);
    problems.push(...own);
    s.decisions[data.decision] = { id: data.decision, draft: d.id, kind: d.kind, title: d.title, outcome: "approved", at };
  } else {
    const before = problems.length;
    requireFresh(s, data.record, d.kind === "incident" ? "INC" : "RPT", problems);
    if (problems.length > before) return {};
    const own = [];
    RECORD[d.kind](s, d.payload, own, effects, data.record, at);
    problems.push(...own);
  }
  s.consumed[d.id] = { outcome: "approved", by: data.decision ?? data.record };
  return effects;
}

function applyRejected(s, data, at, problems) {
  const d = checkDraftEnvelope(s, data, ["PRP"], problems);
  if (!d) return;
  requireFresh(s, data.decision, "DEC", problems);
  if (data.reason !== undefined && typeof data.reason !== "string") problems.push("却下の理由は文字列でなければなりません");
  if (problems.length) return;
  s.decisions[data.decision] = { id: data.decision, draft: d.id, kind: d.kind, title: d.title, outcome: "rejected", reason: data.reason, at };
  s.consumed[d.id] = { outcome: "rejected", by: data.decision };
}

/** 追加: まだ使われていない ID であること（削除・廃止したものの ID も使えない）。 */
function addEntity(s, map, prefix, item, problems, make) {
  requireFresh(s, item.id, prefix, problems);
  if (!problems.length) s[map][item.id] = make();
}

/** 更新: 既にあり、削除・廃止していないこと。 */
function updateEntity(s, map, item, problems, effects, make) {
  const cur = s[map][item.id];
  if (!cur) problems.push(`更新する ${item.id} が見つかりません`);
  else if (cur.removed) problems.push(`${item.id} は削除済みです`);
  else if (cur.active === false) problems.push(`${item.id} は廃止済みです。新しい ID で追加してください`);
  if (problems.length) return;
  s[map][item.id] = make(cur);
  (effects.updated ??= []).push(item.id);
}

/** 削除: 実体は残して印を付ける（ID を再発行させず、過去の参照を解決できるようにする）。 */
function removeEntity(s, map, id, problems, effects) {
  const cur = s[map][id];
  if (!cur || cur.removed) { problems.push(`削除する ${id} が見つかりません`); return; }
  cur.removed = true;
  (effects.removed ??= []).push(id);
}

function existingNonTerminal(s, id, where, problems) {
  const wi = s.workItems[id];
  if (!wi) { problems.push(`${where} の ${id} が見つかりません`); return null; }
  if (isTerminal(wi.state)) { problems.push(`${where} の ${id} は${label("workItemState", wi.state)}しています`); return null; }
  return wi;
}

const PROPOSAL = {
  charter(s, p, problems, effects) {
    s.charter = { problem: p.problem, direction: p.direction, scope: { in: p.scope?.in ?? [], out: p.scope?.out ?? [] } };
    effects.charter = true;
  },
  objectives(s, p, problems, effects) {
    for (const o of p.add ?? []) addEntity(s, "objectives", "OBJ", o, problems, () => ({ id: o.id, statement: o.statement, status: "unmet" }));
    for (const o of p.update ?? []) updateEntity(s, "objectives", o, problems, effects, (cur) => ({ ...cur, statement: o.statement }));
  },
  "objective-status"(s, p, problems) {
    for (const u of p.updates) {
      const o = s.objectives[u.id];
      if (!o) { problems.push(`${u.id} が見つかりません`); continue; }
      o.status = u.status;
      o.note = u.note;
    }
  },
  premises(s, p, problems, effects) {
    const make = (o, cur) => ({
      id: o.id, type: o.type, statement: o.statement,
      ...(o.type === "assumption" ? { verification: cur?.verification ?? "unverified", note: cur?.note } : {}),
    });
    for (const r of p.remove ?? []) removeEntity(s, "premises", r, problems, effects);
    for (const o of p.add ?? []) addEntity(s, "premises", "PRM", o, problems, () => make(o));
    for (const o of p.update ?? []) updateEntity(s, "premises", o, problems, effects, (cur) => make(o, cur));
    const constraints = [...(p.add ?? []), ...(p.update ?? [])].filter((o) => o.type === "constraint").map((o) => o.id);
    if (constraints.length && !problems.length) effects.constraints = constraints;
  },
  "assumption-status"(s, p, problems) {
    for (const u of p.updates) {
      const pr = s.premises[u.id];
      if (!pr || pr.removed) { problems.push(`${u.id} が見つかりません`); continue; }
      if (pr.type !== "assumption") { problems.push(`${u.id} は仮定ではありません（${label("premiseType", pr.type)}）`); continue; }
      pr.verification = u.verification;
      pr.note = u.note;
      pr.verifiedSeq = s.seq + 1; // 見直しが要るもの（commands.mjs）で、このあとに承認された計画と比べる
    }
  },
  members(s, p, problems, effects) {
    const make = (m) => ({ id: m.id, name: m.name, role: m.role, ability: m.ability, availability: m.availability, capacity: m.capacity ?? null, away: m.away ?? [] });
    for (const r of p.remove ?? []) removeEntity(s, "members", r, problems, effects);
    for (const m of p.add ?? []) addEntity(s, "members", "MEM", m, problems, () => make(m));
    for (const m of p.update ?? []) updateEntity(s, "members", m, problems, effects, () => make(m));
  },
  plan(s, p, problems, effects) {
    // 置き換える計画が今の計画と一致するときだけ承認できる（PHASE-PLANNING.md「決めたこと」4）
    if (p.replaces !== (s.currentPlan ?? null)) {
      problems.push(`この案は ${p.replaces ?? "計画が無い状態"} を置き換える案ですが、今の計画は ${s.currentPlan ?? "まだありません"} です。今の計画をもとに書き直すか、この案を却下してください（replaces: ${JSON.stringify(s.currentPlan ?? null)}）`);
    }
    requireFresh(s, p.id, "PLAN", problems);
    const ids = new Set();
    for (const wi of p.workItems) {
      if (ids.has(wi.id)) problems.push(`${wi.id} が計画に 2 回あります`);
      ids.add(wi.id);
      const cur = s.workItems[wi.id];
      if (cur && isTerminal(cur.state)) problems.push(`${wi.id} は${label("workItemState", cur.state)}しているため計画に載せられません`);
      if (!cur) requireFresh(s, wi.id, "WI", problems);
      const est = wi.estimate ? s.estimates[wi.estimate] : null;
      if (wi.estimate && !est) problems.push(`${wi.id} の推定 ${wi.estimate} が見つかりません`);
      // 見通しを計算できるように、WorkItem の推定は工数見積・人日に限る（PHASE-PLANNING.md「決めたこと」3）
      else if (est && (est.method !== "effort" || est.value?.unit !== "人日")) problems.push(`${wi.id} の推定 ${wi.estimate} は工数見積（effort）で単位が「人日」でなければなりません（${est.method}・${est.value?.unit}）`);
      else if (est) for (const [j, cp] of (wi.checkpoints ?? []).entries()) if (cp.remaining.high > est.value.high) problems.push(`${wi.id} のチェックポイント ${j + 1} の残り（上限 ${cp.remaining.high} 人日）が、推定 ${wi.estimate} の上限（${est.value.high} 人日）より多くなっています`);
    }
    if (problems.length) return;
    const cancelled = [];
    for (const w of Object.values(s.workItems)) {
      if (!isTerminal(w.state) && !ids.has(w.id)) { w.state = "cancelled"; cancelled.push(w.id); }
    }
    if (s.currentPlan) s.plans[s.currentPlan].status = "superseded";
    s.plans[p.id] = { id: p.id, deadline: p.deadline, workItems: [...ids], status: "current", approvedSeq: s.seq + 1 };
    s.currentPlan = p.id;
    for (const wi of p.workItems) {
      const cur = s.workItems[wi.id];
      s.workItems[wi.id] = {
        id: wi.id, title: wi.title, type: wi.type, assignee: wi.assignee ?? null, estimate: wi.estimate ?? null, waitDays: wi.waitDays ?? 0, checkpoints: wi.checkpoints ?? [],
        dependsOn: wi.dependsOn ?? [], deliverables: wi.deliverables ?? [], question: wi.question ?? null, tests: wi.tests ?? [],
        state: cur?.state ?? "todo", plan: p.id,
      };
    }
    if (cancelled.length) effects.cancelled = cancelled;
  },
  quality(s, p, problems, effects) {
    for (const [map, list, what] of [["goals", p.goals?.retire, "品質目標"], ["gates", p.gates?.retire, "ゲート"]]) {
      for (const r of list ?? []) {
        const g = s[map][r];
        if (!g || !g.active) problems.push(`廃止する${what} ${r} が見つかりません`);
        else { g.active = false; (effects.retired ??= []).push(r); }
      }
    }
    const targetOk = (g) => {
      if (!isUsed(s, g.target) || !["WI", "OBJ"].includes(idPrefix(g.target))) problems.push(`品質目標 ${g.id} の対象 ${g.target} が見つかりません`);
    };
    for (const g of p.goals?.add ?? []) { targetOk(g); addEntity(s, "goals", "QG", g, problems, () => ({ ...g, active: true })); }
    for (const g of p.goals?.update ?? []) { targetOk(g); updateEntity(s, "goals", g, problems, effects, () => ({ ...g, active: true })); }
    for (const g of p.gates?.add ?? []) {
      existingNonTerminal(s, g.workItem, `ゲート ${g.id}`, problems);
      addEntity(s, "gates", "GATE", g, problems, () => ({ ...g, active: true }));
    }
    for (const g of p.gates?.update ?? []) {
      existingNonTerminal(s, g.workItem, `ゲート ${g.id}`, problems);
      updateEntity(s, "gates", g, problems, effects, () => ({ ...g, active: true }));
    }
  },
  phase(s, p, problems, effects) {
    const from = PHASES.indexOf(s.phase);
    const to = PHASES.indexOf(p.to);
    if (s.phase === "closed") problems.push("終了したプロジェクトのフェーズは変えられません（INV-11）");
    else if (!(to === from + 1 || to < from)) problems.push(`${label("phase", s.phase)}から${label("phase", p.to)}へは遷移できません。次のフェーズか、前のフェーズへの戻りだけです（INV-11）`);
    if (problems.length) return;
    effects.phase = { from: s.phase, to: p.to };
    s.phase = p.to;
  },
  cancel(s, p, problems, effects) {
    for (const id of p.workItems) {
      const wi = existingNonTerminal(s, id, "中止", problems);
      if (wi) wi.state = "cancelled";
    }
    effects.cancelled = [...p.workItems];
  },
  advice() {},
};

const RECORD = {
  progress(s, p, problems, effects, id, at) {
    const wi = existingNonTerminal(s, p.workItem, "進捗報告", problems);
    if (!wi) return;
    const cp = p.checkpoint === undefined ? null : (wi.checkpoints ?? [])[p.checkpoint - 1];
    if (p.checkpoint !== undefined && !cp) { problems.push(`${wi.id} にチェックポイント ${p.checkpoint} はありません（${(wi.checkpoints ?? []).length} 個）`); return; }
    // 残りは、書いてあればそれを、無ければ通過したチェックポイントに計画で書いた残りを使う
    s.reports[id] = { id, workItem: p.workItem, date: p.date, text: p.text, completion: false, checkpoint: p.checkpoint ?? null, remaining: p.remaining ?? cp?.remaining ?? null, at };
    if (wi.state === "todo") { wi.state = "doing"; effects.started = p.workItem; }
  },
  incident(s, p, problems, effects, id, at) {
    for (const w of p.workItems ?? []) if (!s.workItems[w]) problems.push(`不測の事態の ${w} が見つかりません`);
    if (problems.length) return;
    s.incidents[id] = { id, date: p.date, text: p.text, workItems: p.workItems ?? [], at };
  },
  completion(s, p, problems, effects, id, at) {
    const wi = existingNonTerminal(s, p.workItem, "完了報告", problems);
    if (!wi) return;
    if (wi.deliverables.length) { problems.push(`${wi.id} は成果物を生むため、完了報告ではなくゲート充足の提出でだけ完了します（INV-10）`); return; }
    s.reports[id] = { id, workItem: p.workItem, date: p.date, text: p.text, completion: true, at };
    wi.state = "done";
    effects.completed = wi.id;
  },
};

/** リーダーが hitp checkpoint で、WorkItem のチェックポイントの通過を記録する（進捗報告を 1 つ作る）。 */
function applyCheckpointed(s, data, at, problems, setEffects) {
  const wi = existingNonTerminal(s, data.workItem, "チェックポイント", problems);
  if (!wi) return;
  const cp = (wi.checkpoints ?? [])[data.checkpoint - 1];
  if (!Number.isInteger(data.checkpoint) || !cp) { problems.push(`${wi.id} にチェックポイント ${data.checkpoint} はありません（${(wi.checkpoints ?? []).length} 個）`); return; }
  if (!isDate(data.date)) { problems.push(`日付は YYYY-MM-DD でなければなりません（${JSON.stringify(data.date)}）`); return; }
  if (data.note !== undefined && typeof data.note !== "string") { problems.push("note は文字列でなければなりません"); return; }
  requireFresh(s, data.report, "RPT", problems);
  if (problems.length) return;
  const text = `チェックポイント ${data.checkpoint}「${cp.title}」を通過${data.note ? `。${data.note}` : ""}`;
  s.reports[data.report] = { id: data.report, workItem: wi.id, date: data.date, text, completion: false, checkpoint: data.checkpoint, remaining: cp.remaining, at };
  const effects = { checkpoint: { workItem: wi.id, n: data.checkpoint, title: cp.title, remaining: cp.remaining } };
  if (wi.state === "todo") { wi.state = "doing"; effects.started = wi.id; }
  setEffects(effects);
}

function applySubmitted(s, data, at, problems) {
  const wi = s.workItems[data.workItem];
  if (!wi) { problems.push(`${data.workItem} が見つかりません`); return; }
  if (wi.state === "done") { problems.push(`${wi.id} はすでに完了しています。提出は 1 回だけです（INV-12）`); return; }
  if (wi.state === "cancelled") { problems.push(`${wi.id} は中止しています`); return; }
  if (!wi.deliverables.length) { problems.push(`${wi.id} は成果物を生まない WorkItem です。完了報告で完了します（INV-14）`); return; }

  const deliverables = Array.isArray(data.deliverables) ? data.deliverables : [];
  const gateRecords = Array.isArray(data.gateRecords) ? data.gateRecords : [];

  const newIds = [...deliverables, ...gateRecords].map((x) => x?.id);
  for (const id of new Set(newIds.filter((id, i) => newIds.indexOf(id) !== i))) problems.push(`${id} が 2 回使われています`);
  const kinds = new Set(deliverables.map((x) => x.kind));
  for (const k of wi.deliverables) if (!kinds.has(k)) problems.push(`成果物「${k}」がありません`);
  const paths = new Set();
  for (const x of deliverables) {
    if (!wi.deliverables.includes(x.kind)) problems.push(`成果物の種類「${x.kind}」は ${wi.id} で宣言されていません（宣言: ${wi.deliverables.join("・")}）`);
    requireFresh(s, x.id, "DLV", problems);
    if (typeof x.path !== "string" || !x.path.startsWith(`deliverables/${wi.id}/${x.kind}/`)) problems.push(`${x.id} の保存先が不正です（${x.path}）`);
    if (paths.has(x.path)) problems.push(`保存先 ${x.path} が重複しています`);
    paths.add(x.path);
    if (!/^[0-9a-f]{64}$/.test(x.sha256 ?? "")) problems.push(`${x.id} の sha256 が不正です`);
    if (!Number.isInteger(x.bytes) || x.bytes < 0) problems.push(`${x.id} の大きさが不正です`);
  }

  // INV-4: 付いている承認済みゲートのすべてに、通過の記録が要る。
  const gates = activeGates(s, wi.id);
  const seen = new Set();
  for (const r of gateRecords) {
    requireFresh(s, r.id, "GR", problems);
    if (!gates.some((g) => g.id === r.gate)) { problems.push(`ゲート ${r.gate} は ${wi.id} に付いていません`); continue; }
    if (seen.has(r.gate)) problems.push(`ゲート ${r.gate} の記録が 2 つあります`);
    seen.add(r.gate);
    if (!isNonEmptyString(r.by)) problems.push(`ゲート ${r.gate} の「誰が」（by）が空です`);
    if (!isDate(r.at) && !isDateTime(r.at)) problems.push(`ゲート ${r.gate} の「いつ」（at）は YYYY-MM-DD か ISO 8601 の日時でなければなりません（${JSON.stringify(r.at)}）`);
    if (r.result === "fail") problems.push(`ゲート ${r.gate} は不通過です`);
    else if (r.result !== "pass") problems.push(`ゲート ${r.gate} の結果（result）は pass か fail でなければなりません（${JSON.stringify(r.result)}）`);
  }
  for (const g of gates) if (!seen.has(g.id)) problems.push(`ゲート ${g.id}（${label("gateType", g.type)}: ${g.description}）の通過記録がありません`);
  if (problems.length) return;

  for (const x of deliverables) s.deliverables[x.id] = { id: x.id, workItem: wi.id, kind: x.kind, path: x.path, sha256: x.sha256, bytes: x.bytes, at };
  for (const r of gateRecords) s.gateRecords[r.id] = { id: r.id, workItem: wi.id, gate: r.gate, by: r.by, at: r.at, result: r.result, recordedAt: at };
  wi.state = "done";
  wi.submittedAt = at;
}

/** どのイベントの後でも成り立つべき条件。 */
function invariantProblems(s) {
  const problems = [];
  const open = Object.values(s.workItems).filter((w) => !isTerminal(w.state));
  for (const w of open) {
    if (w.assignee && (!s.members[w.assignee] || s.members[w.assignee].removed)) problems.push(`${w.id} の担当 ${w.assignee} がメンバーにいません`);
    for (const t of w.tests) {
      const pr = s.premises[t];
      if (!pr || pr.removed) problems.push(`${w.id} が検証する前提 ${t} が見つかりません`);
      else if (pr.type !== "assumption") problems.push(`${w.id} が検証する ${t} は仮定ではありません（${label("premiseType", pr.type)}）`);
    }
    for (const dep of w.dependsOn) {
      const t = s.workItems[dep];
      if (!t) problems.push(`${w.id} の依存先 ${dep} が見つかりません`);
      else if (t.state === "cancelled") problems.push(`${w.id} の依存先 ${dep} は中止しています`);
      else if (dep === w.id) problems.push(`${w.id} が自分自身に依存しています`);
    }
  }
  const cycle = findCycle(open);
  if (cycle) problems.push(`WorkItem の依存が循環しています（${cycle.join(" → ")}）`);
  // INV-13: ゲートは成果物を生む WorkItem にだけ付く。
  for (const g of Object.values(s.gates)) {
    const w = s.workItems[g.workItem];
    if (g.active && w && !isTerminal(w.state) && !w.deliverables.length) problems.push(`ゲート ${g.id} が付いた ${w.id} は成果物を生みません（INV-13）`);
  }
  for (const g of Object.values(s.goals)) if (g.active && !isUsed(s, g.target)) problems.push(`品質目標 ${g.id} の対象 ${g.target} が見つかりません`);
  return problems;
}

function findCycle(items) {
  const byId = new Map(items.map((w) => [w.id, w]));
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      if (state.get(dep) === 1) return [...stack.slice(stack.indexOf(dep)), dep];
      if (!state.has(dep)) { const c = visit(dep); if (c) return c; }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of byId.keys()) if (!state.has(id)) { const c = visit(id); if (c) return c; }
  return null;
}

