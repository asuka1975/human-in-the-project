// 保護領域を守る hook のテスト（INV-1・INV-8 の hook 側）。入力の形は、実物の PreToolUse 入力（tests/fixtures/pretooluse-bash.json）に合わせる。
// hook は経験則なので、ここで確かめるのは「よくある書き込み方を止め、読み取りは止めない」こと。すり抜けは hitp verify が検知する（invariants.test.mjs の INV-01）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { SCRIPTS, project, base, proposal } from "./helpers.mjs";
import { guardBash, guardEdit } from "../.apm/skills/hitp/scripts/lib/guard.mjs";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/pretooluse-bash.json", import.meta.url), "utf8"));
const HOOK = join(SCRIPTS, "hook.mjs");

function runHook(mode, payload, env = {}) {
  const r = spawnSync(process.execPath, [HOOK, mode], { input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

const bash = (command, cwd = FIXTURE.cwd) => ({ ...FIXTURE, cwd, tool_input: { command, description: "test" } });
const edit = (tool, file_path, cwd = FIXTURE.cwd) => ({ ...FIXTURE, cwd, tool_name: tool, tool_input: tool === "NotebookEdit" ? { notebook_path: file_path, new_source: "" } : { file_path, content: "x" } });

// ---------------------------------------------------------------- Edit 系

test("INV-01 hook: 記録・成果物への Write・Edit・MultiEdit・NotebookEdit を拒否する", () => {
  for (const [tool, path] of [
    ["Write", ".hitp/records/events.jsonl"],
    ["Edit", "/workspace/project/.hitp/records/events.jsonl"],
    ["MultiEdit", ".hitp/deliverables/WI-0001/設計書/design.md"],
    ["NotebookEdit", ".hitp/deliverables/WI-0002/検証報告/notebook.ipynb"],
    ["Write", "sub/dir/../../.hitp/records/new.jsonl"],
  ]) {
    const out = runHook("pre-guard", edit(tool, path));
    assert.equal(out?.permissionDecision, "deny", `${tool} ${path}`);
    assert.match(out.permissionDecisionReason, /INV-1/);
  }
});

test("INV-01 hook: 下書きとふつうのファイルへの書き込みは止めない", () => {
  for (const path of [".hitp/drafts/PRP-0001.json", "docs/notes.md", "records/deliverables.md"]) {
    assert.equal(runHook("pre-guard", edit("Write", path)), null, path);
  }
});

test("INV-01 hook: シンボリックリンク経由で記録に書くのを拒否する", (t) => {
  const p = project();
  t.after(p.cleanup);
  base(p);
  symlinkSync(join(p.dir, ".hitp", "records"), join(p.dir, "innocent"));
  assert.equal(guardEdit("innocent/events.jsonl", p.dir) !== null, true);
});

// ---------------------------------------------------------------- Bash

test("INV-01 hook: エージェントによる hitp の書き込み系コマンドを拒否する", () => {
  for (const c of [
    "hitp approve PRP-0004",
    "node .claude/skills/hitp/scripts/hitp.mjs submit WI-0003 --file 検証報告=r.pdf --gate id=GATE-0001,by=部長,at=2026-11-20,result=pass",
    "cd /workspace/project && hitp reject PRP-0002 --reason 不要",
    "hitp init 偽のプロジェクト",
    "node -e \"import('./.claude/skills/hitp/scripts/lib/commands.mjs').then(m => m.approve('PRP-0001'))\"",
  ]) {
    const out = runHook("pre-guard", bash(c));
    assert.equal(out?.permissionDecision, "deny", c);
    assert.match(out.permissionDecisionReason, /リーダー/);
  }
});

test("INV-01 hook: 読み取り系の hitp は止めない", () => {
  for (const c of ["hitp status --json", "node .claude/skills/hitp/scripts/hitp.mjs check PRP-0004", "hitp show WI-0001", "hitp verify"]) {
    assert.equal(guardBash(c), null, c);
  }
});

test("INV-01 hook: 記録・成果物を書き換えるシェルコマンドを拒否する", () => {
  for (const c of [
    "echo '{}' >> .hitp/records/events.jsonl",
    "cat forged.jsonl > .hitp/records/events.jsonl",
    "sed -i 's/部長/課長/' .hitp/records/events.jsonl",
    "cp report.pdf .hitp/deliverables/WI-0001/設計書/",
    "rm -rf .hitp",
    "mv .hitp/records /tmp/x",
    "cd .hitp/records && echo x >> events.jsonl",
    "python3 -c \"open('.hitp/records/events.jsonl','a').write('x')\"",
    "git checkout -- .hitp/records/events.jsonl",
    "cat .hitp/records/events.jsonl | tee .hitp/records/copy.jsonl",
    "rm .hitp/*/events.jsonl",
    "ln -s .hitp/records innocent",
    // 読み取りの許可リストにあるが、引数で書き出したり実行したりできるもの（2026-10-14 に塞いだ）
    "sort -o .hitp/records/events.jsonl x",
    "sort x --output=.hitp/records/events.jsonl",
    "uniq x .hitp/records/events.jsonl",
    "tree -o .hitp/records/x .",
    "sed -n '1e rm -rf .hitp/records' a",
    "sed '1w .hitp/records/events.jsonl' a",
    "sed 's/a/b/gw .hitp/records/events.jsonl' a",
    "sed 's/a/b/e' .hitp/records/events.jsonl",
    "sed --expression='$w .hitp/records/x' a",
    "cat .hitp/records/events.jsonl | head; date -s 2026-01-01",
    "ls .hitp/records; date --set='2026-01-01 00:00'",
  ]) {
    assert.match(guardBash(c) ?? "", /INV-1/, c);
  }
});

test("INV-01 hook: 記録・成果物を読むシェルコマンドは止めない", () => {
  for (const c of [
    "cat .hitp/records/events.jsonl",
    "tail -n 3 .hitp/records/events.jsonl | jq .type",
    "grep -c approved .hitp/records/events.jsonl 2>/dev/null",
    "ls -R .hitp",
    "sha256sum .hitp/deliverables/WI-0001/設計書/design.md",
    "git diff -- .hitp/records/events.jsonl",
    "git log --oneline -- .hitp",
    "rm .hitp/drafts/PRP-0003.json",
    "echo agent-probe",
    "sed -n 1,20p .hitp/records/events.jsonl",
    "sed 's/new/old/g' .hitp/records/events.jsonl",
    "sort -u -k2 .hitp/records/events.jsonl",
    "uniq -c .hitp/records/events.jsonl",
    "uniq -f 1 .hitp/records/events.jsonl",
    "tree -a .hitp",
    // 2026-10-17 の L4 で止めすぎたもの（date が許可リストに無かった）
    "ls -R .hitp/records | head; cat .hitp/records/*.json 2>/dev/null | head -80; date -d 2026-10-17 +%a",
    "cat .hitp/records/events.jsonl | head; date",
  ]) {
    assert.equal(guardBash(c), null, c);
  }
});

test("INV-01 hook: 下書きの中で読むだけのループとヒアドキュメントは止めない（2026-10-14 の L4 で止めすぎたもの）", () => {
  for (const c of [
    "cd .hitp/drafts && for f in PRP-0011 PRP-0012 PRP-0013; do grep -o '\"refs\": \\[[^]]*\\]' $f.json; done",
    "cd .hitp/drafts && cat > /dev/null <<'EOF'\n{\"id\": \"PRP-0001\", \"kind\": \"plan\"}\nEOF",
    "for f in .hitp/records/events.jsonl; do tail -1 $f; done",
    "if grep -q approved .hitp/records/events.jsonl; then echo yes; fi",
    // 2026-10-18 の L5 で出た形（for の変数は、語の並びが見えているので読み切れるとみなす）
    "ls -la .hitp/records .hitp/deliverables && for f in .hitp/records/*; do echo \"== $f\"; cat \"$f\"; echo; done",
    "for i in WI-0001 WI-0002; do node .claude/skills/hitp/scripts/hitp.mjs show $i | head -50; done; grep -c . .hitp/records/events.jsonl",
  ]) {
    assert.equal(guardBash(c), null, c);
  }
});

test("INV-01 hook: ループとヒアドキュメントを使った書き込みは今までどおり拒否する", () => {
  for (const c of [
    "cd .hitp/drafts && for f in PRP-0001.json; do cp $f ../records/; done",
    "for f in .hitp/records/*; do rm $f; done",
    "cd .hitp/drafts && cat <<'EOF' > ../records/events.jsonl\n{}\nEOF",
    "bash <<'EOF'\nrm .hitp/records/events.jsonl\nEOF",
    "cat <<'EOF' | sh\ncd .hitp/records; rm events.jsonl\nEOF",
    "cd .hitp/drafts && cat <<EOF\n$(rm ../records/events.jsonl)\nEOF",
    "cd .hitp/drafts && cat > /dev/null <<'EOF'\n{}\nEOF\nrm ../records/events.jsonl",
    "cd .hitp/drafts && sed -n -f /dev/stdin ../records/events.jsonl <<'EOF'\n1e rm x\nEOF",
  ]) {
    assert.match(guardBash(c) ?? "", /INV-1/, c);
  }
});

test("INV-01 hook: hitp を変数に入れて動かしても、書き込み系は拒否し、読み取り系は止めない", () => {
  for (const c of [
    'H="node .claude/skills/hitp/scripts/hitp.mjs"; $H approve PRP-0001',
    "H=.claude/skills/hitp/scripts/hitp.mjs; node $H reject PRP-0002 --reason x",
    'H="node .claude/skills/hitp/scripts/hitp.mjs"; ${H} submit WI-0001',
  ]) assert.match(guardBash(c) ?? "", /hitp の書き込み系コマンド/, c);
  for (const c of [
    // L3・L4 でよく出る形
    'H="node .claude/skills/hitp/scripts/hitp.mjs"; $H status | sed -n \'1,40p\'; $H check PRP-0007 PRP-0008',
    'H="node .claude/skills/hitp/scripts/hitp.mjs"; for p in PRP-0007 PRP-0008; do $H show $p --capacity MEM-0002=4 | grep -A3 見通し; done',
    'H=".claude/skills/hitp/scripts/hitp.mjs"; node $H show PRP-0008 --capacity MEM-0002=3 2>&1 | head -5',
  ]) assert.equal(guardBash(c), null, c);
});

test("INV-01 hook: 触れうるコマンドに、hook が読み切れない書き方があれば止める", () => {
  for (const c of [
    // 二重引用符の中の置換（Codex のレビュー）
    "echo \"$(rm .hitp/records/events.jsonl)\"",
    "echo \"`rm .hitp/records/events.jsonl`\"",
    "cat \"$(rm .hitp/records/a.md; echo x)\"",
    "echo \"$(truncate -s 0 .claude/skills/hitp/scripts/hook.mjs)\"",
    // コメントで引用符・ヒアドキュメント・継ぎ足しをずらす（Gemini のレビュー）
    "true # '\ntruncate -s 0 .claude/skills/hitp/scripts/hook.mjs\nrm .hitp/records/events.jsonl",
    "true # <<'EOF'\ntruncate -s 0 .claude/skills/hitp/scripts/hook.mjs\necho x > .hitp/records/events.jsonl",
    "true # \\\nrm .claude/skills/hitp/scripts/hook.mjs",
    "ls .hitp/records # コメントだけでも止める",
    // 変数の順（Gemini のレビュー）
    "H=rm; $H .hitp/records/events.jsonl; echo x",
    // ANSI-C の引用でパスを書く
    "rm $'\\x2ehitp/records/events.jsonl'",
    // for の変数でも、コマンドの位置に来る・代入し直す・ほかの置換と並べるものは止める
    "for f in rm; do $f .hitp/records/events.jsonl; done",
    "for f in a; do f='-o .hitp/records/events.jsonl'; sort $f a; done",
    "for f in $(ls .hitp/records); do cat .hitp/records/$f; done",
    // while read の変数は、値がファイルの中身から来て見えない（2026-10-14 に緩めた形だが、2026-10-18 から止める）
    "while read l; do echo $l; done < .hitp/records/events.jsonl",
    // これまでの評価で通っていた読み取り（案 B で止まるようになったもの）
    "f=$(find .claude/skills/hitp -name 'CLI.md'); grep -n -A6 \"check\" $f | head -50",
    "cat \"$HOME/proj/.hitp/records/events.jsonl\"",
  ]) assert.match(guardBash(c) ?? "", /読み切れない書き方.*（INV-1）/, c);
  for (const c of [
    "H=rm; $H .claude/skills/hitp/scripts/hook.mjs; H=hitp",
    "H=rm; $H .hitp/records/events.jsonl; echo H=hitp",
    "H=hitp; $H status; H=rm; $H .hitp/records/events.jsonl",
    // サブコマンドを変数に入れる（Gemini のレビュー。通るとエージェントがリーダーとして承認できた）
    "A=approve; node .claude/skills/hitp/scripts/hitp.mjs $A PRP-0001",
    'H="node .claude/skills/hitp/scripts/hitp.mjs"; A=approve; $H $A PRP-0001',
    "hitp \"$SUB\" PRP-0001",
  ]) assert.match(guardBash(c) ?? "", /hitp の書き込み系コマンド.*変数に入れず/, c);
  for (const c of [
    "git diff HEAD --output=.claude/skills/hitp/scripts/hook.mjs",
    "git log -n 1 --output=.hitp/records/events.jsonl",
    "git show --output .hitp/records/events.jsonl HEAD",
  ]) assert.match(guardBash(c) ?? "", /（INV-1）/, c);
});

test("INV-01 hook: for の変数は値を当てはめて判定する。sed は番地とコマンドに分けて読む（2026-10-18）", () => {
  for (const c of [
    // 値にオプションを入れて、読むコマンドを書くコマンドに変える
    "for f in -i; do sed $f 's/a/b/' .hitp/records/events.jsonl; done",
    "for o in -o; do sort $o .hitp/records/events.jsonl x; done",
    "for a in -delete; do find .hitp/records $a; done",
    "for a in --output=.hitp/records/x; do git diff $a; done",
    // GNU sed は w の後ろに空白が無くても、行末までをファイル名にする
    "sed -n '1w.hitp/records/evil' .hitp/records/events.jsonl",
    "sed 's/a/b/w.hitp/records/evil' .hitp/records/events.jsonl",
    "sed -ne '1w.hitp/records/x' .hitp/records/events.jsonl",
    "sed -n -e p -e '$w.hitp/records/x' .hitp/records/events.jsonl",
    "sed '1!e rm x' .hitp/records/events.jsonl",
  ]) assert.match(guardBash(c) ?? "", /（INV-1）/, c);
  for (const c of [
    "for f in a b; do grep -c x .hitp/records/$f.json; done",
    "sed -n '/error/p' .hitp/records/events.jsonl",
    "sed -n '/^## /,/^## /p' .claude/skills/hitp/references/drafts.md",
    "sed 's/x/wow/g' .hitp/records/events.jsonl",
    "sed -ne '/approved/p' .hitp/records/events.jsonl",
    "sed '1d;$d' .hitp/records/events.jsonl",
  ]) assert.equal(guardBash(c), null, c);
});

test("INV-01 hook: 案 B でも、引用符で文字のままにした $ やバッククォートの読み取りは止めない", () => {
  for (const c of [
    "grep -n \"^| \\`\" .claude/skills/hitp/references/drafts.md",
    "sed -n '1,$p' .hitp/records/events.jsonl",
    "jq -r '.data | select(.id == \"PRP-0001\") | .title' .hitp/records/events.jsonl",
    "grep -c \"approved$\" .hitp/records/events.jsonl",
    // 触れないものは、置換・変数・コメントがあっても止めない
    "f=$(find . -name x.md); cat $f # メモ",
    "echo \"$(date)\" $HOME",
    // hitp の読み取り系のサブコマンドと、使い方
    "node .claude/skills/hitp/scripts/hitp.mjs --help",
    "node .claude/skills/hitp/scripts/hitp.mjs 2>&1 | head -40",
    "hitp help",
  ]) assert.equal(guardBash(c), null, c);
});

test("hook: 拒否の文面が、止めたことに合う次の手を案内する", () => {
  assert.match(guardEdit(".hitp/deliverables/WI-0001/設計書/design.md", "/w") ?? "", /作業ディレクトリに置き.*! hitp submit/);
  assert.match(guardBash("cd .hitp/drafts && rm -f EST-0005.json && ls") ?? "", /cd せずに .rm \.hitp\/drafts\/<ID>\.json./);
  assert.match(guardBash("rm .hitp/drafts/PRP-0007.json && ls .claude/skills/hitp/references/") ?? "", /リーダーに伝えてください/);
});

// ---------------------------------------------------------------- hitp そのもの（2026-10-18）

test("hook: hitp のスクリプト・スキル・芯の指示と、hook を登録している設定への Write・Edit を拒否する", () => {
  for (const [tool, path] of [
    ["Edit", ".claude/skills/hitp/scripts/hook.mjs"],
    ["Write", ".claude/skills/hitp/scripts/lib/guard.mjs"],
    ["Edit", "/workspace/project/.claude/skills/hitp/SKILL.md"],
    ["Write", ".claude/skills/hitp-planning/SKILL.md"],
    ["Edit", ".claude/rules/hitp-core.md"],
    ["Write", ".claude/settings.json"],
    ["Write", ".claude/settings.local.json"],
    ["Edit", ".claude/apm-hooks.json"],
  ]) {
    const out = runHook("pre-guard", edit(tool, path));
    assert.equal(out?.permissionDecision, "deny", `${tool} ${path}`);
    assert.match(out.permissionDecisionReason, /書き換えられません/);
  }
  // .claude の中でも、hitp のものでなければ止めない（自動メモリ・ほかのスキル・ほかのエージェント）
  for (const path of [".claude/agents/reviewer.md", ".claude/skills/other/SKILL.md", "/home/u/.claude/projects/p/memory/MEMORY.md", ".claude/settings.json.bak"]) {
    assert.equal(runHook("pre-guard", edit("Write", path)), null, path);
  }
});

test("hook: hitp そのものと hook の設定を書き換え・消すシェルコマンドを拒否する", () => {
  for (const c of [
    "rm .claude/skills/hitp/scripts/hook.mjs",
    "mv .claude/skills/hitp .claude/skills/hitp.bak",
    "mv .claude/skills .claude/s2",
    "rm -rf .claude",
    "rm -rf .claude/*",
    "sed -i 's/deny/allow/' .claude/skills/hitp/scripts/lib/guard.mjs",
    "echo '{\"disableAllHooks\":true}' > .claude/settings.local.json",
    "cd .claude/skills/hitp/scripts && sed -i 's/a/b/' hook.mjs",
    "cd .claude/agents && rm ../skills/hitp/scripts/hook.mjs",
    "python3 -c \"open('.claude/skills/hitp/scripts/hook.mjs','w')\"",
    "node .claude/skills/hitp/scripts/hitp.mjs status > .claude/skills/hitp/scripts/hook.mjs",
    'H="node .claude/skills/hitp/scripts/hitp.mjs"; $H status; rm .claude/skills/hitp/scripts/hook.mjs',
  ]) assert.match(guardBash(c) ?? "", /hitp のスクリプト/, c);
});

test("hook: hitp を動かすことと、hitp のスキルを読むことは止めない", () => {
  for (const c of [
    "node .claude/skills/hitp/scripts/hitp.mjs status",
    // スキルが教えている形（古い下書きを rm で消してから status を見る）
    "rm .hitp/drafts/PRP-0001.json && node .claude/skills/hitp/scripts/hitp.mjs status",
    "node .claude/skills/hitp/scripts/hitp.mjs status; ls .hitp/drafts .hitp/deliverables",
    "cat .claude/skills/hitp/SKILL.md",
    "grep -n -i -A3 \"checkpoint\" .claude/skills/hitp/references/drafts.md | head -40",
    "ls .claude/skills/hitp/references/; sed -n 1,200p .claude/skills/hitp/references/drafts.md",
    "cd .claude && ls",
    "ls .claude/agents && touch .claude/agents/x.md",
  ]) assert.equal(guardBash(c), null, c);
});

test("INV-01 hook: 実物の PreToolUse 入力（echo agent-probe）はそのまま通す", () => {
  assert.equal(runHook("pre-guard", FIXTURE), null);
});

test("INV-08 hook: メンバーへの連絡は hook では止めない（指示文だけで守る。CLI.md）", () => {
  assert.equal(guardBash("mail -s 進捗 suzuki@example.com < body.txt"), null);
});

// ---------------------------------------------------------------- hook の配線（.apm/hooks/hitp.json、2026-10-18）
// apm は配線のコマンドをそのまま .claude/settings.json に写す。ここでは、その文字列を sh と bash で動かす。

const WIRING = JSON.parse(readFileSync(new URL("../.apm/hooks/hitp.json", import.meta.url), "utf8"));
const PRE = WIRING.PreToolUse.map((e) => e.hooks[0].command);
const POST = WIRING.PostToolUse[0].hooks[0].command;

/** 一時ディレクトリに、hitp を入れたプロジェクト（scripts は本物へのリンク）と、空のホームを作る。 */
function wired(t, { install = "link" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "hitp-wiring-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const proj = join(root, "proj");
  const home = join(root, "home");
  mkdirSync(join(proj, "sub"), { recursive: true });
  mkdirSync(home);
  const scripts = join(install === "home" ? home : proj, ".claude", "skills", "hitp", "scripts");
  if (install === "link" || install === "home") {
    mkdirSync(join(scripts, ".."), { recursive: true });
    symlinkSync(SCRIPTS, scripts);
  }
  if (install === "broken") {
    mkdirSync(scripts, { recursive: true });
    writeFileSync(join(scripts, "hook.mjs"), 'import "./lib/guard.mjs";\n'); // lib/guard.mjs が消された形
  }
  return { proj, home };
}

function runWiring(shell, command, payload, { proj, home }) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: join(proj, "sub"), HOME: home };
  return spawnSync(shell, ["-c", command], { input: JSON.stringify(payload), encoding: "utf8", env });
}

test("hook の配線: hook.mjs が見つかれば、その判定をそのまま返す（親をさかのぼって探す）", (t) => {
  const w = wired(t);
  for (const shell of ["sh", "bash"]) {
    for (const command of PRE) {
      const deny = runWiring(shell, command, bash("hitp approve PRP-0004"), w);
      assert.equal(deny.status, 0, deny.stderr);
      assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, "deny");
      const allow = runWiring(shell, command, bash("ls .hitp"), w);
      assert.equal(allow.status, 0, allow.stderr);
      assert.equal(allow.stdout, "");
    }
  }
});

test("hook の配線: hook.mjs が見つからなければ、止める（14。それまでは何もせずに通していた）", (t) => {
  const w = wired(t, { install: "none" });
  for (const shell of ["sh", "bash"]) {
    for (const command of PRE) {
      const r = runWiring(shell, command, bash("ls .hitp"), w);
      assert.equal(r.status, 2, `${shell}: ${r.stderr}`);
      assert.match(r.stderr, /見つからないので、Edit・Write・Bash を止めています（INV-1）/);
    }
    // PostToolUse（下書きの検査を返すだけ）は今までどおり何もしない
    assert.equal(runWiring(shell, POST, edit("Write", ".hitp/drafts/PRP-0001.json"), w).status, 0);
  }
});

test("hook の配線: hook.mjs が落ちたら、止める（lib/guard.mjs を消されても、黙って通さない）", (t) => {
  const w = wired(t, { install: "broken" });
  for (const shell of ["sh", "bash"]) {
    const r = runWiring(shell, PRE[1], bash("ls .hitp"), w);
    assert.equal(r.status, 2, `${shell}: ${r.stderr}`);
    assert.match(r.stderr, /正しく動かなかったので、止めました（INV-1）/);
  }
});

test("hook の配線: ホームに入れた hitp（apm install -g）も使う", (t) => {
  const w = wired(t, { install: "home" });
  for (const command of PRE) {
    const r = runWiring("sh", command, bash("hitp approve PRP-0004"), w);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
  }
  // PostToolUse もホームの hitp で下書きの検査を返す（2026-10-18。それまではプロジェクトの側しか探さなかった）
  const p = project();
  t.after(p.cleanup);
  base(p);
  p.draft(proposal("PRP-0005", "advice", {}));
  const r = runWiring("sh", POST, { ...FIXTURE, hook_event_name: "PostToolUse", tool_name: "Write", cwd: p.dir, tool_input: { file_path: join(p.dir, ".hitp", "drafts", "PRP-0005.json") } }, w);
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /PRP-0005.*OK/);
});

test("hook の配線: 親をさかのぼる繰り返しは、相対パスや dirname が無いときも終わる", (t) => {
  const w = wired(t, { install: "none" });
  for (const command of [...PRE, POST]) {
    const expected = command === POST ? 0 : 2;
    const rel = spawnSync("/bin/sh", ["-c", command], { input: "{}", encoding: "utf8", timeout: 5000, cwd: w.proj, env: { ...process.env, CLAUDE_PROJECT_DIR: "sub", HOME: w.home } });
    assert.equal(rel.status, expected, `相対パス: ${rel.error?.code ?? rel.stderr}`);
    const noDirname = spawnSync("/bin/sh", ["-c", command], { input: "{}", encoding: "utf8", timeout: 5000, env: { PATH: "/nonexistent", CLAUDE_PROJECT_DIR: join(w.proj, "sub"), HOME: w.home } });
    assert.equal(noDirname.status, expected, `dirname が無い: ${noDirname.error?.code ?? noDirname.stderr}`);
  }
});

// ---------------------------------------------------------------- post-edit

test("post-edit: 下書きを書いたら hitp check の結果を文脈として返す", (t) => {
  const p = project();
  t.after(p.cleanup);
  base(p);
  p.draft(proposal("PRP-0005", "advice", {}, []));
  const bad = runHook("post-edit", { ...FIXTURE, hook_event_name: "PostToolUse", tool_name: "Write", cwd: p.dir, tool_input: { file_path: ".hitp/drafts/PRP-0005.json" } }, { HITP_NOW: "2026-10-13T00:00:00.000Z" });
  assert.match(bad.additionalContext, /hitp check PRP-0005/);
  assert.match(bad.additionalContext, /INV-7/);
  p.draft(proposal("PRP-0005", "advice", {}));
  const ok = runHook("post-edit", { ...FIXTURE, hook_event_name: "PostToolUse", tool_name: "Write", cwd: p.dir, tool_input: { file_path: join(p.dir, ".hitp", "drafts", "PRP-0005.json") } });
  assert.match(ok.additionalContext, /PRP-0005.*OK/);
});

test("post-edit: 下書き以外のファイルでは何も返さない", () => {
  assert.equal(runHook("post-edit", { ...FIXTURE, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: "docs/notes.md" } }), null);
});
