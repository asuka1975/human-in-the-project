// 列挙値の符号と日本語の表示（STORAGE.md「値の表記」）。
export const PHASES = ["ideation", "planning", "executing", "closed"];

export const LABELS = {
  phase: { ideation: "企画", planning: "計画", executing: "推進", closed: "終了" },
  workItemType: { execute: "実行", explore: "探索" },
  workItemState: { todo: "未着手", doing: "進行中", done: "完了", cancelled: "中止" },
  premiseType: { constraint: "制約", assumption: "仮定" },
  verification: { unverified: "未検証", supported: "支持", rejected: "棄却" },
  objectiveStatus: { unmet: "未達", partial: "一部達成", met: "達成" },
  goalType: { quantitative: "定量", qualitative: "定性" },
  gateType: {
    "supervisor-approval": "上長承認",
    "presentation-feedback": "発表とフィードバック",
    "adversarial-review": "敵対的レビュー",
    other: "その他",
  },
  estimateMethod: { fermi: "フェルミ推定", scale: "規模推定", effort: "工数見積" },
  gateResult: { pass: "通過", fail: "不通過" },
  proposalKind: {
    charter: "企画の骨子",
    objectives: "目的",
    "objective-status": "目的の達成状況",
    premises: "前提",
    "assumption-status": "仮定の検証状態",
    members: "メンバー",
    plan: "計画",
    quality: "品質目標・ゲート",
    phase: "フェーズ遷移",
    cancel: "WorkItem の中止",
    advice: "助言",
  },
  recordKind: { progress: "進捗報告", incident: "不測の事態", completion: "完了報告" },
};

export const label = (group, code) => LABELS[group]?.[code] ?? code;
export const codes = (group) => Object.keys(LABELS[group]);
export const isTerminal = (state) => state === "done" || state === "cancelled";
