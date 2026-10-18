---
name: hitp-planning
description: Use when the human-in-the-project phase is 計画 (planning) — the leader talks about deadlines, people, availability or abilities, or asks for a schedule or staffing plan. Drafts members, effort estimates, the plan, quality goals and gates, reads the deterministic hitp forecast to check feasibility, and proposes 2-3 numbered alternatives when it does not fit, without fixing deadlines or people on its own or judging people.
---

# hitp-planning — 無理の無い計画にする

企画を実現する計画を、リーダーの期限感・人員・能力の想定を聞きながら作り、無理がないかを確かめ、無理があれば修正案を出す。
使うのは `hitp status` のフェーズが「計画」のとき。下書きの形式と `hitp` の使い方は hitp スキル（`references/drafts.md`）に従う。下書きは Write・Edit ツールで書く（Bash では書かない）。
設計の背景はリポジトリの `docs/PHASE-PLANNING.md`。

## 流れ

1. **聞く。** 期限感、人員、各人の稼働と能力の想定を聞く。1 回に 3 問まで、1 つの問いで聞くことは 1 つ。
2. **分ける。** 期限感を制約か仮定に分けて前提の提案にする。メンバーの提案（`members`）を書き、週の稼働日を `capacity` に入れる。
3. **分ける（作業）。** 企画の目的を WorkItem に分ける。企画から引き継いだ未検証の仮定のうち効き目の大きいものは、確かめる探索型の WorkItem にし、その仮定に依存する WorkItem の前に置く（`dependsOn`）。
4. **見積もる。** WorkItem ごとに工数見積（`method: "effort"`、単位「人日」）を書く。能力の想定は導出の係数にし、リーダーの言葉か仮置きを入力に残す。承認待ち・納品待ちなど、担当が手を動かさない日数は工数に足さず、WorkItem の `waitDays`（営業日）に書く（例: 部長の承認に 1 週間かかるなら、企画書の WorkItem に `"waitDays": 5`）。
   数日より長い WorkItem には、チェックポイント（`checkpoints`）を 2〜4 個置く。それぞれ、リーダーが「ここまで来た」と言いやすい区切りの名前と、通過したあとに残る工数（人日）を書く。推進では、リーダーが `! hitp checkpoint <WI> <番号>` の 1 行で通過を記録し、その残りが見通しに入る。
5. **確かめる。** 計画の下書きを書くと、hook が `hitp check` の結果として「承認したときの見通し」を返す。完了見込みと期限まで、人ごとの負荷を読む。メンバーや前提の提案が承認待ちでも、計画が参照していれば、それらを承認したとして見通しが出る（その旨が出る）。承認を待たずに、修正案まで出す。
6. **直す。** 見通しが期限を超えるなら、修正案を 2〜3 個出す。案ごとの数字は `hitp` に出させる（期限・範囲・順序を変える案は計画の下書きを並べて `hitp check`、稼働を変える案は `hitp show <計画の下書き> --capacity MEM-0002=3`）。
7. **ゲートを付ける。** 成果物を生む WorkItem ごとに、品質目標とゲートの提案（`quality`）を出すか、ゲートを付けないことをリーダーに確かめる。
8. **引き継ぐ。** 下の「推進に進む前の確認」を埋め、それを本文にして推進への遷移の提案（`phase`）を出す。

ターンの終わりには、書いた下書きの要約、見通しの数字（`hitp` の出力をそのまま）、承認するときのコマンド（`hitp status` に出る `! hitp approve PRP-0008 --expect …` の形のまま）、聞きたいこと（3 問まで）を示す。

## 規則

- **P1 期限の日付と稼働の数字は、リーダーの発言から取る。** 「年度内くらい」のような期限感なら、日付を選ばずに仮定の前提にして、日付を聞く。
- **P2 無理がないかは、`hitp` の見通しの数字で示す。** 暗算しない。「無理です」と言い切らず、「上限で期限を 18 営業日超えます」と書く。人ごとの負荷が収まっていても、依存の鎖が期限を超えることがある。
- **P3 修正案は 2〜3 個。** 軸は期限・範囲・稼働・順序。案ごとに見通しの数字を付け、どれを選ぶかはリーダーに任せる。
- **P4 制約に反する案は黙って出さない。** 増やせない人員を増やす案などは、出すなら制約を変える前提の提案として明示する。
- **P5 人を評価しない。** 「田中さんでは厳しい」と書かない。能力の想定はリーダーの言葉と推定の係数（「新人の係数 1.5〜2〈仮置き〉」）で扱う。
- **P6 仮定に依存する WorkItem の前に、その仮定を確かめる探索型を置く。**
- **P7 成果物を生む WorkItem ごとに、ゲートを提案するか、付けないことをリーダーに確かめる。** 黙ってゲート無しにしない。

## 修正案の出し方

- **修正案を何通り作るときも、下書きは 1 つずつ Write で書く。** 初版を元にするときは、初版を Read で読み、新しい ID で Write する。`python3`・`node`・`cp`・`mv`・`sed -i` などのスクリプトでまとめて作らない。スクリプトで書くと `hitp check` の結果が返らず、ID の使い回しや形式の誤りに気づけない。案が 3 つなら Write も 3 回で、そのたびに返る見通しの数字を表に使う。
- ID を付け直すとき（使えない ID で書いてしまった、など）は、新しい ID で Write し直してから、古い下書きを `rm .hitp/drafts/<古い ID>.json` で消す。`mv` で付け直さない（中の `id` が古いまま残る）。
- 計画を置き換える案は、計画の下書きを案ごとに書く。どれも `replaces` は今の計画（最初の計画なら `null`）にする。同じ計画を置き換える案どうしは、同じ WorkItem の ID を使ってよい。1 つが承認されると、ほかは `replaces` が合わなくなって承認できなくなるので、リーダーに却下してもらう。
- 稼働を変える案は、メンバーの提案（`update`）と組にする。束ねる仕組みは無いので、本文に「案 B は PRP-0012 と PRP-0013 を両方承認する」と書く。
- 案を比べる表は、`hitp` の出力の数字で作る（下の例の計画を、2026-11-02 から数えた場合）:

| 案 | 完了見込み | 期限まで | 下書き |
|---|---|---|---|
| 初版 | 44〜83 営業日 | 65 営業日（上限で 18 営業日超える） | PRP-0008 |
| 案 A: 期限を 2/26 に | 44〜83 営業日 | 85 営業日（上限まで収まる） | PRP-0009 |

## 下書きの例

メンバー（稼働はリーダーの言葉から）:

```json
{
  "id": "PRP-0006", "kind": "members", "title": "メンバー",
  "rationale": { "refs": [{ "quote": "佐藤さんは業務に詳しくて専任。鈴木さんは OCR を触ったことがあるけど兼務で週 2 日。田中さんは新人で専任、プログラムは書ける" }] },
  "payload": { "add": [
    { "id": "MEM-0001", "name": "佐藤", "role": "業務担当", "ability": "受注業務に詳しい", "availability": "専任", "capacity": 5 },
    { "id": "MEM-0002", "name": "鈴木", "role": "技術担当", "ability": "OCR を触ったことがある", "availability": "兼務で週 2 日", "capacity": 2 },
    { "id": "MEM-0003", "name": "田中", "role": "実装担当", "ability": "新人。プログラムは書ける", "availability": "専任", "capacity": 5 }
  ] }
}
```

期限（リーダーの言葉で制約になったもの）:

```json
{
  "id": "PRP-0007", "kind": "premises", "title": "前提: 期限",
  "rationale": { "refs": [{ "quote": "期限は 1 月末にしたい。年度の予算の締めに間に合わせたい" }] },
  "payload": { "add": [{ "id": "PRM-0004", "type": "constraint", "statement": "2027-01-29 までに試行運用を終える（予算の締め）" }] }
}
```

工数見積（能力の想定は係数にして、出どころを残す）:

```json
{
  "id": "EST-0002", "kind": "estimate", "subject": "OCR 連携の実装の工数", "method": "effort",
  "value": { "low": 24, "high": 48, "unit": "人日" },
  "derivation": "経験者なら 16〜24 人日 × 新人の係数 1.5〜2",
  "inputs": [{ "quote": "田中さんは新人で専任、プログラムは書ける" }, { "assume": "経験者なら 16〜24 人日" }, { "assume": "新人の係数は 1.5〜2" }]
}
```

計画（探索型を、それに依存する WorkItem の前に置く。長い WorkItem にはチェックポイントを置く）:

```json
{
  "id": "PRP-0008", "kind": "plan", "title": "初版の計画",
  "rationale": { "refs": ["PRM-0004", "PRM-0003", "EST-0002"] },
  "payload": {
    "id": "PLAN-0001", "replaces": null, "deadline": "2027-01-29",
    "workItems": [
      { "id": "WI-0001", "title": "読み取り率の検証", "type": "explore", "assignee": "MEM-0002", "estimate": "EST-0001",
        "question": "自動で読める割合は 50% 以上か", "tests": ["PRM-0003"], "deliverables": ["検証報告"],
        "checkpoints": [
          { "title": "サンプル 200 枚を集める", "remaining": { "low": 3, "high": 6 } },
          { "title": "200 枚を読み取る", "remaining": { "low": 1, "high": 2 } },
          { "title": "検証報告を書く", "remaining": { "low": 0, "high": 0 } }
        ] },
      { "id": "WI-0002", "title": "OCR 連携の実装", "type": "execute", "assignee": "MEM-0003", "estimate": "EST-0002", "dependsOn": ["WI-0001"], "deliverables": ["連携プログラム"] },
      { "id": "WI-0003", "title": "試行運用", "type": "execute", "assignee": "MEM-0001", "estimate": "EST-0003", "dependsOn": ["WI-0002"], "deliverables": ["試行報告"] }
    ]
  }
}
```

修正案（同じ `replaces` で、期限だけを変える）:

```json
{
  "id": "PRP-0009", "kind": "plan", "title": "案 A: 期限を 2 月末に",
  "body": "初版は上限で期限を超えます（hitp check PRP-0008 の見通し）。期限を 2027-02-26 にすると、上限まで収まります。",
  "rationale": { "refs": ["EST-0002", { "quote": "期限は 1 月末にしたい" }] },
  "payload": {
    "id": "PLAN-0001", "replaces": null, "deadline": "2027-02-26",
    "workItems": [
      { "id": "WI-0001", "title": "読み取り率の検証", "type": "explore", "assignee": "MEM-0002", "estimate": "EST-0001",
        "question": "自動で読める割合は 50% 以上か", "tests": ["PRM-0003"], "deliverables": ["検証報告"],
        "checkpoints": [
          { "title": "サンプル 200 枚を集める", "remaining": { "low": 3, "high": 6 } },
          { "title": "200 枚を読み取る", "remaining": { "low": 1, "high": 2 } },
          { "title": "検証報告を書く", "remaining": { "low": 0, "high": 0 } }
        ] },
      { "id": "WI-0002", "title": "OCR 連携の実装", "type": "execute", "assignee": "MEM-0003", "estimate": "EST-0002", "dependsOn": ["WI-0001"], "deliverables": ["連携プログラム"] },
      { "id": "WI-0003", "title": "試行運用", "type": "execute", "assignee": "MEM-0001", "estimate": "EST-0003", "dependsOn": ["WI-0002"], "deliverables": ["試行報告"] }
    ]
  }
}
```

品質目標とゲート（ゲートを付けない成果物は、遷移の提案の本文に書く）:

```json
{
  "id": "PRP-0010", "kind": "quality", "title": "品質目標とゲート",
  "rationale": { "refs": ["WI-0001", "WI-0002", { "quote": "検証の結果は課内で共有したい" }] },
  "payload": {
    "goals": { "add": [{ "id": "QG-0001", "target": "WI-0001", "type": "quantitative", "statement": "検証に使う注文書は 200 枚以上（FAX と PDF の両方を含む）" }] },
    "gates": { "add": [
      { "id": "GATE-0001", "workItem": "WI-0001", "type": "presentation-feedback", "description": "課内で発表してフィードバックを受ける" },
      { "id": "GATE-0002", "workItem": "WI-0002", "type": "other", "description": "鈴木さんのコードレビュー" }
    ] }
  }
}
```

推進への遷移（本文に確認の表を入れる）:

```json
{
  "id": "PRP-0011", "kind": "phase", "title": "推進フェーズへ進む",
  "body": "| 確認 | 状態 |\n|---|---|\n| 計画 | PLAN-0001 を承認済み（期限 2027-02-26） |\n| 担当と工数 | WI-0001〜0003 のすべてにある |\n| 見通し | 44〜83 営業日／期限まで 85 営業日（上限まで収まる） |\n| ゲート | WI-0001・WI-0002 に付いている。WI-0003 の試行報告はゲートを付けない（リーダーに確認済み） |\n| 探索型 | WI-0001 が PRM-0003 を確かめ、WI-0002 はそのあと |",
  "rationale": { "refs": ["PLAN-0001", "GATE-0001", "GATE-0002"] },
  "payload": { "to": "executing" }
}
```

## 推進に進む前の確認

遷移を提案するときに埋める。`hitp` は遷移を止めないので、足りないものがあれば、その旨を書いたうえで提案するか、先に足りないものを提案する。

| 確認 | どこで分かるか |
|---|---|
| 計画が承認されている | `hitp status` の計画 |
| すべての WorkItem に担当と工数の推定がある | `hitp status` の WorkItem と見通しの「見通しに入っていないもの」 |
| 見通しが期限に収まる。収まらないなら、修正案への回答が記録にある | `hitp status` の計画の見通し、決定の記録 |
| 成果物を生む WorkItem に、ゲートが付いているか、付けないことが本文に書いてある | `hitp status` の WorkItem |
| 仮定に依存する WorkItem の前に、それを確かめる探索型の WorkItem がある | `hitp status` の WorkItem |
