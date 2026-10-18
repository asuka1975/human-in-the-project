# human-in-the-project

人間が推進の中心となるプロジェクト管理ハーネス。Claude Code 向けの [Microsoft APM](https://github.com/microsoft/apm) パッケージ。
PMBOK 第 7 版をもとに、AI エージェントがプロジェクトの企画・計画・推進を分析と提案で支援する。意思決定と記録はプロジェクトリーダーが持つ。

> A project-management harness for Claude Code in which the human leader stays in charge. The agent drafts proposals and analysis; only the leader can turn them into records, through a deterministic CLI (`hitp`) that hooks keep out of the agent's reach. The harness never judges the quality of deliverables — it defines review gates and checks that their pass records exist. The skills and messages are written in Japanese.

## 何をするか

| フェーズ | エージェントがすること |
|---|---|
| 企画 | リーダーの問題意識と暫定的な方向性をもとに、フェルミ推定や規模の推定で企画を磨く |
| 計画 | 期限・人員・各人の能力の想定を聞き取り、`hitp` が計算する見通しで無理がないかを示す。無理があれば修正案を出す |
| 推進 | 報告と成果物の提出を受けて進捗を追い、メンバーへの進捗確認をリーダーに提案する。不測の事態や仮定の棄却があれば、計画の修正案を出す |

成果物の置き場にもなる。提出された成果物は保存され、エージェントが計画上の事実を取り出す情報源になる。

## 設計の原則

- **決めるのはリーダー。** エージェントは下書き（提案・記録の下書き・推定）を書くところまで。計画・制約・品質目標・ゲート・フェーズは、リーダーが承認して初めて変わる。
- **記録はリーダーだけが作る。** 決定・ゲート通過記録・進捗報告・不測の事態・完了報告は、リーダーが `hitp` の書き込み系コマンドで作る。エージェントがそれを呼んだり、記録や成果物を書き換えたりすることは、hook が止める。
- **成果物の良し悪しを判断しない。** ハーネスはレビュワーにならない。品質目標とレビューゲート（上長の承認、グループ内の発表、敵対的レビューなど）を提案し、提出のときに通過記録が揃っているかだけを確かめる。揃わない提出は受け付けない。
- **メンバーへ直接連絡しない。** 利用者はリーダー 1 人。進捗確認は、リーダーへの提案として出す。
- **計画の要素を分ける。** 制約・仮定・推定・決定を区別し、推定には導出（式と入力）を残す。
- **R&D の進み方を 3 つに分ける。** 作業進捗・成果達成度・不確実性の解消度は連動しない。仮説の棄却は失敗ではなく、不確実性の解消として扱う。
- **成果物は版を管理しない。** 提出は WorkItem ごとに 1 回で、提出した成果物は変わらない。改訂に当たるものは、別の WorkItem で出す。

## 必要なもの

- Claude Code（2.1.296 で確かめた）
- Node.js 22 以上（外部のライブラリは使わない）
- APM（0.29.0 で確かめた）

## 入れ方

プロジェクトの作業ディレクトリの `apm.yml` に、依存として書く。

```yaml
dependencies:
  apm:
    - asuka1975/human-in-the-project#v1.0.0
```

```
apm install
```

`.claude/` に、スキル・常時の規則・hook が入る。リーダーが `! hitp …` と短く打てるように、起動スクリプトを一度だけ PATH の通った場所にリンクする。

```
ln -s "$PWD/.claude/skills/hitp/scripts/hitp" ~/.local/bin/hitp
```

リンクしない場合は、`hitp` の代わりに `node .claude/skills/hitp/scripts/hitp.mjs` と打つ。

## 使い方

Claude Code で、プロジェクトの問題意識を話しかける。エージェントは下書きを書き、承認するときのコマンドを示す。リーダーはその中身を確かめ、`!` を付けて打つ。

```
! hitp init 受注処理の自動化
! hitp approve PRP-0001 --expect 1a2b3c4d
! hitp reject PRP-0002 --reason 範囲が広すぎる
! hitp checkpoint WI-0001 2
! hitp submit WI-0001 --file 検証報告=docs/検証報告.md --gate id=GATE-0001,by=課長,at=2026-11-19,result=pass
! hitp status
! hitp verify
```

- 書き込み系（`init`・`approve`・`reject`・`submit`・`checkpoint`）は、受け付けると記録の末尾（ハッシュの先頭）を出す。控えておくと、`hitp verify --head <ハッシュ>` で記録が作り直されていないかを確かめられる。
- 読み取り系（`status`・`show`・`check`・`verify`）は、エージェントも使う。
- コマンドの詳細は [`docs/CLI.md`](docs/CLI.md)。

エージェントを使わずに流れを見るなら、デモを動かす（一時ディレクトリで、企画から提出、改ざんの検知までを流す）。

```
bash examples/demo.sh
```

## 守りの範囲と限界

プロジェクトの状態は、作業ディレクトリの `.hitp/` に置く。エージェントが書けるのは下書き（`.hitp/drafts/`）だけ。

- hook は、エージェントの Edit・Write・Bash のうち、記録（`.hitp/records/`）・成果物（`.hitp/deliverables/`）・hitp そのもの（スキル・スクリプト・hook の設定）に書き込みうるものと、`hitp` の書き込み系の呼び出しを止める。hook の判定を受け持つスクリプトが見つからないときや落ちたときは、エージェントの Edit・Write・Bash をすべて止める。
- hook は壁ではない。パスを変数・ブレース展開・別のファイルのスクリプトで組み立てた書き込みは止められない。
- 記録と成果物の書き換えは、`hitp verify` がハッシュの連鎖と sha256 で見つける。連鎖ごと作り直されたときは、リーダーが控えた末尾と照らし合わせる（`verify --head`）。
- hitp そのものが書き換えられたことは見つけられない。`apm_modules/`・`apm.yml`・`apm.lock.yaml` は守っていない。

つまり、エージェントがうっかり記録を書き換えることは防ぐが、意図して破ろうとするエージェントに対する保証ではない。

## 文書

| 文書 | 内容 |
|---|---|
| [`docs/CLI.md`](docs/CLI.md) | `hitp` コマンドの仕様 |
| [`docs/STORAGE.md`](docs/STORAGE.md) | 保存先と形式、hook と改ざん検知 |
| [`docs/DOMAIN-MODEL.md`](docs/DOMAIN-MODEL.md) | 共通モデルと不変条件 INV-1〜15 |
| [`docs/PHASE-IDEATION.md`](docs/PHASE-IDEATION.md) | 企画フェーズの振る舞い |
| [`docs/PHASE-PLANNING.md`](docs/PHASE-PLANNING.md) | 計画フェーズの振る舞い |
| [`docs/PHASE-EXECUTING.md`](docs/PHASE-EXECUTING.md) | 推進フェーズの振る舞い |
| [`CHANGELOG.md`](CHANGELOG.md) | 変更履歴 |

## 構成

| パス | 内容 |
|---|---|
| `.apm/instructions/hitp-core.instructions.md` | エージェントへの常時の規則 |
| `.apm/skills/hitp/` | `hitp` コマンドとスキル |
| `.apm/skills/hitp-ideation/` | 企画フェーズのスキル |
| `.apm/skills/hitp-planning/` | 計画フェーズのスキル |
| `.apm/skills/hitp-executing/` | 推進フェーズのスキル |
| `.apm/hooks/hitp.json` | 保護領域を守る hook の配線 |
| `tests/` | 不変条件と hook の決定論的なテスト |
| `examples/demo.sh` | エージェントを使わないデモ |

## 開発

```
npm test
```

Node.js の組み込みのテストランナーで動く。インストールは要らない。

## ライセンス

GPL-3.0-only（[`LICENSE`](LICENSE)）。
