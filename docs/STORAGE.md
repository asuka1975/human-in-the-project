# 保存先と形式

プロジェクトの状態・記録・成果物を、リーダーの作業ディレクトリにどう置くかの設計。

## 方針

1. **置き場は作業ディレクトリの `.hitp/` 1 つ。** 1 つの `.hitp/` が 1 つのプロジェクトを表す。
2. **3 つの領域に分ける。** エージェントが書ける下書き、hitp だけが書く記録、hitp だけが書く成果物。
3. **記録は追記だけのイベントログ。** 現在の状態は保存せず、ログを先頭から畳み込んで毎回計算する。
4. **記録は自己完結させる。** 下書きを承認するとき、下書きの中身と、そこから参照される下書き（推定）を記録に写し取る。記録が下書きを指すことはない。
5. **改ざんはハッシュ連鎖で検知する。** hook による書き込みの拒否は壁ではない（後述）。保証の本体は `hitp verify` による検知。
6. **形式は JSON と JSON Lines。** 外部ライブラリなしの Node.js で読み書きでき、LLM も書き慣れている。人が読む表示は `hitp show`・`hitp status` が作る。

## 構成

```
.hitp/
├── drafts/              エージェントが書く。承認・却下されると hitp が消す
│   ├── PRP-0001.json    提案（計画案、前提、品質目標とゲート、フェーズ遷移など）
│   ├── DRF-0001.json    記録の下書き（進捗報告、不測の事態、完了報告）
│   └── EST-0001.json    推定（フェルミ推定、規模推定、工数見積）
├── records/             保護領域。hitp だけが書く
│   ├── events.jsonl     追記だけのイベントログ（正本）
│   └── HEAD             末尾の行の seq と hash（末尾の削除を検知するため）
└── deliverables/        保護領域。hitp submit だけが書く
    └── WI-0003/
        └── <成果物の種類>/<ファイル名>
```

| 領域 | 書くもの | 消すもの | 守り方 |
|---|---|---|---|
| `drafts/` | エージェント | 承認・却下時の hitp | なし |
| `records/` | hitp（リーダーが実行） | なし | hook で拒否、`hitp verify` で検知 |
| `deliverables/` | hitp submit（リーダーが実行） | なし | hook で拒否、`hitp verify` で検知（sha256） |

## ID

`<接頭辞>-<4 桁の数字>`（例: `WI-0003`）。9999 を超えたら先頭を 0 にしない（`WI-10000`）。

| 接頭辞 | 概念 | 採番するもの |
|---|---|---|
| `PRP` | 提案（Proposal）の下書き | エージェント |
| `DRF` | 記録の下書き | エージェント |
| `EST` | 推定（Estimate） | エージェント |
| `OBJ` `PRM` `MEM` `PLAN` `WI` `QG` `GATE` | 目的・前提・メンバー・計画・作業項目・品質目標・ゲート | エージェント（提案の中で） |
| `DEC` | 決定（Decision） | hitp |
| `RPT` | 進捗報告・完了報告（ProgressReport） | hitp |
| `INC` | 不測の事態（Incident） | hitp |
| `DLV` | 成果物（Deliverable） | hitp |
| `GR` | ゲート通過記録（GateRecord） | hitp |

エージェントが採番した ID は、既存の記録・ほかの下書きと重なってはいけない。`hitp check` が検査し（未承認の下書きどうしで同じ ID を新しく作っていないかも見る）、`hitp approve` は重なりがあれば拒否する。例外は、同じ計画を置き換える計画の下書きどうし（`replaces` が同じもの）で、同じ ID を作ってよい。承認できるのは 1 つだけなので（後述）。
削除・廃止したものの ID も使われたままとして扱い、再発行しない。

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

## 記録の形式

`events.jsonl` の 1 行が 1 イベント。

```json
{"seq":3,"at":"2026-10-13T01:23:45.000Z","type":"approved","actor":"leader","data":{},"prev":"<前の行の hash>","hash":"<この行の hash>"}
```

- `hash` は `prev` と、`seq`・`at`・`type`・`actor`・`data` を正規化した JSON（キーを辞書順に並べる）を連結した文字列の sha256。最初の行の `prev` は空文字。
- `actor` は常に `leader`。

| `type` | コマンド | `data` |
|---|---|---|
| `initialized` | `hitp init` | `{ "project": { "name" } }` |
| `approved` | `hitp approve` | `{ "draft", "draftSha256", "estimates": [], "decision" or "record", "effects" }` |
| `rejected` | `hitp reject` | `{ "draft", "draftSha256", "decision", "reason" }` |
| `checkpointed` | `hitp checkpoint` | `{ "workItem", "checkpoint", "date", "note", "report", "effects" }`（進捗報告 `RPT` を 1 つ作る） |
| `submitted` | `hitp submit` | `{ "workItem", "deliverables": [{ "id", "kind", "path", "sha256", "bytes" }], "gateRecords": [{ "id", "gate", "by", "at", "result" }] }` |

- 提案（`PRP`）の承認・却下は決定（`DEC`）を作る。記録の下書き（`DRF`）の承認は進捗報告（`RPT`）か不測の事態（`INC`）を作る。
- `effects` には、承認で起きた副作用（中止になった WorkItem など）を書く。状態の計算には使わず、人が読むためだけに残す。
- 受け付けなかった提出は記録しない（INV-15）。
- 1 行書くたびに `HEAD` に末尾の `seq` と `hash` を書く。書き込み系のコマンドは、記録の末尾が `HEAD` と一致しなければ止まる（末尾を消された記録に書き足すと、消えたことが分からなくなるため）。

## 成果物

- `hitp submit` は指定されたファイルを `deliverables/<WorkItem>/<種類>/` にコピーし、sha256 を記録する。元のファイルは残す。
- 提出には、WorkItem が宣言した成果物の種類すべてが 1 つ以上ずつ要る。宣言していない種類は受け付けない。

## hook と改ざん検知

hook は 3 つのことを拒否する。

- エージェントによる `records/`・`deliverables/` への Edit・Write・MultiEdit・NotebookEdit。
- エージェントによる Bash のうち、`hitp` の書き込み系サブコマンド（`init`・`approve`・`reject`・`submit`・`checkpoint`）を呼ぶもの、または保護領域のパスを含み読み取り専用の許可リストに当たらないもの。`H="node …/hitp.mjs"; $H approve …` のように hitp を変数に入れたものは、中身に置き換えてから判定する（2026-10-18）。置き換えるのは、使う前に代入し、ほかの値を代入していない変数だけで、そうでない変数に hitp を入れたものは止める。hitp を動かすときは、サブコマンドが読み取り系（`status`・`show`・`check`・`verify`・`help`、サブコマンドなし）のときだけ通し、ほかは書き込み系とみなす（`A=approve; hitp $A …` のように変数に入れたものも。2026-10-18）。
- エージェントによる hitp そのもの（`.claude/skills/hitp*/`・`.claude/rules/hitp-core.md`）と、hook を登録している設定（`.claude/settings.json`・`.claude/settings.local.json`・`.claude/apm-hooks.json`）への書き込み（2026-10-18）。Edit・Write などはパスで止める。Bash は記録と同じく、これらのパス（`.claude`・`.claude/skills` そのものや、その下のグロブを含む）に触れうるコマンドを、全体が読み取りのときだけ通す。hitp を動かすこと（`node .claude/skills/hitp/scripts/hitp.mjs status`）は触れたうちに入れない。

記録・成果物や hitp そのものに触れうる Bash に、hook が読み切れない書き方があれば、中身を見ずに止める（2026-10-18）。読み切れない書き方は、`$` による変数の展開とコマンド置換（`$(…)`・`${…}`・`$'…'` など）、バッククォート、`#` のコメント、行末の `\` による継ぎ足し。hook の解析とシェルの読み方がずれうるためで、二重引用符の中の `$(…)`、コメントの後ろの行、`H=rm; $H …; H=hitp` が読み取りとして通っていた（Codex と Gemini のレビュー）。シングルクォートの中の `$` と、エスケープしたバッククォートは文字なので数えない。`for` の変数だけは、語の並びの値を 1 つずつ当てはめて判定する（ほかの読み切れない書き方が無く、代入し直さず、コマンドの位置に来ず、値に空白が無いもの。2026-10-14 に緩めた読むだけのループを残すため。値に `-i` などを入れて読むコマンドを書くコマンドに変えたものは、当てはめると止まる）。`while read` の変数は、値がファイルの中身から来るので止める。git の `--output` は書き出しとみなす。`sed` のスクリプトは番地とコマンドに分けて読み、`w`・`W`・`e` と、`s` の `w`・`e` のフラグを書き込みとみなす（`1w.hitp/…` のように空白が無くても。読めない形も書き込みとみなす）。

hook の判定を受け持つ `hook.mjs` が見つからないときや、落ちたとき（`lib/guard.mjs` が消されたときなど）は、hook を登録しているコマンド（`.apm/hooks/hitp.json`）が、エージェントの Edit・Write・Bash をすべて止める（2026-10-18）。守りが黙って消えるのではなく、エージェントが動けなくなるので気づける。`hook.mjs` は、プロジェクトから親へさかのぼって探し（`dirname` が同じ値を返したら終える）、無ければホームの `.claude/`（`apm install -g` で入れたもの）を見る。下書きの検査を返す PostToolUse も同じに探し（2026-10-18 からホームも見る）、見つからなければ何もしない。`apm uninstall` は hook の設定も消す（apm 0.29.0 で確かめた）ので、止まり続けるのは、hitp のファイルだけを手で消して設定が残ったときに限る。

ただし Bash の判定は経験則でしかない。どのインタプリタからでもファイルは書けるため、すべてを止めることはできない。パスそのものを変数・ブレース展開（`.hit{p,}`）・別のファイルに書いたスクリプトで組み立てたものは、触れたと見分けられないので、読み切れない書き方があっても止まらない。
保証の本体は `hitp verify` で、次を検査する。

- ハッシュ連鎖が切れていないこと（行の書き換え・削除・挿入の検知）。
- 記録の末尾が `HEAD` と一致すること（末尾の行の削除の検知）。
- すべての行がイベントの形式に合い、先頭から畳み込んで不変条件に反しないこと。
- `deliverables/` のファイルが、記録した sha256 と一致すること。記録にないファイルが無いこと。

連鎖全体を作り直し、`HEAD` も合わせて書き換えられると、ここまでの検査では検知できない（ハッシュの計算は誰にでもできる）。そこで、書き込み系は受け付けたら記録の末尾（何番目と、ハッシュの先頭 12 文字）をリーダーの画面に出す。リーダーが控えた末尾を `hitp verify --head <ハッシュ>` に渡すと、それが壊れていない連鎖の中にあるかを確かめ、そのあとの記録を並べる（2026-10-15）。リーダーの画面に出たものは、エージェントには書き換えられない。控えなかった区間は守れない。また、検査は `hitp` のスクリプトそのものが書き換えられていないことを前提にしている。2026-10-18 から hook は hitp そのものへの書き込みも止めるが、止めるだけで、書き換えられたことを検知する仕組みは無い。パスを変数で組み立てるなどして Bash の判定をすり抜けた書き換えは、見つからない。`hook.mjs` が消されたり落ちたりしたときは、hook がエージェントの Edit・Write・Bash をすべて止める（上）が、書き換えられて動き続ける `hook.mjs` は見分けられない。`apm_modules/`・`apm.yml`・`apm.lock.yaml`（次に入れ直すときの中身）は守っていない。

## 環境変数

| 変数 | 内容 |
|---|---|
| `HITP_PROJECT_DIR` | プロジェクトのルート。無ければ現在のディレクトリから `.hitp/` を持つ祖先を探す |
| `HITP_NOW` | 現在時刻を固定する（ISO 8601）。テストと再実行（Replay）のため |

## 設計の判断

代案と比べて選んだもの。

1. **記録を追記だけのイベントログにし、状態は毎回計算する。** 代案だったのは、概念ごとのファイルを書き換える方式。
2. **形式を JSON・JSON Lines にする。** 代案だったのは、YAML や Markdown。
3. **追加（`add`）と更新（`update`）を分ける。** 削除は印を残すだけで、ID は再発行しない。記録の末尾を `records/HEAD` で押さえる。
4. **下書きを提案（`PRP`）・記録の下書き（`DRF`）・推定（`EST`）に分ける。** 推定は承認を要さない。
5. **提出には、宣言した成果物の種類すべてを要求する。** 代案だったのは、宣言と照合しない方式。
6. **新しい計画に載らない未完了の WorkItem は、承認と同時に中止にする。** 代案だったのは、先に `cancel` の提案を承認させる方式。
7. **1 つの `.hitp/` が 1 つのプロジェクト。** 複数のプロジェクトを持つなら、作業ディレクトリを分ける。
8. **成果物はコピーして保存する。** 元のファイルは残す。
9. **承認・却下された下書きは消す。** 中身は記録に写し取ってある。
10. **`.hitp/` を git に入れるかはリーダーに任せる。** 大きな成果物があると重くなる。
