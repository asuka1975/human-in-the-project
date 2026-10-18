#!/usr/bin/env node
// hitp — 記録を作る唯一の入口と、状態を読む道具（docs/CLI.md）。
//   書き込み系 init・approve・reject・submit・checkpoint はリーダーが実行する（エージェントの呼び出しは hook が拒否する）。
//   読み取り系 status・show・check・verify は誰でも実行できる。--json で結果を JSON にする。
//   終了コード: 0 成功、1 受け付けない、2 使い方の誤り。
import { HitpError, UsageError } from "./lib/util.mjs";
import * as cmd from "./lib/commands.mjs";
import * as view from "./lib/render.mjs";

const USAGE = `使い方: hitp <command> [引数] [--json]

書き込み系（リーダーが実行する）
  init <名前>                         プロジェクトを始める
  approve <ID> [--expect <ハッシュ>]  下書き（PRP・DRF）を承認して記録にする（--expect: 読んだときの中身のハッシュの先頭。変わっていれば止める）
  reject <ID> [--reason <理由>]       提案（PRP）を却下する
  submit <WI> --file <種類>=<パス> … --gate id=<GATE>,by=<誰が>,at=<いつ>,result=<pass|fail> …
                                      成果物一式とゲート通過記録を提出する
  checkpoint <WI> <番号> [--date <YYYY-MM-DD>] [--note <ひとこと>]
                                      WorkItem のチェックポイントの通過を記録する

読み取り系
  status                              現在の状態の要約
  show <ID> [--capacity <MEM>=<週の稼働日> …]
                                      下書き・記録の中身。計画なら見通しも出す（--capacity で稼働を仮に置き換える）
  check [<ID>…]                       下書きの検査
  verify [--head <ハッシュ>]           記録と成果物の改ざん検査（--head: 書き込み系のあとに出た記録の末尾。記録が作り直されていないかを照らし合わせる）

書き込み系は、終わると記録の末尾（何番目と、ハッシュの先頭 12 文字）を出す。控えておくと、あとで verify --head で照らし合わせられる。`;

/** 位置引数と、値を取るオプション（繰り返し可）を分ける。 */
function parseArgs(argv) {
  const valued = new Set(["--reason", "--file", "--gate", "--capacity", "--date", "--note", "--expect", "--head"]);
  const out = { positional: [], json: false, reason: undefined, date: undefined, note: undefined, expect: undefined, head: undefined, file: [], gate: [], capacity: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { out.json = true; continue; }
    const eq = a.indexOf("=");
    const name = a.startsWith("--") && eq > 0 ? a.slice(0, eq) : a;
    if (valued.has(name)) {
      const v = name === a ? argv[++i] : a.slice(eq + 1);
      if (v === undefined) throw new UsageError(`${name} に値がありません`);
      if (["--reason", "--date", "--note", "--expect", "--head"].includes(name)) out[name.slice(2)] = v; else out[name.slice(2)].push(v);
      continue;
    }
    if (a.startsWith("--")) throw new UsageError(`未知のオプション ${a}`);
    out.positional.push(a);
  }
  return out;
}

/** --capacity MEM-0002=3 を { "MEM-0002": 3 } にする。 */
function parseCapacity(list) {
  const out = {};
  for (const x of list) {
    const m = /^(MEM-\d{4,})=(\d+(?:\.\d+)?)$/.exec(x);
    if (!m) throw new UsageError(`--capacity は MEM-0001=3 の形で書いてください（${x}）`);
    out[m[1]] = Number(m[2]);
  }
  return out;
}

/** 書き込み系の結果に、記録の末尾を添える（リーダーの画面に出す）。 */
function written({ result, render }) {
  const head = cmd.headOf(result.event);
  return { result: { ...result, head }, render: (r) => [render(r), view.renderHead(head)].join("\n") };
}

function run(argv) {
  const [command, ...rest] = argv;
  const a = parseArgs(rest);
  const one = () => {
    if (a.positional.length !== 1) throw new UsageError(`使い方: hitp ${command} <ID>`);
    return a.positional[0];
  };
  switch (command) {
    case "init": return written({ result: cmd.init(a.positional.join(" ")), render: view.renderInit });
    case "approve": return written({ result: cmd.approve(one(), { expect: a.expect }), render: view.renderApprove });
    case "reject": return written({ result: cmd.reject(one(), a.reason), render: view.renderReject });
    case "submit": return written({ result: cmd.submit(one(), a.file, a.gate), render: view.renderSubmit });
    case "checkpoint": {
      if (a.positional.length !== 2) throw new UsageError("使い方: hitp checkpoint <WI> <番号> [--date <YYYY-MM-DD>] [--note <ひとこと>]");
      return written({ result: cmd.checkpoint(a.positional[0], a.positional[1], { date: a.date, note: a.note }), render: view.renderCheckpoint });
    }
    case "status": return { result: cmd.status(), render: view.renderStatus };
    case "show": return { result: cmd.show(one(), { capacity: parseCapacity(a.capacity) }), render: view.renderShow };
    case "check": {
      const result = cmd.check(a.positional);
      return { result, render: view.renderCheck, failed: !result.ok };
    }
    case "verify": {
      if (a.head !== undefined && !/^[0-9a-f]{8,64}$/.test(a.head)) throw new UsageError(`--head は、書き込み系のあとに出た記録の末尾のハッシュ（16 進 8 文字以上）で書いてください（${a.head}）`);
      const result = cmd.verify({ head: a.head });
      return { result, render: view.renderVerify, failed: !result.ok };
    }
    case undefined: case "help": case "--help": case "-h":
      return { result: { usage: USAGE }, render: () => USAGE };
    default: throw new UsageError(`未知のコマンド ${command}`);
  }
}

const argv = process.argv.slice(2);
const json = argv.includes("--json");
try {
  const { result, render, failed } = run(argv);
  process.stdout.write((json ? JSON.stringify(result, null, 2) : render(result)) + "\n");
  process.exit(failed ? 1 : 0);
} catch (e) {
  if (e instanceof HitpError) {
    process.stdout.write((json ? JSON.stringify({ ok: false, problems: e.problems }, null, 2) : view.renderProblems(e.problems)) + "\n");
    process.exit(1);
  }
  if (e instanceof UsageError) {
    process.stderr.write(`${e.message}\n\n${USAGE}\n`);
    process.exit(2);
  }
  throw e;
}
