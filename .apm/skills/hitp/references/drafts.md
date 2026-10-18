# 下書きの形式

`.hitp/drafts/<ID>.json` に書く下書きの形式。`hitp check <ID>` が同じ規則で検査する。
（このファイルはリポジトリの `docs/STORAGE.md` の「値の表記」「下書きの形式」と同じ内容。）

## 値の表記

JSON の中の列挙値は英語の符号で書き、表示では日本語にする。

| 項目 | 符号 → 表示 |
|---|---|
| フェーズ | `ideation` 企画、`planning` 計画、`executing` 推進、`closed` 終了 |
| WorkItem の種類 | `execute` 実行、`explore` 探索 |
| WorkItem の状態 | `todo` 未着手、`doing` 進行中、`done` 完了、`cancelled` 中止 |
| 前提の種類 | `constraint` 制約、`assumption` 仮定 |
| 仮定の検証状態 | `unverified` 未検証、`supported` 支持、`rejected` 棄却 |
| 目的の達成状況 | `unmet` 未達、`partial` 一部達成、`met` 達成 |
| 品質目標の種類 | `quantitative` 定量、`qualitative` 定性 |
| ゲートの種類 | `supervisor-approval` 上長承認、`presentation-feedback` 発表とフィードバック、`adversarial-review` 敵対的レビュー、`other` その他 |
| 推定の方法 | `fermi` フェルミ推定、`scale` 規模推定、`effort` 工数見積 |
| ゲートの結果 | `pass` 通過、`fail` 不通過 |

## 下書きの形式

すべての下書きに共通の項目。

```json
{
  "id": "PRP-0004",
  "kind": "plan",
  "title": "初版の計画",
  "body": "人が読む説明（Markdown）",
  "rationale": {
    "text": "期限 3 か月・3 名の前提で工数を見積もった",
    "refs": ["PRM-0001", "EST-0002", { "quote": "3 人で 3 か月くらいを考えている" }]
  },
  "payload": {}
}
```

- `refs` の要素は、記録にある ID、下書きにある推定の ID、またはリーダーの発言の引用（`{ "quote": "…" }`）。`quote` はリーダーの発言だけ。成果物の中身は成果物の ID（`DLV-…`）で指す。エージェントの仮置き（`{ "assume": "…" }`）は推定の入力にだけ使え、提案の根拠にはならない。
- 提案（`PRP`）は `refs` を 1 つ以上持つ（INV-7）。記録の下書き（`DRF`）は `rationale` を省略できる。

### 提案の種類

| `kind` | 承認されたときに起きること | `payload` |
|---|---|---|
| `charter` | 企画の骨子（問題意識・方向性・範囲）を置き換える。方向性の選択肢は、骨子の提案を方向性ごとに出し、1 つを承認してほかを却下する | `{ "problem", "direction", "scope": { "in": [], "out": [] } }`（`scope` は省略できる） |
| `objectives` | 目的を追加・更新する | `{ "add": [{ "id", "statement" }], "update": […] }` |
| `objective-status` | 目的の達成状況を更新する | `{ "updates": [{ "id", "status", "note" }] }` |
| `premises` | 前提を追加・更新・削除する | `{ "add": [{ "id", "type", "statement" }], "update": […], "remove": [id] }` |
| `assumption-status` | 仮定の検証状態を更新する | `{ "updates": [{ "id", "verification", "note" }] }` |
| `members` | メンバーを追加・更新・削除する。`capacity` は週の稼働日（0〜5 の数）で、見通しの計算に使う。`away` は不在の期間（`[{ "from", "to" }]`、日付）で、見通しはその営業日を飛ばす。`ability`・`availability` はリーダーの言葉のまま | `{ "add": [{ "id", "name", "role", "ability", "availability", "capacity", "away" }], "update": […], "remove": [id] }` |
| `plan` | 計画を置き換える | 下記 |
| `quality` | 品質目標・ゲートを追加・更新・廃止する | `{ "goals": { "add": [], "update": [], "retire": [] }, "gates": { "add": [], "update": [], "retire": [] } }` |
| `phase` | フェーズを遷移する | `{ "to": "planning" }` |
| `cancel` | WorkItem を中止する | `{ "workItems": [id] }` |
| `advice` | 状態を変えない提案（進捗確認の依頼、企画の改善など） | `{}` |

- `add` は新しい ID だけ、`update` は既にある ID だけを受け付ける（同じ ID を 2 つの下書きが別々に作ると、後から承認したほうが黙って上書きしてしまうため）。`update` は全項目を書き直す。
- 削除（`remove`）しても記録からは消さず、削除済みの印を付ける。削除・廃止したものは `update` できない。

計画の `payload`:

```json
{
  "id": "PLAN-0002",
  "replaces": "PLAN-0001",
  "deadline": "2027-01-31",
  "workItems": [
    {
      "id": "WI-0003",
      "title": "API 連携方式の検証",
      "type": "explore",
      "assignee": "MEM-0001",
      "estimate": "EST-0004",
      "waitDays": 0,
      "checkpoints": [
        { "title": "検証の環境を作る", "remaining": { "low": 3, "high": 5 } },
        { "title": "200 件を計測する", "remaining": { "low": 1, "high": 2 } }
      ],
      "dependsOn": ["WI-0001"],
      "deliverables": ["検証報告"],
      "question": "連携先 API は 1 秒以内に応答するか",
      "tests": ["PRM-0005"]
    }
  ]
}
```

- `replaces` は置き換える計画の ID（最初の計画は `null`）。省けない。承認できるのは、`replaces` が今の計画と一致するときだけ。修正案を並べて出し、1 つを承認すると、ほかの案は承認できなくなる（リーダーが却下する）。古い計画をもとにした案を、うっかり承認しないためでもある。
- `estimate` が指す推定は、工数見積（`effort`）で単位が「人日」のものに限る。見通しの計算に使うため。
- `waitDays` は待ちの営業日（承認待ち・納品待ちなど、担当が手を動かさない日数。省くと 0）。見通しでは作業のあとの待ちとして依存の鎖に足し、担当者の負荷には入れない。待ちを工数に足さない。
- `checkpoints` は WorkItem の中の区切り（省ける）。それぞれ、通過したあとに残る工数（人日）を持ち、後ろほど少なく、推定の上限を超えない。リーダーは `hitp checkpoint <WI> <番号>` で通過を記録でき、その残りが見通しに入る（`CLI.md`）。
- `deliverables` は成果物の種類の一覧（0 個以上）。空なら成果物を生まない WorkItem。
- `question`・`tests` は探索型だけが持つ。`tests` は検証する仮定（`PRM`）。
- 計画に載せるのは、完了・中止していない WorkItem すべて。完了・中止した WorkItem は凍結され、計画に載せられない（依存先としては参照できる）。
- 新しい計画に載っていない未完了の WorkItem は、承認と同時に中止になる。記録には中止した ID を残す。

品質目標とゲート:

```json
{ "id": "QG-0001", "target": "WI-0003", "type": "quantitative", "statement": "応答時間の 95 パーセンタイルが 1 秒以内" }
{ "id": "GATE-0001", "workItem": "WI-0003", "type": "supervisor-approval", "description": "部長の承認" }
```

### 記録の下書きの種類

| `kind` | 承認されたときに起きること | `payload` |
|---|---|---|
| `progress` | 進捗報告を記録する。未着手の WorkItem は進行中になる。`remaining`（残りの工数、人日の `{ "low", "high" }`）と `checkpoint`（通過したチェックポイントの番号）は省ける。残りを省いて番号を書くと、計画のチェックポイントの残りを使う。見通しは、進行中の WorkItem を最新の残りで数える | `{ "workItem", "date", "text", "remaining", "checkpoint" }` |
| `incident` | 不測の事態を記録する | `{ "date", "text", "workItems": [id] }` |
| `completion` | 完了報告を記録し、WorkItem を完了にする（成果物を生まない WorkItem だけ） | `{ "workItem", "date", "text" }` |

### 推定

```json
{
  "id": "EST-0002",
  "kind": "estimate",
  "subject": "国内の想定利用者数",
  "method": "fermi",
  "value": { "low": 20000, "high": 80000, "unit": "人" },
  "derivation": "対象業種の事業所数 4 万 × 導入率 10〜40% × 1 事業所あたり 5 人",
  "inputs": ["PRM-0002", { "quote": "中小の製造業を想定している" }, { "assume": "導入率は 10〜40%" }]
}
```

推定はエージェントの分析なので承認を要さない。導出（`derivation`）と入力（`inputs` を 1 つ以上）を持つ（INV-6）。
入力は、記録にある前提や推定の ID、下書きにある推定の ID、成果物の ID（`DLV-…`。提出された報告の数字を使うとき）、リーダーの発言の引用（`quote`）、エージェントの仮置き（`assume`）。仮置きは、リーダーが言っていない数字を推定に使うときに書く。前提の承認を待たずに推定を出せる。推定の幅をいちばん動かす仮置きは、仮定として前提に足すことを提案する（`PHASE-IDEATION.md` R5）。
提案から参照されたまま提案が承認されると、その時点の中身が記録に写し取られる。
