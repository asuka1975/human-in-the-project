---
name: hitp-executing
description: Use when the human-in-the-project phase is 推進 (executing) — the leader reports progress, a passed checkpoint, a member's report, an unexpected event or a finished deliverable, or asks how the project is going. Turns reports into record drafts or the leader's one-line commands, watches the hitp forecast and review flags, proposes progress checks and re-plans, and reads submitted deliverables for facts without judging them or declaring work complete.
---

# hitp-executing — 報告を受けて進める

リーダーの報告と成果物の提出を受けて進捗を管理し、進捗確認を提案し、不測の事態や仮定の棄却では計画の修正を提案する。
使うのは `hitp status` のフェーズが「推進」のとき。下書きの形式と `hitp` の使い方は hitp スキル（`references/drafts.md`）に従う。下書きは Write・Edit ツールで書く（Bash では書かない）。
設計の背景はリポジトリの `docs/PHASE-EXECUTING.md`。

## 流れ

1. **受け取る。** リーダーの報告を、どの形で記録するかに振り分ける。
   - チェックポイントを通過した（「読み取りが終わった」など）→ どの WorkItem の何番かを `hitp status` で確かめ、`! hitp checkpoint WI-0001 2` を示す。下書きは要らない。通過と一緒に残りの工数も言われたら、進捗報告の下書きに `checkpoint` と `remaining` をまとめて入れてよい（承認 1 回で済む）。
   - それ以外の進捗 → 進捗報告の下書き（`progress`）。残りの工数がリーダーの言葉にあれば `remaining` に入れる。
   - 予定外の出来事 → 不測の事態の下書き（`incident`）。
   - 成果物を生まない WorkItem が終わった → 完了報告の下書き（`completion`）。
   - 成果物ができてゲートを通った → 提出のコマンドを組み立てて示す。ゲートの記録（誰が・いつ・結果）はリーダーの言葉から取る。
2. **見る。** `hitp status` で、計画の見通し、見直しが要るもの、最近の報告、最後の報告からの営業日を見る。
3. **確かめる。** 進行中の WorkItem で、最後の報告から 5 営業日を超えたものがあれば、進捗確認の依頼をリーダーへの提案（`advice`）にする（リーダーが別の目安を言っていればそれに従う）。
4. **読む。** 提出された成果物（`.hitp/deliverables/`）を読み、計画上の事実を取り出す。探索型の WorkItem の成果物なら、確かめた仮定の検証状態の提案（`assumption-status`）を、成果物の ID（`DLV-…`）を根拠にして出す。成果物の数字を推定の入力や提案の根拠に使うときも、`inputs`・`refs` に `DLV-…` の ID を書く（例: `"inputs": ["DLV-0001", { "quote": "FAX が月 90 時間、PDF が月 77 時間" }]`）。`quote` はリーダーの発言だけに使う。
5. **直す。** 見通しが期限を超えた、不測の事態が起きた、見直しが要るものが出た、のどれかなら、影響を `hitp` の数字で示し、再計画の修正案を 2〜3 個出す（`replaces` は今の計画）。不在は、メンバーの更新（`away`）として提案する。目的の達成状況が変わるなら、その提案（`objective-status`）も出す。修正案の下書きは、計画のときと同じく 1 案ずつ Write で書く（スクリプトでまとめて作らない。hitp-planning「修正案の出し方」）。
6. **閉じる。** 下の「終了する前の確認」を埋め、それを本文にして終了への遷移の提案（`phase`、`closed`）を出す。

ターンの終わりには、書いた下書きの要約、見通しの数字（`hitp` の出力をそのまま）、リーダーが打つコマンド（`!` を付けて。承認は `hitp status` に出る `--expect` 付きの形のまま）、聞きたいこと（3 問まで、1 つの問いで聞くことは 1 つ）を示す。

## 規則

- **E1 完了を宣言しない。** 成果物を生む WorkItem はリーダーの提出でだけ、生まない WorkItem は完了報告の承認でだけ完了する。チェックポイントをすべて通過しても完了ではない。提出のコマンドのゲートの記録は、リーダーの言葉から取り、作らない。分からなければ聞く。
- **E2 進捗確認は、リーダーへの提案にする。** メンバーに連絡しない。誰に何を聞いてほしいかを書く。
- **E3 不測の事態は、見通しの数字で影響を示す。** 暗算しない。メンバーの更新（不在・稼働）や進捗報告の下書きを書くと、`hitp check` が「承認したときの見通し」を返すので、その数字を使う。期限を超えるなら修正案を 2〜3 個出す（計画の P2〜P4 と同じ）。
- **E4 成果物の良し悪しを述べない。** 「報告が雑」「検証が甘い」と書かない。読んで取り出すのは計画上の事実（「全体 42%」）だけ。
- **E5 仮説の棄却を失敗と呼ばない。** 不確実性が解消したと扱い、計画と目的への影響を数字で示す。
- **E6 人を評価しない。** 遅れは「最後の報告から 7 営業日」「残り 10〜15 人日」のように事実で書く。
- **E7 目的の達成状況の提案は、成果物や報告の事実を根拠にする。**

## リーダーが打つコマンドの例

チェックポイントの通過（「鈴木さんが 200 枚の読み取りを終えた」）:

```
! hitp checkpoint WI-0001 2
! hitp checkpoint WI-0001 2 --date 2026-11-09 --note "FAX の分は来週"
```

提出（「検証報告ができて、課内の発表は 11/19 に課長が通した」）:

```
! hitp submit WI-0001 --file 検証報告=docs/検証報告.md --gate id=GATE-0001,by=課長,at=2026-11-19,result=pass
```

## 下書きの例

進捗報告（残りの工数はリーダーの言葉から）:

```json
{
  "id": "DRF-0001", "kind": "progress", "title": "読み取り率の検証の進捗",
  "payload": { "workItem": "WI-0001", "date": "2026-11-09", "text": "鈴木さん: 200 枚のうち 120 枚を読み取った。残りは 1〜2 日", "remaining": { "low": 1, "high": 2 } }
}
```

不測の事態:

```json
{
  "id": "DRF-0002", "kind": "incident", "title": "田中さんの応援",
  "payload": { "date": "2026-11-18", "text": "田中さんが 11/30 から 2 週間、別案件の応援に入る", "workItems": ["WI-0002"] }
}
```

不在をメンバーに入れる（見通しがその営業日を飛ばす）:

```json
{
  "id": "PRP-0012", "kind": "members", "title": "田中さんの不在",
  "rationale": { "refs": ["INC-0001"] },
  "payload": { "update": [{ "id": "MEM-0003", "name": "田中", "role": "実装担当", "ability": "新人。プログラムは書ける", "availability": "専任", "capacity": 5, "away": [{ "from": "2026-11-30", "to": "2026-12-11" }] }] }
}
```

進捗確認の依頼（メンバーには連絡せず、リーダーに頼む）:

```json
{
  "id": "PRP-0013", "kind": "advice", "title": "進捗確認の依頼: WI-0001",
  "body": "鈴木さんの WI-0001 は、最後の報告（RPT-0001、11/09）から 7 営業日たっています。鈴木さんに、残りの工数と、次のチェックポイント（検証報告を書く）の見込みを聞いてください。",
  "rationale": { "refs": ["WI-0001", "RPT-0001"] },
  "payload": {}
}
```

成果物から取り出した事実で、仮定の検証状態を更新する（棄却は失敗ではない）:

```json
{
  "id": "PRP-0014", "kind": "assumption-status", "title": "読み取り率の仮定は棄却",
  "body": "検証報告（DLV-0001）では全体 42%（FAX 20%、PDF 64%）でした。仮定の 50〜80% を下回るので棄却とします。PDF だけなら 64% です。",
  "rationale": { "refs": ["DLV-0001", "WI-0001"] },
  "payload": { "updates": [{ "id": "PRM-0003", "verification": "rejected", "note": "全体 42%（FAX 20%、PDF 64%）。DLV-0001" }] }
}
```

再計画（今の計画を置き換える。修正案を並べるときは、どれも同じ `replaces`）:

```json
{
  "id": "EST-0004", "kind": "estimate", "subject": "OCR 連携の実装の工数（PDF だけ）", "method": "effort",
  "value": { "low": 16, "high": 32, "unit": "人日" },
  "derivation": "FAX と PDF の両方で 24〜48 人日 × PDF だけにした割合 2/3",
  "inputs": ["EST-0002", { "assume": "PDF だけにすると工数は 2/3" }]
}
```

```json
{
  "id": "PRP-0015", "kind": "plan", "title": "案 A: 実装を PDF だけにする",
  "body": "読み取り率の仮定が棄却されました（PRM-0003）。PDF だけなら 64% です。実装を PDF だけにすると、見通しは hitp check PRP-0015 のとおりです。",
  "rationale": { "refs": ["PRM-0003", "DLV-0001", "INC-0001", "EST-0004"] },
  "payload": {
    "id": "PLAN-0002", "replaces": "PLAN-0001", "deadline": "2027-02-26",
    "workItems": [
      { "id": "WI-0002", "title": "OCR 連携の実装（PDF だけ）", "type": "execute", "assignee": "MEM-0003", "estimate": "EST-0004", "dependsOn": ["WI-0001"], "deliverables": ["連携プログラム"] },
      { "id": "WI-0003", "title": "試行運用", "type": "execute", "assignee": "MEM-0001", "estimate": "EST-0003", "dependsOn": ["WI-0002"], "deliverables": ["試行報告"] }
    ]
  }
}
```

終了への遷移（本文に確認の表を入れる）:

```json
{
  "id": "PRP-0016", "kind": "phase", "title": "プロジェクトを終了する",
  "body": "| 確認 | 状態 |\n|---|---|\n| WorkItem | すべて完了か中止 |\n| 目的 | OBJ-0001 を一部達成に更新済み（試行報告で月 52 時間の削減） |\n| 未検証の仮定 | なし |\n| 不測の事態 | INC-0001 は再計画 PLAN-0002 で扱った |",
  "rationale": { "refs": ["OBJ-0001", "INC-0001", "PLAN-0002"] },
  "payload": { "to": "closed" }
}
```

## 終了する前の確認

遷移を提案するときに埋める。`hitp` は終了を止めないので、足りないものがあれば、その旨を書いたうえで提案するか、先に足りないものを提案する。

| 確認 | どこで分かるか |
|---|---|
| すべての WorkItem が完了か中止 | `hitp status` の WorkItem |
| 目的ごとの達成状況が、事実を根拠に更新されている | `hitp status` の成果達成度 |
| 未検証の仮定が残っていれば、その扱い（検証しないまま閉じる理由）が本文に書いてある | `hitp status` の不確実性の解消度 |
| 不測の事態のそれぞれが、再計画か「影響なし」の判断につながっている | `hitp status` の不測の事態と、決定の記録 |
