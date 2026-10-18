// 計画の見通し（PHASE-PLANNING.md「決めたこと」2）。決まった手順の計算だけを行い、無理かどうかは判断しない。
// 計算の約束:
//   - 平日だけ数える。祝日・年末年始は数えない。
//   - 担当者は、計画に並んだ順（依存先が先）に WorkItem を 1 つずつ進める。
//   - 期間（営業日）= 工数（人日）÷ 週の稼働日 × 5 + 待ちの営業日。下限と上限を別々に計算する。
//   - 待ち（承認待ち・納品待ちなど）は作業のあとに来る。待ちの間、担当者はほかの WorkItem を進められ、負荷にも入らない。
//     担当も工数も無く待ちだけの WorkItem は、待ちだけを数える。
//   - 完了した WorkItem は 0、中止した WorkItem は数えない。進行中の WorkItem は、残りの工数が書かれた最新の報告の残りで数える
//     （無ければ推定の全量）。
//   - 担当者の不在の期間（away）の営業日は、その担当者の作業を進めない。
//   - 今日から期限の日までを、両端を含めて数える。

const DAY = 86400000;
const toUtc = (date) => Date.parse(`${date}T00:00:00Z`);
const r1 = (x) => Math.round(x * 10) / 10;

/** from から to までの平日の数（両端を含む）。to が from より前なら 0。 */
export function weekdaysBetween(from, to) {
  let n = 0;
  for (let t = toUtc(from); t <= toUtc(to); t += DAY) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

/** 現在時刻（ISO）の、この機械の暦での日付。 */
export function localDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const isWeekday = (t) => { const w = new Date(t).getUTCDay(); return w !== 0 && w !== 6; };

/** 不在の期間を、今日を 0 とした営業日の番号の集まりにする。 */
function awayDays(today, away = []) {
  const days = new Set();
  const start = toUtc(today);
  for (const a of away) {
    for (let t = Math.max(start, toUtc(a.from)); t <= toUtc(a.to); t += DAY) if (isWeekday(t)) days.add(weekdaysBetween(today, new Date(t).toISOString().slice(0, 10)) - 1);
  }
  return days;
}

/** start（営業日）から work 営業日ぶん進めた時点。不在の日は進めない。 */
function advance(start, work, away) {
  let t = start;
  let w = work;
  while (w > 1e-9) {
    const d = Math.floor(t + 1e-9);
    if (away.has(d)) { t = d + 1; continue; }
    const step = Math.min(w, d + 1 - t);
    t += step;
    w -= step;
  }
  return t;
}

/** WorkItem の残りの工数: 進行中なら、残りが書かれた最新の報告の残り。無ければ推定の全量。 */
export function remainingOf(s, w) {
  if (w.state === "doing") {
    const latest = Object.values(s.reports).filter((r) => r.workItem === w.id && r.remaining).at(-1);
    if (latest) return { ...latest.remaining, from: latest.id };
  }
  const est = w.estimate ? s.estimates[w.estimate] : null;
  return est ? { low: est.value.low, high: est.value.high, from: w.estimate } : null;
}

/** 依存先を先に、それ以外は計画に並んだ順に並べる。 */
function ordered(items) {
  const ids = new Set(items.map((w) => w.id));
  const placed = new Set();
  const out = [];
  let rest = [...items];
  while (rest.length) {
    const next = rest.find((w) => w.dependsOn.every((d) => placed.has(d) || !ids.has(d)));
    if (!next) break; // 循環は承認の検査が止めている
    out.push(next);
    placed.add(next.id);
    rest = rest.filter((w) => w !== next);
  }
  return out;
}

/**
 * 今の計画の見通し。capacity で、メンバーの週の稼働日を仮に置き換えられる（修正案を比べるため。記録は変えない）。
 * 計画が無ければ null。
 */
export function forecast(s, { today, capacity = {} } = {}) {
  const plan = s.currentPlan ? s.plans[s.currentPlan] : null;
  if (!plan) return null;
  const items = ordered(plan.workItems.map((id) => s.workItems[id]).filter((w) => w && w.state !== "cancelled"));
  const capOf = (m) => (m.id in capacity ? capacity[m.id] : m.capacity) ?? null;
  const away = Object.fromEntries(Object.values(s.members).map((m) => [m.id, awayDays(today, m.away)]));
  const missing = [];
  const finish = { low: {}, high: {} };
  const free = { low: {}, high: {} };
  const counted = [];
  for (const w of items) {
    let dur = null;
    const wait = w.state === "done" ? 0 : (w.waitDays ?? 0);
    if (w.state === "done") dur = { low: 0, high: 0 };
    else if (!w.estimate && !w.assignee && wait > 0) dur = { low: 0, high: 0 };
    else {
      const rest = remainingOf(s, w);
      const m = w.assignee ? s.members[w.assignee] : null;
      const cap = m ? capOf(m) : null;
      if (!rest) missing.push(`${w.id} に工数の推定がありません`);
      if (!m) missing.push(`${w.id} に担当がいません`);
      else if (!(cap > 0)) missing.push(`${w.id} の担当 ${m.id} に週の稼働日がありません`);
      if (rest && m && cap > 0) dur = { low: (rest.low / cap) * 5, high: (rest.high / cap) * 5 };
    }
    for (const k of ["low", "high"]) {
      const ready = Math.max(0, ...w.dependsOn.map((d) => finish[k][d] ?? 0));
      const working = dur && w.state !== "done" && w.assignee;
      const start = Math.max(ready, working ? (free[k][w.assignee] ?? 0) : 0);
      const workEnd = working ? advance(start, dur[k], away[w.assignee] ?? new Set()) : start + (dur ? dur[k] : 0);
      if (working) free[k][w.assignee] = workEnd;
      finish[k][w.id] = workEnd + wait;
    }
    if (dur) counted.push(w.id);
  }
  const end = (k) => r1(Math.max(0, ...Object.values(finish[k])));
  const availableDays = weekdaysBetween(today, plan.deadline);
  const members = Object.values(s.members).filter((m) => !m.removed).map((m) => {
    const mine = items.filter((w) => w.assignee === m.id && w.state !== "done").map((w) => remainingOf(s, w)).filter(Boolean);
    const sum = (k) => r1(mine.reduce((a, r) => a + r[k], 0));
    const cap = capOf(m);
    const awayInRange = [...(away[m.id] ?? [])].filter((d) => d < availableDays).length;
    return { id: m.id, name: m.name, capacity: cap, load: { low: sum("low"), high: sum("high") }, capacityDays: cap > 0 ? r1(((availableDays - awayInRange) * cap) / 5) : null, awayDays: awayInRange };
  });
  const result = { low: end("low"), high: end("high") };
  return {
    plan: plan.id, today, deadline: plan.deadline, availableDays,
    finish: result,
    overBy: { low: r1(Math.max(0, result.low - availableDays)), high: r1(Math.max(0, result.high - availableDays)) },
    members,
    items: items.map((w) => ({ id: w.id, finish: { low: r1(finish.low[w.id]), high: r1(finish.high[w.id]) }, counted: counted.includes(w.id) })),
    missing,
    capacityOverrides: capacity,
  };
}
