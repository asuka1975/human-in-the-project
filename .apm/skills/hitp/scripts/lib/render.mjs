// 人が読む表示。--json のときは使わない。
import { label } from "./labels.mjs";

const lines = (...xs) => xs.flat().filter((x) => x !== null && x !== undefined).join("\n");

const range = (v) => (v.low === v.high ? `${Math.round(v.low)}` : `${Math.round(v.low)}〜${Math.round(v.high)}`);
const num = (x) => String(Math.round(x * 10) / 10);

/** WorkItem の行の続き: チェックポイント、残り、最後の報告。 */
function workItemProgress(x) {
  const parts = [];
  if (x.checkpoints.total) parts.push(`チェックポイント ${x.checkpoints.passed}/${x.checkpoints.total} 通過${x.checkpoints.next ? `（次: ${x.checkpoints.next}）` : ""}`);
  if (x.remaining) parts.push(`残り ${range(x.remaining)} 人日（${x.remaining.report}）`);
  if (x.state === "doing") parts.push(x.lastReport ? `最後の報告から ${x.lastReport.businessDaysAgo} 営業日` : "報告なし");
  return parts.length ? `\n      ${parts.join("、")}` : "";
}

/** 計画の見通し（forecast.mjs）。数字だけで、無理かどうかは書かない。 */
export function renderForecast(f, indent = "  ") {
  if (!f) return null;
  const over = f.overBy.low > 0 ? `下限でも ${Math.round(f.overBy.low)} 営業日超える`
    : f.overBy.high > 0 ? `上限で ${Math.round(f.overBy.high)} 営業日超える` : "上限まで収まる";
  const overrides = Object.entries(f.capacityOverrides ?? {});
  return lines(
    `${indent}完了見込み: ${range(f.finish)} 営業日／期限 ${f.deadline} まで ${f.availableDays} 営業日（${over}${f.missing.length ? `。見通しに入っていないものを除いた数字` : ""}）`,
    f.members.length ? `${indent}人ごとの負荷: ${f.members.map((m) => `${m.id} ${m.name} ${range(m.load)} 人日／稼働 ${m.capacityDays === null ? "不明" : `${num(m.capacityDays)} 人日`}${m.awayDays ? `（不在 ${m.awayDays} 営業日を除く）` : ""}`).join("、")}` : null,
    overrides.length ? `${indent}仮に置き換えた稼働: ${overrides.map(([m, v]) => `${m} 週 ${v} 日`).join("、")}` : null,
    f.assumedDrafts?.length ? `${indent}承認待ちの ${f.assumedDrafts.join("・")} も承認したとして計算した` : null,
    f.missing.length ? `${indent}見通しに入っていないもの: ${f.missing.join("、")}` : null,
    `${indent}（${f.today} から。平日だけ数え、祝日は数えない。担当者は計画の順に 1 つずつ進める）`,
  );
}

export function renderProblems(problems) {
  return lines("受け付けませんでした:", problems.map((p) => `  - ${p}`));
}

export function renderInit(r) {
  return `プロジェクト「${r.event.data.project.name}」を始めました（${r.root}/.hitp/）。フェーズは企画です。`;
}

function renderEffects(effects = {}) {
  return [
    effects.cancelled?.length ? `  中止した WorkItem: ${effects.cancelled.join("、")}` : null,
    effects.charter ? "  企画の骨子を置き換えました" : null,
    effects.phase ? `  フェーズ: ${label("phase", effects.phase.from)} → ${label("phase", effects.phase.to)}` : null,
    effects.started ? `  ${effects.started} を進行中にしました` : null,
    effects.completed ? `  ${effects.completed} を完了にしました` : null,
    effects.constraints?.length ? `  追加・更新した制約: ${effects.constraints.join("、")}` : null,
    effects.updated?.length ? `  更新: ${effects.updated.join("、")}` : null,
    effects.removed?.length ? `  削除: ${effects.removed.join("、")}` : null,
    effects.retired?.length ? `  廃止: ${effects.retired.join("、")}` : null,
  ];
}

export function renderApprove(r) {
  const d = r.draft;
  const what = d.id.startsWith("PRP") ? label("proposalKind", d.kind) : label("recordKind", d.kind);
  const made = r.event.data.decision ?? r.event.data.record;
  return lines(
    `${d.id}（${what}: ${d.title}）を承認しました → ${made}${r.expected ? `（中身のハッシュ ${r.hash} を確かめました）` : ""}`,
    r.estimates.length ? `  記録に写し取った推定: ${r.estimates.join("、")}` : null,
    renderEffects(r.effects),
  );
}

export function renderCheckpoint(r) {
  const c = r.effects.checkpoint;
  return lines(
    `${c.workItem} のチェックポイント ${c.n}「${c.title}」の通過を記録しました → ${r.data.report}（${r.data.date}）`,
    `  残り ${range(c.remaining)} 人日（計画のチェックポイントの値）`,
    r.effects.started ? `  ${r.effects.started} を進行中にしました` : null,
  );
}

export function renderReject(r) {
  return `${r.draft.id}（${label("proposalKind", r.draft.kind)}: ${r.draft.title}）を却下しました → ${r.event.data.decision}`;
}

export function renderSubmit(r) {
  return lines(
    `${r.workItem} の提出を受け付け、完了にしました。`,
    r.deliverables.map((x) => `  ${x.id} ${x.kind}: .hitp/${x.path}`),
    r.gateRecords.map((g) => `  ${g.id} ${g.gate}: ${label("gateResult", g.result)}（${g.by}、${g.at}）`),
  );
}

export function renderCheck(r) {
  if (!r.results.length) return "下書きはありません。";
  return lines(
    r.results.map((x) => x.problems.length
      ? lines(`${x.id}（${x.title ?? "?"}）: 問題が ${x.problems.length} 件`, x.problems.map((p) => `  - ${p}`), x.forecast ? lines("  承認したときの見通し:", renderForecast(x.forecast, "    ")) : null)
      : lines(`${x.id}（${x.title ?? "?"}）: OK`, x.forecast ? lines("  承認したときの見通し:", renderForecast(x.forecast, "    ")) : null, x.expect ? `  承認するとき: ! hitp approve ${x.id} --expect ${x.expect}` : null)),
  );
}

const EVENT_LABEL = { initialized: "開始", approved: "承認", rejected: "却下", submitted: "提出", checkpointed: "チェックポイント" };

/** 書き込み系のあとに出す、記録の末尾。リーダーが控えて、あとで verify --head で照らし合わせる。 */
export function renderHead(head) {
  return `記録の末尾: ${head.seq} 番目 ${head.hash}（あとで照らし合わせるとき: ! hitp verify --head ${head.hash}）`;
}

function renderHeadCheck(h) {
  if (!h?.found) return null;
  return h.following.length
    ? lines(`控えた末尾（${h.seq} 番目 ${h.given}）は記録にあります。そのあとの記録が ${h.following.length} 件あります。リーダーが書き込んだものか確かめてください:`,
      h.following.slice(-10).map((e) => `  ${e.seq} 番目 ${EVENT_LABEL[e.type] ?? e.type}${e.target ? ` ${e.target}` : ""}（${e.at}）`),
      h.following.length > 10 ? `  （古い ${h.following.length - 10} 件は省きました。--json ですべて出ます）` : null)
    : `控えた末尾（${h.seq} 番目 ${h.given}）が、今の記録の末尾です。`;
}

export function renderVerify(r) {
  return r.ok
    ? lines(`記録 ${r.events} 件と成果物 ${r.deliverables} 件を検査しました。問題はありません。`, renderHeadCheck(r.head))
    : lines(`記録 ${r.events} 件のうち ${r.replayed} 件まで当てられました。問題:`, r.problems.map((p) => `  - ${p}`));
}

export function renderStatus(r) {
  const w = r.axes.work;
  const remaining = Object.entries(w.remaining).map(([unit, v]) => `${v.low}〜${v.high} ${unit}`).join("、") || "推定なし";
  const u = r.axes.uncertainty;
  return lines(
    r.warnings.map((w) => `警告: ${w}`),
    `プロジェクト: ${r.project.name}（フェーズ: ${label("phase", r.phase)}）`,
    r.plan ? `計画: ${r.plan.id}（期限 ${r.plan.deadline}）` : "計画: まだありません",
    "",
    "企画の骨子",
    r.charter ? [
      `  問題意識: ${r.charter.problem}`,
      `  方向性: ${r.charter.direction}`,
      r.charter.scope.in.length ? `  範囲に含む: ${r.charter.scope.in.join("・")}` : null,
      r.charter.scope.out.length ? `  範囲に含まない: ${r.charter.scope.out.join("・")}` : null,
    ].filter(Boolean) : "  まだありません",
    "",
    "進捗の 3 軸",
    `  作業進捗: 完了 ${w.done}・進行中 ${w.doing}・未着手 ${w.todo}・中止 ${w.cancelled}（残りの推定 ${remaining}）`,
    `  成果達成度: ${r.axes.outcome.length ? r.axes.outcome.map((o) => `${o.id} ${label("objectiveStatus", o.status)}`).join("、") : "目的なし"}`,
    `  不確実性の解消度: 仮定 ${u.unverified + u.supported + u.rejected} 件のうち未検証 ${u.unverified}・支持 ${u.supported}・棄却 ${u.rejected}`,
    "",
    "前提",
    r.premises.length ? r.premises.map((p) => `  ${p.id} [${label("premiseType", p.type)}${p.type === "assumption" ? `・${label("verification", p.verification)}` : ""}] ${p.statement}${p.note ? `（${p.note}）` : ""}`) : "  なし",
    "",
    "推定",
    r.estimates.length ? r.estimates.map((e) => `  ${e.id} [${label("estimateMethod", e.method)}] ${e.subject}: ${e.value.low === e.value.high ? e.value.low : `${e.value.low}〜${e.value.high}`} ${e.value.unit}`) : "  なし",
    "",
    "メンバー",
    r.members.length ? r.members.map((m) => `  ${m.id} ${m.name}${m.role ? `（${m.role}）` : ""} 週の稼働日 ${m.capacity ?? "不明"}${m.availability ? `（${m.availability}）` : ""}${m.away?.length ? `／不在 ${m.away.map((a) => `${a.from}〜${a.to}`).join("・")}` : ""}${m.ability ? `／能力の想定: ${m.ability}` : ""}`) : "  なし",
    "",
    "WorkItem",
    r.workItems.length ? r.workItems.map((x) => `  ${x.id} [${label("workItemState", x.state)}] ${x.title}（${label("workItemType", x.type)}${x.assignee ? `、担当 ${x.assignee}` : ""}${x.estimate ? `、工数 ${range(x.estimate)} ${x.estimate.unit}` : ""}${x.waitDays ? `、待ち ${num(x.waitDays)} 営業日` : ""}${x.dependsOn.length ? `、${x.dependsOn.join("・")} のあと` : ""}${x.deliverables.length ? `、成果物 ${x.deliverables.join("・")}` : "、成果物なし"}${x.gates.length ? `、ゲート ${x.gates.join("・")}` : ""}）${workItemProgress(x)}`) : "  なし",
    r.needsReview.length ? ["", "見直しが要るもの", ...r.needsReview.map((n) => `  ${n.workItem}: 依存先の ${n.via} が確かめた仮定 ${n.premise} は棄却されました${n.note ? `（${n.note}）` : ""}`)] : null,
    r.forecast ? ["", "計画の見通し", renderForecast(r.forecast)] : null,
    r.recentReports.length ? ["", "最近の報告", ...r.recentReports.map((x) => `  ${x.date} ${x.workItem} ${x.text}（${x.id}）`)] : null,
    r.incidents.length ? ["", "不測の事態", ...r.incidents.map((x) => `  ${x.date} ${x.text}${x.workItems.length ? `（${x.workItems.join("・")}）` : ""}（${x.id}）`)] : null,
    "",
    "未処理の下書き",
    r.drafts.length ? r.drafts.map((d) => `  ${d.id} ${d.title ?? "?"}${d.problems ? `（問題 ${d.problems} 件 — hitp check ${d.id}）` : d.expect ? `（承認するとき: ! hitp approve ${d.id} --expect ${d.expect}）` : ""}`) : "  なし",
  );
}

export function renderShow(r) {
  if (r.source === "draft") return lines(`${r.id}（下書き）`, r.error ? `  読めません: ${r.error}` : JSON.stringify(r.draft, null, 2),
    r.hash ? `中身のハッシュ: ${r.hash}${r.boundEstimates.length ? `（参照している推定 ${r.boundEstimates.join("・")} を含む）` : ""}。承認するとき: ! hitp approve ${r.id} --expect ${r.hash}（読んだあとに中身が変わっていれば止まる）` : null,
    r.forecast ? lines("承認したときの見通し:", renderForecast(r.forecast)) : null,
    r.forecastProblems?.length ? lines("見通しは出せません（承認できない下書きです）:", r.forecastProblems.map((p) => `  - ${p}`)) : null);
  const extra = ["gates", "reports", "deliverables", "gateRecords"].filter((k) => r[k]?.length).map((k) => lines(`${k}:`, JSON.stringify(r[k], null, 2)));
  return lines(`${r.id}（記録）`, JSON.stringify(r.record, null, 2), extra, r.forecast ? lines("見通し:", renderForecast(r.forecast)) : null);
}
