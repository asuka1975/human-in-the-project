#!/usr/bin/env bash
# hitp を 5 分で触るためのデモ。一時ディレクトリにプロジェクトを作り、
# 初期化 → 企画（骨子・前提・推定）→ 計画への遷移 → 計画 → 不足のある提出（拒否）→ 提出 → 状態 → 改ざん検査 → 改ざん → 検知 を順に流す。
# エージェントが書く下書きは、ここでは heredoc で代わりに書く。
set -u
HITP="node $(cd "$(dirname "$0")/.." && pwd)/.apm/skills/hitp/scripts/hitp.mjs"
export HITP_PROJECT_DIR=$(mktemp -d)
cd "$HITP_PROJECT_DIR"
step() { printf '\n\033[1m$ %s\033[0m\n' "$*"; }

step "hitp init 受注処理の自動化"
$HITP init 受注処理の自動化

# 企画: 骨子、推定（仮置きを使う）、前提、計画への遷移
mkdir -p .hitp/drafts
cat > .hitp/drafts/PRP-0001.json <<'EOF'
{ "id": "PRP-0001", "kind": "charter", "title": "企画の骨子",
  "rationale": { "refs": [{ "quote": "受注の手入力で月末に残業が集中している。連携先の API から注文を取り込みたい" }] },
  "payload": { "problem": "受注の手入力で、月末に残業が集中している", "direction": "連携先の API から注文を自動で取り込む",
    "scope": { "in": ["API で受けられる注文"], "out": ["FAX の注文"] } } }
EOF
cat > .hitp/drafts/EST-0002.json <<'EOF'
{ "id": "EST-0002", "kind": "estimate", "subject": "減る手入力の時間", "method": "fermi",
  "value": { "low": 60, "high": 100, "unit": "時間/月" },
  "derivation": "月 1,500 件 × 4 分 × API で受けられる割合 60〜100% ÷ 60",
  "inputs": [{ "quote": "月に 1,500 件、1 件 4 分くらい" }, { "assume": "API で受けられる割合は 60〜100%" }] }
EOF
cat > .hitp/drafts/PRP-0002.json <<'EOF'
{ "id": "PRP-0002", "kind": "premises", "title": "前提",
  "rationale": { "refs": [{ "quote": "3 か月で出したい。連携先の API は速いはず" }, "EST-0002"] },
  "payload": { "add": [
    { "id": "PRM-0001", "type": "constraint", "statement": "期限は 3 か月" },
    { "id": "PRM-0002", "type": "assumption", "statement": "連携先 API は 1 秒以内に応答する" } ] } }
EOF
cat > .hitp/drafts/PRP-0003.json <<'EOF'
{ "id": "PRP-0003", "kind": "phase", "title": "計画フェーズへ",
  "rationale": { "refs": ["EST-0002", { "quote": "3 か月で出したい" }] }, "payload": { "to": "planning" } }
EOF
step "hitp check   # エージェントが下書きを書いたあとに実行する。推定の仮置き（assume）は前提の承認を待たずに通る"
$HITP check
step "hitp approve PRP-0001 && hitp approve PRP-0002 && hitp approve PRP-0003   # リーダーが ! で打つ"
$HITP approve PRP-0001 && $HITP approve PRP-0002 && $HITP approve PRP-0003

# 計画: メンバー、推定、計画、ゲート
cat > .hitp/drafts/PRP-0004.json <<'EOF'
{ "id": "PRP-0004", "kind": "members", "title": "メンバー",
  "rationale": { "refs": [{ "quote": "佐藤さんと鈴木さんの 2 人でやる" }] },
  "payload": { "add": [{ "id": "MEM-0001", "name": "佐藤", "ability": "業務設計に強い", "capacity": 5 }, { "id": "MEM-0002", "name": "鈴木", "ability": "API 連携の経験あり", "capacity": 2 }] } }
EOF
cat > .hitp/drafts/EST-0001.json <<'EOF'
{ "id": "EST-0001", "kind": "estimate", "subject": "設計の工数", "method": "effort",
  "value": { "low": 8, "high": 12, "unit": "人日" },
  "derivation": "画面 20 枚 × 0.4〜0.6 人日（前案件の実績）", "inputs": [{ "quote": "画面は 20 枚くらい" }] }
EOF
cat > .hitp/drafts/PRP-0005.json <<'EOF'
{ "id": "PRP-0005", "kind": "plan", "title": "初版の計画",
  "rationale": { "refs": ["PRM-0001", "EST-0001"] },
  "payload": { "id": "PLAN-0001", "replaces": null, "deadline": "2027-01-31", "workItems": [
    { "id": "WI-0001", "title": "設計", "type": "execute", "assignee": "MEM-0001", "estimate": "EST-0001", "deliverables": ["設計書"] },
    { "id": "WI-0002", "title": "API の応答時間の検証", "type": "explore", "assignee": "MEM-0002",
      "question": "連携先 API は 1 秒以内に応答するか", "tests": ["PRM-0002"], "deliverables": ["検証報告"] },
    { "id": "WI-0003", "title": "キックオフ", "type": "execute" } ] } }
EOF
cat > .hitp/drafts/PRP-0006.json <<'EOF'
{ "id": "PRP-0006", "kind": "quality", "title": "設計書のゲート",
  "rationale": { "refs": ["WI-0001"] },
  "payload": { "gates": { "add": [{ "id": "GATE-0001", "workItem": "WI-0001", "type": "supervisor-approval", "description": "部長の承認" }] } } }
EOF
step "hitp approve PRP-0004 && hitp approve PRP-0005 && hitp approve PRP-0006"
$HITP approve PRP-0004 && $HITP approve PRP-0005 && $HITP approve PRP-0006

echo "# 設計書" > design.md
step "hitp submit WI-0001 --file 設計書=design.md   # ゲートの通過記録が無いので受け付けない（INV-4・INV-15）"
$HITP submit WI-0001 --file 設計書=design.md
step "hitp submit WI-0001 --file 設計書=design.md --gate id=GATE-0001,by=部長,at=2026-11-20,result=pass"
$HITP submit WI-0001 --file 設計書=design.md --gate id=GATE-0001,by=部長,at=2026-11-20,result=pass

step "hitp status"
$HITP status
step "hitp verify"
$HITP verify

step "# 記録を書き換えてみる（部長 → 課長）"
sed -i 's/部長/課長/' .hitp/records/events.jsonl
step "hitp verify"
$HITP verify

printf '\nデモのプロジェクト: %s\n' "$HITP_PROJECT_DIR"
