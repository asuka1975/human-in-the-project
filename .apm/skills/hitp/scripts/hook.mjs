#!/usr/bin/env node
// hook — Claude Code のライフサイクル hook。stdin の JSON を読み、判定を JSON で返す。
//   hook pre-guard   PreToolUse(Edit|Write|MultiEdit|NotebookEdit|Bash): 保護領域への書き込みと、hitp の書き込み系コマンドを拒否する（INV-1）
//   hook post-edit   PostToolUse(Edit|Write|MultiEdit): .hitp/drafts/ の下書きを書いたら、hitp check の結果を文脈として返す
// リーダーが ! で打つコマンドには PreToolUse がかからない（Claude Code 2.1.296 で実験して確認した）ので、拒否されるのはエージェントだけ。
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { guardEdit, guardBash } from "./lib/guard.mjs";

const mode = process.argv[2];
let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { payload = {}; }
const out = (obj) => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
const allow = () => process.exit(0);
const input = payload.tool_input ?? {};
const cwd = payload.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (mode === "pre-guard") {
  const reason = payload.tool_name === "Bash"
    ? guardBash(input.command)
    : guardEdit(input.file_path ?? input.notebook_path, cwd);
  if (!reason) allow();
  out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
}

if (mode === "post-edit") {
  const file = typeof input.file_path === "string" ? resolve(cwd, input.file_path) : "";
  const m = new RegExp(`^(.*)${sep}\\.hitp${sep}drafts${sep}((?:PRP|DRF|EST)-\\d{4,})\\.json$`).exec(file);
  if (!m) allow();
  process.env.HITP_PROJECT_DIR = m[1];
  const { check } = await import("./lib/commands.mjs");
  const { renderCheck, renderProblems } = await import("./lib/render.mjs");
  let text;
  try { text = renderCheck(check([m[2]])); } catch (e) {
    if (!Array.isArray(e.problems)) throw e;
    text = renderProblems(e.problems);
  }
  out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `hitp check ${m[2]} の結果:\n${text}` } });
}

allow();
