// 下書きの形の検査（STORAGE.md「下書きの形式」）。参照が解決できるかや不変条件は model.mjs が見る。
// 未知の項目は受け付けない。下書きが状態（WorkItem の完了など）を書き込めないようにするため（INV-2・INV-5）。
import { idPrefix, isId, isNonEmptyString, isDate } from "./util.mjs";
import { codes } from "./labels.mjs";

export const PROPOSAL_KINDS = ["charter", "objectives", "objective-status", "premises", "assumption-status", "members", "plan", "quality", "phase", "cancel", "advice"];
export const RECORD_KINDS = ["progress", "incident", "completion"];

/** 検査の文脈。where は問題の文に出す場所（例: "PRP-0004 payload.workItems[0]"）。 */
class Checker {
  constructor() { this.problems = []; }
  push(msg) { this.problems.push(msg); }

  object(v, where, allowed, required = []) {
    if (!v || typeof v !== "object" || Array.isArray(v)) { this.push(`${where} はオブジェクトでなければなりません`); return false; }
    for (const k of Object.keys(v)) if (!allowed.includes(k)) this.push(`${where} に未知の項目 ${k} があります`);
    for (const k of required) if (!(k in v)) this.push(`${where} に ${k} がありません`);
    return true;
  }
  text(v, where) { if (!isNonEmptyString(v)) this.push(`${where} は空でない文字列でなければなりません`); }
  optText(v, where) { if (v !== undefined && typeof v !== "string") this.push(`${where} は文字列でなければなりません`); }
  oneOf(v, group, where) { if (!codes(group).includes(v)) this.push(`${where} は ${codes(group).join("・")} のいずれかでなければなりません（${JSON.stringify(v)}）`); }
  id(v, prefix, where) { if (!isId(v, prefix)) this.push(`${where} は ${prefix}-0000 の形の ID でなければなりません（${JSON.stringify(v)}）`); }
  idIn(v, prefixes, where) { if (!prefixes.includes(idPrefix(v))) this.push(`${where} は ${prefixes.join("・")} の ID でなければなりません（${JSON.stringify(v)}）`); }
  date(v, where) { if (!isDate(v)) this.push(`${where} は YYYY-MM-DD の日付でなければなりません（${JSON.stringify(v)}）`); }
  array(v, where, { nonEmpty = false } = {}) {
    if (!Array.isArray(v)) { this.push(`${where} は配列でなければなりません`); return false; }
    if (nonEmpty && v.length === 0) this.push(`${where} が空です`);
    return true;
  }
  ids(v, prefix, where, opts) { if (this.array(v, where, opts)) v.forEach((x, i) => this.id(x, prefix, `${where}[${i}]`)); }
  /** 根拠の参照: ID か、リーダーの発言の引用。assume なら推定の入力として、エージェントの仮置きも受け付ける。 */
  refs(v, where, { nonEmpty, assume = false }) {
    if (!this.array(v, where)) return;
    if (nonEmpty && v.length === 0) this.push(`${where} に根拠が 1 つもありません（INV-7）`);
    const keys = assume ? ["quote", "assume"] : ["quote"];
    v.forEach((r, i) => {
      if (typeof r === "string") { if (!idPrefix(r)) this.push(`${where}[${i}] は ID でなければなりません（${JSON.stringify(r)}）`); return; }
      if (!this.object(r, `${where}[${i}]`, keys)) return;
      const present = keys.filter((k) => k in r);
      if (present.length !== 1) { this.push(`${where}[${i}] は ${keys.join("・")} のどれか 1 つだけを持ちます`); return; }
      this.text(r[present[0]], `${where}[${i}].${present[0]}`);
    });
  }
  /** add・update などの配列の要素を 1 つずつ検査する。 */
  items(p, where, keys, each) {
    for (const k of keys) if (p[k] !== undefined && this.array(p[k], `${where}.${k}`)) p[k].forEach((x, i) => each(x, `${where}.${k}[${i}]`));
  }
  nonEmptyPayload(p, where, keys) {
    if (!keys.some((k) => Array.isArray(p[k]) ? p[k].length > 0 : p[k] && typeof p[k] === "object")) this.push(`${where} に変更が 1 つもありません`);
  }
}

/** 工数の幅（人日）。0 以上で low ≤ high。 */
function effortRange(c, v, where) {
  if (!c.object(v, where, ["low", "high"], ["low", "high"])) return false;
  if (!Number.isFinite(v.low) || !Number.isFinite(v.high) || v.low < 0) { c.push(`${where} の low・high は 0 以上の数でなければなりません`); return false; }
  if (v.low > v.high) { c.push(`${where} の low が high より大きいです`); return false; }
  return true;
}

/** 成果物の種類は deliverables/ の下のディレクトリ名になるので、パスとして安全なものに限る。 */
export function isSafeKind(v) {
  return isNonEmptyString(v) && v === v.trim() && !/[/\\\0]/.test(v) && v !== "." && v !== ".." && !/[\u0000-\u001f]/.test(v);
}

const PAYLOAD = {
  charter(c, p, w) {
    if (!c.object(p, w, ["problem", "direction", "scope"], ["problem", "direction"])) return;
    c.text(p.problem, `${w}.problem`);
    c.text(p.direction, `${w}.direction`);
    if (p.scope !== undefined && c.object(p.scope, `${w}.scope`, ["in", "out"])) {
      for (const k of ["in", "out"]) if (p.scope[k] !== undefined && c.array(p.scope[k], `${w}.scope.${k}`)) p.scope[k].forEach((x, i) => c.text(x, `${w}.scope.${k}[${i}]`));
    }
  },
  objectives(c, p, w) {
    if (!c.object(p, w, ["add", "update"])) return;
    c.nonEmptyPayload(p, w, ["add", "update"]);
    c.items(p, w, ["add", "update"], (o, at) => {
      if (c.object(o, at, ["id", "statement"], ["id", "statement"])) { c.id(o.id, "OBJ", `${at}.id`); c.text(o.statement, `${at}.statement`); }
    });
  },
  "objective-status"(c, p, w) {
    if (!c.object(p, w, ["updates"], ["updates"])) return;
    if (c.array(p.updates, `${w}.updates`, { nonEmpty: true })) p.updates.forEach((u, i) => {
      const at = `${w}.updates[${i}]`;
      if (c.object(u, at, ["id", "status", "note"], ["id", "status"])) { c.id(u.id, "OBJ", `${at}.id`); c.oneOf(u.status, "objectiveStatus", `${at}.status`); c.optText(u.note, `${at}.note`); }
    });
  },
  premises(c, p, w) {
    if (!c.object(p, w, ["add", "update", "remove"])) return;
    c.nonEmptyPayload(p, w, ["add", "update", "remove"]);
    c.items(p, w, ["add", "update"], (o, at) => {
      if (c.object(o, at, ["id", "type", "statement"], ["id", "type", "statement"])) { c.id(o.id, "PRM", `${at}.id`); c.oneOf(o.type, "premiseType", `${at}.type`); c.text(o.statement, `${at}.statement`); }
    });
    if (p.remove !== undefined) c.ids(p.remove, "PRM", `${w}.remove`);
  },
  "assumption-status"(c, p, w) {
    if (!c.object(p, w, ["updates"], ["updates"])) return;
    if (c.array(p.updates, `${w}.updates`, { nonEmpty: true })) p.updates.forEach((u, i) => {
      const at = `${w}.updates[${i}]`;
      if (c.object(u, at, ["id", "verification", "note"], ["id", "verification"])) { c.id(u.id, "PRM", `${at}.id`); c.oneOf(u.verification, "verification", `${at}.verification`); c.optText(u.note, `${at}.note`); }
    });
  },
  members(c, p, w) {
    if (!c.object(p, w, ["add", "update", "remove"])) return;
    c.nonEmptyPayload(p, w, ["add", "update", "remove"]);
    c.items(p, w, ["add", "update"], (m, at) => {
      if (c.object(m, at, ["id", "name", "role", "ability", "availability", "capacity", "away"], ["id", "name"])) {
        c.id(m.id, "MEM", `${at}.id`); c.text(m.name, `${at}.name`);
        for (const k of ["role", "ability", "availability"]) c.optText(m[k], `${at}.${k}`);
        if (m.capacity !== undefined && !(Number.isFinite(m.capacity) && m.capacity >= 0 && m.capacity <= 5)) c.push(`${at}.capacity は週の稼働日（0〜5 の数）でなければなりません（${JSON.stringify(m.capacity)}）`);
        // 不在の期間（PHASE-EXECUTING.md「決めたこと」2）
        if (m.away !== undefined && c.array(m.away, `${at}.away`)) m.away.forEach((a, j) => {
          const aw = `${at}.away[${j}]`;
          if (!c.object(a, aw, ["from", "to"], ["from", "to"])) return;
          c.date(a.from, `${aw}.from`); c.date(a.to, `${aw}.to`);
          if (isDate(a.from) && isDate(a.to) && a.from > a.to) c.push(`${aw} の from が to より後です`);
        });
      }
    });
    if (p.remove !== undefined) c.ids(p.remove, "MEM", `${w}.remove`);
  },
  plan(c, p, w) {
    if (!c.object(p, w, ["id", "replaces", "deadline", "workItems"], ["id", "replaces", "deadline", "workItems"])) return;
    c.id(p.id, "PLAN", `${w}.id`);
    if (p.replaces !== null) c.id(p.replaces, "PLAN", `${w}.replaces`);
    c.date(p.deadline, `${w}.deadline`);
    if (!c.array(p.workItems, `${w}.workItems`)) return;
    p.workItems.forEach((wi, i) => {
      const at = `${w}.workItems[${i}]`;
      if (!c.object(wi, at, ["id", "title", "type", "assignee", "estimate", "waitDays", "checkpoints", "dependsOn", "deliverables", "question", "tests"], ["id", "title", "type"])) return;
      c.id(wi.id, "WI", `${at}.id`);
      c.text(wi.title, `${at}.title`);
      c.oneOf(wi.type, "workItemType", `${at}.type`);
      if (wi.assignee !== undefined) c.id(wi.assignee, "MEM", `${at}.assignee`);
      if (wi.estimate !== undefined) c.id(wi.estimate, "EST", `${at}.estimate`);
      if (wi.waitDays !== undefined && !(Number.isFinite(wi.waitDays) && wi.waitDays >= 0)) c.push(`${at}.waitDays は待ちの営業日（0 以上の数）でなければなりません（${JSON.stringify(wi.waitDays)}）`);
      // チェックポイント: 通過したあとに残る工数（人日）を持ち、後ろほど少ない（PHASE-EXECUTING.md「決めたこと」1）
      if (wi.checkpoints !== undefined && c.array(wi.checkpoints, `${at}.checkpoints`)) {
        let prev = null;
        wi.checkpoints.forEach((cp, j) => {
          const cw = `${at}.checkpoints[${j}]`;
          if (!c.object(cp, cw, ["title", "remaining"], ["title", "remaining"])) return;
          c.text(cp.title, `${cw}.title`);
          if (!effortRange(c, cp.remaining, `${cw}.remaining`)) return;
          if (prev && (cp.remaining.low > prev.low || cp.remaining.high > prev.high)) c.push(`${cw}.remaining は前のチェックポイントより多くなっています（後ろほど残りは少ない）`);
          prev = cp.remaining;
        });
      }
      if (wi.dependsOn !== undefined) c.ids(wi.dependsOn, "WI", `${at}.dependsOn`);
      if (wi.deliverables !== undefined && c.array(wi.deliverables, `${at}.deliverables`)) {
        wi.deliverables.forEach((k, j) => { if (!isSafeKind(k)) c.push(`${at}.deliverables[${j}] は成果物の種類の名前として使えません（${JSON.stringify(k)}）`); });
        if (new Set(wi.deliverables).size !== wi.deliverables.length) c.push(`${at}.deliverables に同じ種類が重複しています`);
      }
      if (wi.type === "explore") {
        c.text(wi.question, `${at}.question`);
        if (wi.tests !== undefined) c.ids(wi.tests, "PRM", `${at}.tests`);
      } else if (wi.type === "execute") {
        if (wi.question !== undefined || wi.tests !== undefined) c.push(`${at} は実行型なので question・tests を持てません`);
      }
    });
  },
  quality(c, p, w) {
    if (!c.object(p, w, ["goals", "gates"])) return;
    c.nonEmptyPayload(p, w, ["goals", "gates"]);
    if (p.goals !== undefined && c.object(p.goals, `${w}.goals`, ["add", "update", "retire"])) {
      c.items(p.goals, `${w}.goals`, ["add", "update"], (g, at) => {
        if (c.object(g, at, ["id", "target", "type", "statement"], ["id", "target", "type", "statement"])) {
          c.id(g.id, "QG", `${at}.id`); c.idIn(g.target, ["WI", "OBJ"], `${at}.target`); c.oneOf(g.type, "goalType", `${at}.type`); c.text(g.statement, `${at}.statement`);
        }
      });
      if (p.goals.retire !== undefined) c.ids(p.goals.retire, "QG", `${w}.goals.retire`);
    }
    if (p.gates !== undefined && c.object(p.gates, `${w}.gates`, ["add", "update", "retire"])) {
      c.items(p.gates, `${w}.gates`, ["add", "update"], (g, at) => {
        if (c.object(g, at, ["id", "workItem", "type", "description"], ["id", "workItem", "type", "description"])) {
          c.id(g.id, "GATE", `${at}.id`); c.id(g.workItem, "WI", `${at}.workItem`); c.oneOf(g.type, "gateType", `${at}.type`); c.text(g.description, `${at}.description`);
        }
      });
      if (p.gates.retire !== undefined) c.ids(p.gates.retire, "GATE", `${w}.gates.retire`);
    }
  },
  phase(c, p, w) {
    if (c.object(p, w, ["to"], ["to"])) c.oneOf(p.to, "phase", `${w}.to`);
  },
  cancel(c, p, w) {
    if (c.object(p, w, ["workItems"], ["workItems"])) c.ids(p.workItems, "WI", `${w}.workItems`, { nonEmpty: true });
  },
  advice(c, p, w) {
    c.object(p, w, []);
  },
  progress(c, p, w) {
    if (!c.object(p, w, ["workItem", "date", "text", "checkpoint", "remaining"], ["workItem", "date", "text"])) return;
    c.id(p.workItem, "WI", `${w}.workItem`); c.date(p.date, `${w}.date`); c.text(p.text, `${w}.text`);
    if (p.checkpoint !== undefined && !(Number.isInteger(p.checkpoint) && p.checkpoint >= 1)) c.push(`${w}.checkpoint はチェックポイントの番号（1 から）でなければなりません`);
    if (p.remaining !== undefined) effortRange(c, p.remaining, `${w}.remaining`);
  },
  incident(c, p, w) {
    if (!c.object(p, w, ["date", "text", "workItems"], ["date", "text"])) return;
    c.date(p.date, `${w}.date`); c.text(p.text, `${w}.text`);
    if (p.workItems !== undefined) c.ids(p.workItems, "WI", `${w}.workItems`);
  },
  completion(c, p, w) {
    if (!c.object(p, w, ["workItem", "date", "text"], ["workItem", "date", "text"])) return;
    c.id(p.workItem, "WI", `${w}.workItem`); c.date(p.date, `${w}.date`); c.text(p.text, `${w}.text`);
  },
};

/** 推定の形の検査（INV-6: 導出と入力を持つ）。 */
function checkEstimate(c, d) {
  if (!c.object(d, d.id, ["id", "kind", "subject", "method", "value", "derivation", "inputs"], ["id", "kind", "subject", "method", "value", "derivation", "inputs"])) return;
  c.text(d.subject, `${d.id} subject`);
  c.oneOf(d.method, "estimateMethod", `${d.id} method`);
  if (c.object(d.value, `${d.id} value`, ["low", "high", "unit"], ["low", "high", "unit"])) {
    const { low, high, unit } = d.value;
    if (!Number.isFinite(low) || !Number.isFinite(high)) c.push(`${d.id} value.low・value.high は数値でなければなりません`);
    else if (low > high) c.push(`${d.id} value.low が value.high より大きいです`);
    c.text(unit, `${d.id} value.unit`);
  }
  if (!isNonEmptyString(d.derivation)) c.push(`${d.id} に導出（derivation）がありません（INV-6）`);
  if (!Array.isArray(d.inputs) || d.inputs.length === 0) c.push(`${d.id} に入力（inputs）が 1 つもありません（INV-6）`);
  else c.refs(d.inputs, `${d.id} inputs`, { nonEmpty: true, assume: true });
}

/** 下書き 1 つの形を検査し、問題の一覧を返す。 */
export function draftProblems(d) {
  const c = new Checker();
  if (!d || typeof d !== "object" || Array.isArray(d)) return ["下書きはオブジェクトでなければなりません"];
  const prefix = idPrefix(d.id);
  if (!["PRP", "DRF", "EST"].includes(prefix)) return [`下書きの id は PRP・DRF・EST のいずれかの ID でなければなりません（${JSON.stringify(d.id)}）`];

  if (prefix === "EST") {
    if (d.kind !== "estimate") c.push(`${d.id} の kind は estimate でなければなりません`);
    checkEstimate(c, d);
    return c.problems;
  }

  const kinds = prefix === "PRP" ? PROPOSAL_KINDS : RECORD_KINDS;
  const required = prefix === "PRP" ? ["id", "kind", "title", "rationale", "payload"] : ["id", "kind", "title", "payload"];
  if (!c.object(d, d.id, ["id", "kind", "title", "body", "rationale", "payload"], required)) return c.problems;
  if (!kinds.includes(d.kind)) { c.push(`${d.id} の kind は ${kinds.join("・")} のいずれかでなければなりません（${JSON.stringify(d.kind)}）`); return c.problems; }
  c.text(d.title, `${d.id} title`);
  c.optText(d.body, `${d.id} body`);
  if (d.rationale !== undefined && c.object(d.rationale, `${d.id} rationale`, ["text", "refs"], ["refs"])) {
    c.optText(d.rationale.text, `${d.id} rationale.text`);
    c.refs(d.rationale.refs, `${d.id} rationale.refs`, { nonEmpty: prefix === "PRP" });
  }
  if ("payload" in d) PAYLOAD[d.kind](c, d.payload, `${d.id} payload`);
  return c.problems;
}

/** 下書きが参照する ID（根拠・推定の入力・WorkItem の推定）。承認時に推定を写し取るために使う。 */
export function referencedIds(d) {
  const ids = [];
  const fromRefs = (refs) => { if (Array.isArray(refs)) for (const r of refs) if (typeof r === "string") ids.push(r); };
  fromRefs(d?.rationale?.refs);
  if (d?.kind === "estimate") fromRefs(d.inputs);
  if (d?.kind === "plan" && Array.isArray(d.payload?.workItems)) for (const wi of d.payload.workItems) if (typeof wi?.estimate === "string") ids.push(wi.estimate);
  return ids;
}

/** 下書きが新しく作る ID（add の ID と計画の ID）。計画の WorkItem は記録にないものだけ（isKnown で判定）。 */
export function createdIds(d, isKnown) {
  const p = d?.payload;
  if (!p || typeof p !== "object") return [];
  const ids = [];
  const fromAdd = (x) => { if (Array.isArray(x?.add)) for (const o of x.add) if (typeof o?.id === "string") ids.push(o.id); };
  if (["objectives", "premises", "members"].includes(d.kind)) fromAdd(p);
  if (d.kind === "quality") { fromAdd(p.goals); fromAdd(p.gates); }
  if (d.kind === "plan") {
    if (typeof p.id === "string") ids.push(p.id);
    if (Array.isArray(p.workItems)) for (const wi of p.workItems) if (typeof wi?.id === "string" && !isKnown(wi.id)) ids.push(wi.id);
  }
  return ids;
}
