---
name: hitp
description: Use when you need the current state of a human-in-the-project project, or need to turn a proposal, a progress report, an incident or a completion report into a draft the leader can approve. Runs the deterministic hitp CLI under scripts/ and writes drafts under .hitp/drafts/.
---

# hitp — 記録の入口と状態の読み取り

すべて `hitp <command>`（このスキルの `scripts/hitp.mjs`。`node .claude/skills/hitp/scripts/hitp.mjs <command>` をプロジェクトルートで実行）。
下書きの形式は `references/drafts.md`。

| command | 何をするか | 実行する人 |
|---|---|---|
| `status [--json]` | 現在の状態（フェーズ、企画の骨子、進捗の 3 軸、前提、推定、WorkItem、未処理の下書き） | エージェント・リーダー |
| `show <ID> [--json]` | 下書き・記録の中身 | エージェント・リーダー |
| `check [<ID>…] [--json]` | 下書きの検査（承認と同じ検査を、記録を書かずに行う） | エージェント・リーダー |
| `verify [--head <ハッシュ>] [--json]` | 記録と成果物の改ざん検査。`--head` は書き込み系のあとにリーダーの画面に出た記録の末尾で、記録が作り直されていないかを照らし合わせる | エージェント・リーダー |
| `init <名前>` | プロジェクトを始める | リーダーだけ |
| `approve <ID> [--expect <ハッシュ>]` | 下書きを承認して記録にする。`--expect` は読んだときの中身のハッシュの先頭で、変わっていれば承認しない | リーダーだけ |
| `reject <ID> [--reason <理由>]` | 提案を却下する | リーダーだけ |
| `submit <WI> --file <種類>=<パス> … --gate id=…,by=…,at=…,result=… …` | 成果物一式とゲート通過記録を提出する | リーダーだけ |
| `checkpoint <WI> <番号> [--date …] [--note …]` | WorkItem のチェックポイントの通過を記録する | リーダーだけ |

## 決めごと

- 書き込み系（`init`・`approve`・`reject`・`submit`・`checkpoint`）はエージェントが実行しない。hook が拒否する。リーダーに `! hitp approve PRP-0004 --expect 1a2b3c4d` のように打ってもらう（起動スクリプトを PATH に入れていなければ `! node .claude/skills/hitp/scripts/hitp.mjs approve PRP-0004 --expect 1a2b3c4d`）。
- 承認のコマンドは、`hitp check`（下書きを書くと返る結果）や `hitp status` の「承認するとき」に出る形のまま、`--expect` を付けて示す。ハッシュは自分で計算しない。ハッシュは下書きと、それが参照する推定の中身から決まるので、どちらかを直すと変わる。ターンの終わりに示す前に `hitp status` で最新の形を確かめる。リーダーは示されたコマンドで、要約を読んだときの中身を承認する。
- `.hitp/records/` と `.hitp/deliverables/` は編集しない。hook が拒否する。読むのは自由。
- hitp そのもの（`.claude/skills/hitp*/`・`.claude/rules/hitp-core.md`）と hook の設定（`.claude/settings.json`・`settings.local.json`・`apm-hooks.json`）も編集しない。hook が拒否する。読むのと、hitp を動かすのは自由。直したいところがあれば、リーダーに伝える。
- 提案・記録の下書き・推定は、Write・Edit ツールで `.hitp/drafts/<ID>.json` に書く（形式は `references/drafts.md`）。書くと hook が `hitp check` の結果を返す。問題がなくなるまで直す。Bash（`cat >`・`python3`・`node`・`cp`・`mv`・`sed -i` など）では書かない。検査結果が返らず、`.hitp` の中への `cd` を含むコマンドは hook に止められる。何通りもの案を作るときも 1 つずつ Write で書き、ID を付け直すときは新しい ID で Write してから古い下書きを `rm` で消す。
- 新しく作るものは `add`、既にあるものを書き直すときは `update`。削除・廃止したものの ID は使えない。
- ID は `hitp status --json` の `nextIds` から採る。
- 提案は `rationale.refs` に根拠を 1 つ以上持つ。リーダーの発言を根拠にするときは `{ "quote": "…" }` で引用する。`quote` はリーダーの発言だけに使う。成果物の中身（報告の数字など）は、成果物の ID（`DLV-…`）で参照する。`quote` に入れると、記録にはリーダーが言ったこととして残る。
- 推定は導出（`derivation`）と入力（`inputs`）を持つ。
- 下書きを書いたら、リーダーに中身の要約と、承認するときのコマンドを示す。
- 出力は要約せず、必要な部分をそのまま引用する。
