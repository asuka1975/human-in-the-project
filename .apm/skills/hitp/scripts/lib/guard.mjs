// 保護領域の判定（STORAGE.md「hook と改ざん検知」）。拒否の理由を返し、許すなら null。
// Bash の判定は経験則でしかない（どのインタプリタからでもファイルは書ける）。保証の本体は hitp verify による検知。
import { existsSync, realpathSync } from "node:fs";
import { resolve, dirname, basename, join, sep, posix } from "node:path";

const PROTECTED_DIRS = ["records", "deliverables"];

/** 存在する最も深い祖先を realpath で解いてから、残りをつなぐ（シンボリックリンク経由の書き込みも捕まえるため）。 */
function realish(p) {
  let head = p;
  const tail = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) return p;
    tail.unshift(basename(head));
    head = parent;
  }
  try { return join(realpathSync(head), ...tail); } catch { return p; }
}

export function isProtectedPath(p) {
  const parts = p.split(sep);
  for (let i = 0; i < parts.length - 1; i++) if (parts[i] === ".hitp" && PROTECTED_DIRS.includes(parts[i + 1])) return true;
  return false;
}

// hitp そのもの（スクリプト・スキル・芯の指示）と、hook を登録している設定（2026-10-18）。
// ここが書き換えられると、hook も verify も当てにならない（hook.mjs が無ければ hook は何も止めない）
const PACKAGE_FILES = new Set(["settings.json", "settings.local.json", "apm-hooks.json"]);
export function isPackagePath(p) {
  const parts = p.split(sep);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] !== ".claude") continue;
    if (parts[i + 1] === "skills" && /^hitp(?:-|$)/.test(parts[i + 2] ?? "")) return true;
    if (parts[i + 1] === "rules" && parts[i + 2] === "hitp-core.md") return true;
    if (i + 2 === parts.length && PACKAGE_FILES.has(parts[i + 1])) return true;
  }
  return false;
}

const DENY_EDIT = "記録（.hitp/records/）と成果物（.hitp/deliverables/）は hitp だけが書きます（INV-1）。提案や記録の下書きは .hitp/drafts/<ID>.json に書き、リーダーに `! hitp approve <ID>` で承認してもらってください。成果物は作業ディレクトリに置き、リーダーに `! hitp submit <WI> --file <種類>=<パス> …` で提出してもらってください。";
const DENY_PACKAGE = "hitp のスクリプト・スキル・芯の指示（.claude/skills/hitp*/、.claude/rules/hitp-core.md）と、hook を登録している設定（.claude/settings.json・settings.local.json・apm-hooks.json）は書き換えられません（INV-1）。記録を守る仕組みそのものだからです。直したいところがあれば、リーダーに伝えてください（リーダーが入れ直します）。";

export function guardEdit(filePath, cwd) {
  if (typeof filePath !== "string" || !filePath) return null;
  const abs = resolve(cwd ?? process.cwd(), filePath);
  if (isProtectedPath(abs) || isProtectedPath(realish(abs))) return DENY_EDIT;
  return isPackagePath(abs) || isPackagePath(realish(abs)) ? DENY_PACKAGE : null;
}

// ---------------------------------------------------------------- Bash

const DENY_HITP = "hitp の書き込み系コマンド（init・approve・reject・submit・checkpoint）はリーダーが実行します（INV-1）。リーダーに `! hitp <command> …` と打ってもらってください。エージェントが使えるのは status・show・check・verify・help です。サブコマンドは変数に入れず、そのまま書いてください。hitp を変数に入れるときは、使う前に 1 回だけ代入し、書き換えないでください。";
const DENY_BASH = "記録（.hitp/records/）と成果物（.hitp/deliverables/）に触れうるシェルコマンド（.hitp の中への cd を含む）は、コマンド全体が読み取り（cat・grep・jq・ls・find・git diff など）で、ファイルへのリダイレクトが無いときだけ許しています（INV-1）。下書きは Bash ではなく Write・Edit ツールで .hitp/drafts/<ID>.json に書いてください（書くと hitp check の結果が返ります）。下書きを消すときは、.hitp の中へ cd せずに `rm .hitp/drafts/<ID>.json` のようにパスで指し、記録や hitp のスキルを読むコマンドとは 1 行に並べずに打ってください。";
const DENY_PACKAGE_BASH = "hitp のスクリプト・スキル・芯の指示（.claude/skills/hitp*/、.claude/rules/hitp-core.md）と、hook を登録している設定（.claude/settings*.json・apm-hooks.json）に触れうるシェルコマンド（.claude の中への cd を含む）は、コマンド全体が読み取り（cat・grep・ls・sed -n など）で、ファイルへのリダイレクトが無いときだけ許しています（INV-1）。hitp を動かすこと（`node .claude/skills/hitp/scripts/hitp.mjs status` など）は、ほかのコマンドと並べても止めません。変更が要るときは、リーダーに伝えてください（リーダーが入れ直します）。";
// 2026-10-18。展開・置換・コメント・継ぎ足しは、hook の解析とシェルの読み方がずれうる
const DENY_UNRESOLVED = "記録・成果物（.hitp/records/・.hitp/deliverables/）や hitp そのもの（.claude/skills/hitp*/ など）に触れうるシェルコマンドに、hook が読み切れない書き方（$ による変数の展開やコマンド置換、バッククォート、# のコメント、行末の \\ による継ぎ足し）が入っているので止めました（INV-1）。パスや値は変数に入れずにそのまま書き、1 つずつのコマンドに分けて打ってください。";
// エージェントが使ってよい hitp のサブコマンド（無いときは使い方を出す）。ほかは書き込み系とみなす（変数に入れたものも）
const READ_SUBS = new Set(["status", "show", "check", "verify", "help", "--help", "-h"]);
const readSub = (w) => w === undefined || READ_SUBS.has(w);

const WRITE_SUBS = new Set(["init", "approve", "reject", "submit", "checkpoint"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
const INTERPRETERS = new Set(["node", "deno", "bun"]);
const WRAPPERS = new Set(["env", "command", "time", "nice", "nohup"]);
// for・if・while などの構文の語。後ろに続くコマンドで判定する（for の行と done・fi は何も実行しない）
const KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "{"]);
const KEYWORD_ENDS = new Set(["done", "fi", "}"]);
const READ_ONLY = new Set([
  "cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg", "wc", "ls", "jq", "file", "stat", "sha256sum", "md5sum",
  "diff", "cmp", "tree", "test", "[", "sort", "uniq", "cut", "tr", "nl", "column", "echo", "printf", "true", "cd", "pwd",
  "basename", "dirname", "realpath", "readlink", "read",
]);
const GIT_READ_ONLY = new Set(["log", "diff", "status", "show", "blame", "ls-files", "rev-parse"]);
const FIND_WRITES = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]);

/**
 * シェルのコマンドを文（; && || | & 改行 括弧 バッククォートで区切る）ごとの語とリダイレクト先に分ける。
 * 引用符は外す。完全なシェルの文法ではない。
 * 区切り文字を引用符で囲んだヒアドキュメント（<<'EOF'）の中身は展開されないので、コマンドではなく data の文にする。
 * 囲んでいないもの（<<EOF）は $(…) が展開されるので、今までどおりコマンドとして分ける。
 * 戻り値の flags に、hook が読み切れない書き方（$ の展開・置換、バッククォート、# のコメント、行末の \ の継ぎ足し）を集める
 * （2026-10-18。シングルクォートとヒアドキュメントの中身は数えない）。コメントは行末まで読み飛ばす。
 */
export function tokenize(command) {
  const segments = [];
  let words = [];
  let redirects = [];
  let cur = null;
  let redirectNext = false;
  let heredocs = []; // この行で始まった、区切り文字を引用符で囲んだヒアドキュメント
  const flags = [];
  // i の $ が展開か（$名前・${名前} は変数、$( $[ ${…} は置換、$1 $@ $? などは特別な変数）。$ だけ、$/ などは文字のまま
  const dollar = (i) => {
    const n = command[i + 1] ?? "";
    const name = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)(\})?/.exec(command.slice(i));
    if (n === "{" && !(name && name[2])) flags.push({ kind: "置換" });
    else if (name) flags.push({ kind: "変数", name: name[1] });
    else if (n === "(" || n === "[") flags.push({ kind: "置換" });
    else if (/[0-9@*#?$!-]/.test(n)) flags.push({ kind: "変数" });
  };
  const endWord = () => {
    if (cur === null) return;
    if (redirectNext) redirects.push(cur); else words.push(cur);
    cur = null;
    redirectNext = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length || redirects.length) segments.push({ words, redirects });
    words = [];
    redirects = [];
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];
    if (ch === "'") {
      const j = command.indexOf("'", i + 1);
      const end = j < 0 ? command.length : j;
      cur = (cur ?? "") + command.slice(i + 1, end);
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      let buf = "";
      while (j < command.length && command[j] !== '"') {
        if (command[j] === "\\" && j + 1 < command.length) {
          if (command[j + 1] === "\n") flags.push({ kind: "継ぎ足し" }); else buf += command[j + 1];
          j += 2;
          continue;
        }
        if (command[j] === "$") dollar(j);
        else if (command[j] === "`") flags.push({ kind: "バッククォート" });
        buf += command[j++];
      }
      cur = (cur ?? "") + buf;
      i = j;
    } else if (ch === "\\" && next !== undefined) {
      if (next === "\n") flags.push({ kind: "継ぎ足し" }); else cur = (cur ?? "") + next;
      i++;
    } else if (ch === "$" && next === "'") {
      // $'…'（ANSI-C の引用）。中のエスケープをほどいて語にする（\x2e で . を書くなど、パスを隠せるので）
      flags.push({ kind: "置換" });
      let j = i + 2;
      let buf = "";
      while (j < command.length && command[j] !== "'") {
        if (command[j] === "\\" && j + 1 < command.length) {
          const rest = command.slice(j + 1);
          const hex = /^x([0-9a-fA-F]{1,2})/.exec(rest);
          const oct = /^([0-7]{1,3})/.exec(rest);
          if (hex) { buf += String.fromCharCode(parseInt(hex[1], 16)); j += 2 + hex[1].length; continue; }
          if (oct) { buf += String.fromCharCode(parseInt(oct[1], 8)); j += 1 + oct[1].length; continue; }
          buf += { n: "\n", t: "\t", r: "\r" }[command[j + 1]] ?? command[j + 1];
          j += 2;
          continue;
        }
        buf += command[j++];
      }
      cur = (cur ?? "") + buf;
      i = j;
    } else if (ch === "\n" && heredocs.length) {
      endSegment();
      // 中身を区切り文字の行まで読み飛ばし、data の文として残す（記録に触れるかの判定には使う）
      for (const h of heredocs) {
        const lines = [];
        let j = i + 1;
        for (;;) {
          const k = command.indexOf("\n", j);
          const line = command.slice(j, k < 0 ? command.length : k);
          if ((h.dash ? line.replace(/^\t+/, "") : line) === h.delim) { i = k < 0 ? command.length : k; break; }
          lines.push(line);
          if (k < 0) { i = command.length; break; }
          j = k + 1;
        }
        const body = lines.join("\n");
        segments.push({ words: tokenize(body).flatMap((s) => [...s.words, ...s.redirects]), redirects: [], data: body });
      }
      heredocs = [];
    } else if (ch === "\n" || ch === ";" || ch === "(" || ch === ")" || ch === "`") {
      if (ch === "`") flags.push({ kind: "バッククォート" });
      endSegment();
    } else if (ch === "|") {
      endSegment();
      if (next === "|") i++;
    } else if (ch === "&") {
      if (next === "&") { endSegment(); i++; } else if (next === ">") { endWord(); redirectNext = true; i += command[i + 2] === ">" ? 2 : 1; } else endSegment();
    } else if (ch === ">") {
      if (cur !== null && /^\d+$/.test(cur)) cur = null; else endWord(); // 2> の 2 は語ではない
      if (next === ">" || next === "|") i++;
      if (command[i + 1] === "&") { i++; while (/[\d-]/.test(command[i + 1] ?? "")) i++; } // 2>&1 は複製なのでファイルではない
      else redirectNext = true;
    } else if (ch === "<" && next === "<" && command[i + 2] !== "<") {
      // ヒアドキュメント。区切り文字は語にしない
      endWord();
      i += 2;
      const dash = command[i] === "-";
      if (dash) i++;
      while (command[i] === " " || command[i] === "\t") i++;
      let delim = "";
      let quoted = false;
      while (i < command.length && !/[\s;|&<>()]/.test(command[i])) {
        if (command[i] === "'" || command[i] === '"') {
          const q = command[i];
          const j = command.indexOf(q, i + 1);
          const end = j < 0 ? command.length : j;
          delim += command.slice(i + 1, end);
          quoted = true;
          i = end + 1;
        } else if (command[i] === "\\") { delim += command[i + 1] ?? ""; quoted = true; i += 2; } else delim += command[i++];
      }
      i--;
      if (quoted && delim) heredocs.push({ delim, dash });
    } else if (ch === "<") {
      endWord();
      while (command[i + 1] === "<") i++;
    } else if (ch === "#" && cur === null) {
      // 語の頭の # から行末まではコメント（シェルは読み飛ばす）
      flags.push({ kind: "コメント" });
      const k = command.indexOf("\n", i);
      i = (k < 0 ? command.length : k) - 1;
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      if (ch === "$") { dollar(i); if (next === '"') flags.push({ kind: "置換" }); }
      cur = (cur ?? "") + ch;
    }
  }
  endSegment();
  segments.flags = flags;
  return segments;
}

const base = (w) => (w ?? "").split("/").pop();
const isHitpWord = (w) => ["hitp", "hitp.mjs"].includes(base(w));

/** 先頭の環境変数の代入と、env・command などの前置きを飛ばす。 */
function stripPrefix(words) {
  const ws = [...words];
  for (;;) {
    if (ws.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0])) ws.shift();
    else if (ws.length > 1 && WRAPPERS.has(base(ws[0]))) ws.shift();
    else if (ws.length > 1 && KEYWORDS.has(ws[0])) ws.shift();
    else return ws;
  }
}

export function isProtectedWord(w) {
  if (!w.includes(".hitp")) return false;
  if (/\.hitp\/+(?:records|deliverables)(?:\/|$|[^A-Za-z0-9_-])/.test(w)) return true;
  if (/\.hitp\/+(?:records|deliverables)(?:\/|$)/.test(posix.normalize(w))) return true;
  if (/(?:^|\/)\.hitp\/?$/.test(w)) return true; // .hitp そのもの
  if (/\.hitp\/+[^/]*[*?[{]/.test(w)) return true; // .hitp/ の下のグロブ
  if (/\.hitp\/.*\.\./.test(w)) return true; // .. で抜け出す
  return false;
}

/** hitp そのものと hook の設定を指しうる語（isPackagePath の Bash 版）。.claude・skills・rules そのもの、その下のグロブ、.. で抜け出すものも数える。 */
export function isPackageWord(w) {
  if (!w.includes(".claude")) return false;
  return [w, posix.normalize(w)].some((x) => /(?:^|\/)\.claude\/*$/.test(x)
    || /\.claude\/+(?:skills|rules)\/*$/.test(x)
    || /\.claude\/+skills\/+hitp(?:-[^/]*)?(?:\/|$)/.test(x)
    || /\.claude\/+rules\/+hitp-core\.md/.test(x)
    || /\.claude\/+(?:settings(?:\.local)?|apm-hooks)\.json/.test(x)
    || /\.claude\/+(?:(?:skills|rules)\/+)?[^/]*[*?[{]/.test(x)
    || /\.claude\/.*\.\./.test(x));
}

function gitReadOnly(args) {
  if (args.some((a) => a === "--output" || a.startsWith("--output="))) return false; // git diff・log・show --output=<ファイル> は書き出す（2026-10-18）
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) i += ["-C", "-c", "--git-dir", "--work-tree"].includes(args[i]) ? 2 : 1;
  return GIT_READ_ONLY.has(args[i]);
}

function sedReadOnly(args) {
  if (args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) return false;
  if (args.some((a) => /^-[a-zA-Z]*f/.test(a) || a.startsWith("--file"))) return false; // スクリプトをファイルやヒアドキュメントから読むと中身を見られない
  // スクリプトは -e・--expression で渡したもの、無ければ最初の引数（残りはファイル）
  // （-ne のようにまとめた -e も。-l は値を取る）
  const scripts = [];
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--expression" || /^-[a-zA-Z]*e$/.test(a)) scripts.push(args[++i] ?? "");
    else if (a.startsWith("--expression=")) scripts.push(a.slice(13));
    else if (/^-[a-zA-Z]*e./.test(a)) scripts.push(a.slice(a.indexOf("e") + 1));
    else if (a === "-l" || a === "--line-length") i++;
    else if (!a.startsWith("-")) rest.push(a);
  }
  if (!scripts.length && rest.length) scripts.push(rest[0]);
  return scripts.every(sedScriptReadOnly);
}

/**
 * sed のスクリプトに、ファイルへ書く（w・W、s///w）か、コマンドを実行する（e、s///e）ものが無いか。番地とコマンドに分けて読む
 * （2026-10-18。GNU sed は w の後ろに空白が無くても、行末までをファイル名にする: 1w.hitp/records/x。正規表現では見分けられなかった）。
 * 読めない形は、書き込みとみなす。
 */
function sedScriptReadOnly(script) {
  let i = 0;
  const n = script.length;
  const skipSpace = () => { while (i < n && /[\s;]/.test(script[i])) i++; };
  const regex = (d) => { i++; while (i < n && script[i] !== d) i += script[i] === "\\" ? 2 : 1; if (i >= n) return false; i++; return true; };
  const address = () => {
    if (/\d/.test(script[i] ?? "")) { while (/[\d~]/.test(script[i] ?? "")) i++; return true; }
    if (script[i] === "$") { i++; return true; }
    if (script[i] === "/") return regex("/");
    if (script[i] === "\\") { i++; return regex(script[i]); }
    return true; // 番地なし
  };
  for (;;) {
    skipSpace();
    if (i >= n) return true;
    if (script[i] === "{" || script[i] === "}") { i++; continue; }
    if (!address()) return false;
    if (script[i] === ",") { i++; if (script[i] === "+" || script[i] === "~") i++; if (!address()) return false; }
    while (script[i] === " " || script[i] === "!") i++;
    const c = script[i++];
    if (c === undefined) return true;
    if (c === "w" || c === "W" || c === "e") return false;
    if ("aic".includes(c)) { while (i < n && script[i] !== "\n") i++; continue; } // 文字を足すだけ（行末まで）
    if ("rRbtTv:".includes(c)) { while (i < n && script[i] !== "\n" && script[i] !== ";") i++; continue; } // 読む・飛ぶ・ラベル
    if (c === "s" || c === "y") {
      const d = script[i];
      if (d === undefined || d === "\n" || d === "\\") return false;
      if (!regex(d)) return false;
      i--; // 置き換え後の文字列も同じ区切り
      if (!regex(d)) return false;
      if (c === "s") { while (/[gpiImM\d]/.test(script[i] ?? "")) i++; if (script[i] === "w" || script[i] === "e") return false; }
      continue;
    }
    if ("pPdDnNgGhHxlq=QzF#".includes(c)) { if (c === "#") while (i < n && script[i] !== "\n") i++; if (c === "q" || c === "Q" || c === "l") while (/[\d ]/.test(script[i] ?? "")) i++; continue; }
    return false; // 読めない
  }
}

// 出力先を引数で受け取るもの（sort -o・tree -o・uniq <入力> <出力>）
const sortReadOnly = (args) => !args.some((a) => /^-[a-zA-Z]*o/.test(a) || a.startsWith("--output"));
const treeReadOnly = (args) => !args.includes("-o");
// date は時計を合わせる -s・--set だけ止める（ファイルには書かない。2026-10-17 の L4 で、記録を読む 1 行の後ろの date を止めすぎた）
const dateReadOnly = (args) => !args.some((a) => /^-[a-zA-Z]*s/.test(a) || a.startsWith("--set"));
function uniqReadOnly(args) {
  let n = 0;
  for (let i = 0; i < args.length; i++) {
    if (["-f", "-s", "-w"].includes(args[i])) i++;
    else if (!args[i].startsWith("-")) n++;
  }
  return n <= 1;
}

function readOnlySegment(seg) {
  if (seg.data !== undefined) return true; // ヒアドキュメントの中身。読むコマンドに渡るだけなら何も実行されない
  if (seg.redirects.some((t) => t !== "/dev/null")) return false;
  const w = stripPrefix(seg.words);
  if (!w.length) return true;
  const cmd = base(w[0]);
  if (w[0] === "for") return true; // for <名前> in <語…>。語の中の $(…) は別の文に分かれる
  if (KEYWORD_ENDS.has(w[0])) return true; // done < <ファイル> の読み込みを含む（書き出しは上で止める）
  if (cmd === "git") return gitReadOnly(w.slice(1));
  if (cmd === "find") return !w.some((x) => FIND_WRITES.has(x));
  if (cmd === "sed") return sedReadOnly(w.slice(1));
  if (cmd === "sort") return sortReadOnly(w.slice(1));
  if (cmd === "tree") return treeReadOnly(w.slice(1));
  if (cmd === "uniq") return uniqReadOnly(w.slice(1));
  if (cmd === "date") return dateReadOnly(w.slice(1));
  if (isHitpWord(w[0])) return readSub(w[1]);
  if (INTERPRETERS.has(cmd) && isHitpWord(w[1])) return readSub(w[2]);
  return READ_ONLY.has(cmd);
}

/** NAME=<hitp を動かす語>（H="node .claude/skills/hitp/scripts/hitp.mjs" など）なら、その中身。 */
function hitpAlias(w) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/s.exec(w);
  if (!m) return null;
  const parts = m[2].trim().split(/\s+/);
  const ok = parts.length === 1 ? isHitpWord(parts[0]) : parts.length === 2 && INTERPRETERS.has(base(parts[0])) && isHitpWord(parts[1]);
  return ok ? { name: m[1], value: m[2].trim() } : null;
}

// hitp を変数に入れて $H で動かす形（L3・L4 でよく出る）。$H・${H} を中身に置き換えてから判定する（$H approve も止める）。
// 置き換えるのは、使う前に代入し、ほかの値を代入していない変数だけ（2026-10-18。H=rm; $H …; H=hitp で rm を hitp に見せられたため）。
// hitp を入れたのに、先に使う・別の値も入れる変数は、どの値で動くかを読み切れないので broken にする
function expandHitpAliases(command) {
  const assigned = new Map();
  for (const seg of tokenize(command)) for (const w of seg.words) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(w);
    if (!m) continue;
    if (!assigned.has(m[1])) assigned.set(m[1], []);
    assigned.get(m[1]).push(hitpAlias(w)?.value ?? null);
  }
  let out = command;
  for (const [name, values] of assigned) {
    if (values.every((v) => v === null)) continue;
    const at = command.search(new RegExp(`(?:^|[\\s;&|(\`])${name}=`));
    const use = command.search(new RegExp(`\\$(?:\\{${name}\\}|${name}(?![A-Za-z0-9_]))`));
    if (at < 0 || !values.every((v) => v === values[0]) || (use >= 0 && use < at)) return { command, broken: name };
    out = out.replace(new RegExp(`\\$(?:\\{${name}\\}|${name}(?![A-Za-z0-9_]))`, "g"), () => values[0]);
  }
  return { command: out, broken: null };
}

export function guardBash(command, depth = 0) {
  if (typeof command !== "string" || depth > 3) return null;
  const expanded = expandHitpAliases(command);
  if (expanded.broken) return DENY_HITP;
  command = expanded.command;
  const segs = tokenize(command);
  for (const seg of segs) {
    const w = stripPrefix(seg.words);
    // hitp の書き込み系。引用符で囲んでも、node 経由でも同じ。
    for (let i = 0; i < w.length - 1; i++) if (isHitpWord(w[i]) && WRITE_SUBS.has(w[i + 1])) return DENY_HITP;
    // hitp を動かすときは、サブコマンドが読み取り系のときだけ通す（$A approve のように変数に入れたものも止める。2026-10-18）
    const sub = isHitpWord(w[0]) ? 1 : INTERPRETERS.has(base(w[0])) && isHitpWord(w[1]) ? 2 : 0;
    if (sub && !readSub(w[sub])) return DENY_HITP;
    // lib を直接読み込んで書き込み系の関数を呼ぶ。読むだけ（cat など）は止めない。
    if (INTERPRETERS.has(base(w[0])) && w.some((x) => x.includes("skills/hitp/scripts/lib/"))) return DENY_HITP;
    // bash -c "…" と eval は中身も判定する。
    if (SHELLS.has(base(w[0]))) {
      const c = w.indexOf("-c");
      const r = c >= 0 && w[c + 1] !== undefined ? guardBash(w[c + 1], depth + 1) : null;
      if (r) return r;
    }
    if (base(w[0]) === "eval") { const r = guardBash(w.slice(1).join(" "), depth + 1); if (r) return r; }
  }
  const touches = segs.some((seg) => seg.words.some(isProtectedWord) || seg.redirects.some(isProtectedWord)
    || (base(stripPrefix(seg.words)[0]) === "cd" && seg.words.some((x) => x.includes(".hitp"))));
  // 案 B: 触れうるコマンドに、hook が読み切れない書き方があれば、中身を見ずに止める
  const touchesAny = touches || touchesPackage(segs);
  const vs = views(segs);
  if (touchesAny && !vs) return DENY_UNRESOLVED;
  const readOnly = (vs ?? [segs]).every((v) => v.every(readOnlySegment));
  if (touches && !readOnly) return DENY_BASH;
  if (touchesPackage(segs) && !readOnly) return DENY_PACKAGE_BASH;
  return null;
}

/**
 * 判定に使う文の並び。hook が読み切れない書き方が残るなら null（案 B）。for の変数だけは、語の並びの値を 1 つずつ当てはめた並びにする:
 * ほかの読み切れない書き方が無く、代入し直さず（f=…・read f・printf -v f など、名前だけの語も含む）、コマンドの位置に来ないもの。
 * 2026-10-14 に緩めた読むだけのループ（for f in …; do grep … $f; done）を残すため（2026-10-18、AI の判断）。
 * while read の変数は、値がファイルの中身から来て見えないので読み切れない（止める）。
 */
function views(segs) {
  if (!segs.flags.length) return [segs];
  const heads = segs.filter((s) => s.words[0] === "for" && s.words[2] === "in" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s.words[1] ?? ""));
  const loops = new Map(heads.map((s) => [s.words[1], s.words.slice(3)]));
  if (!segs.flags.every((f) => f.kind === "変数" && loops.has(f.name))) return null;
  for (const seg of segs) {
    if ((stripPrefix(seg.words)[0] ?? "").includes("$")) return null;
    const words = seg.words[0] === "for" ? seg.words.slice(2) : seg.words;
    if (words.some((w) => [...loops.keys()].some((n) => w === n || w.startsWith(`${n}=`) || w.startsWith(`${n}[`)))) return null;
  }
  // 値を 1 つずつ当てはめた文の並び（-i や -o を値に入れて、読むコマンドを書くコマンドに変えられるので。2026-10-18）。
  // 空白を含む値は語に分かれるので読み切れない。組み合わせが多すぎるものも止める
  let out = [segs];
  for (const [name, values] of loops) {
    if (!values.length || values.some((v) => /\s/.test(v))) return null;
    const re = new RegExp(`\\$(?:\\{${name}\\}|${name}(?![A-Za-z0-9_]))`, "g");
    out = out.flatMap((view) => values.map((v) => view.map((seg) => (seg.words[0] === "for" ? seg : { ...seg, words: seg.words.map((w) => w.replace(re, () => v)), redirects: seg.redirects.map((w) => w.replace(re, () => v)) }))));
    if (out.length > 64) return null;
  }
  return out;
}

// hitp そのものと hook の設定に触れうるか。hitp を動かす語（node …/hitp.mjs status の …/hitp.mjs）は触れたうちに入れない（書き込み系は上で止める）
function touchesPackage(segs) {
  return segs.some((seg) => {
    const w = stripPrefix(seg.words);
    const run = isHitpWord(w[0]) ? w[0] : INTERPRETERS.has(base(w[0])) && isHitpWord(w[1]) ? w[1] : null;
    return seg.words.some((x) => x !== run && !hitpAlias(x) && isPackageWord(x)) || seg.redirects.some(isPackageWord)
      || (base(w[0]) === "cd" && seg.words.some((x) => x.includes(".claude")));
  });
}
