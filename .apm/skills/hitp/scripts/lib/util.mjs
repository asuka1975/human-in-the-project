// 共通の小道具 — エラーの型、ID、正規化した JSON、ハッシュ、時刻。
import { createHash } from "node:crypto";

/** 受け付けない理由の一覧を持つエラー。CLI は problems を 1 行ずつ出して終了コード 1 で終わる。 */
export class HitpError extends Error {
  constructor(problems) {
    const list = Array.isArray(problems) ? problems : [problems];
    super(list.join("\n"));
    this.problems = list;
  }
}

/** 使い方の誤り。CLI は終了コード 2 で終わる。 */
export class UsageError extends Error {}

export const PREFIXES = ["PRP", "DRF", "EST", "OBJ", "PRM", "MEM", "PLAN", "WI", "QG", "GATE", "DEC", "RPT", "INC", "DLV", "GR"];
// 4 桁（0 埋め）。9999 を超えたら先頭を 0 にしない（WI-0001 と WI-00001 を別の ID にさせない）。
const ID_RE = /^([A-Z]+)-(\d{4}|[1-9]\d{4,})$/;

export function idPrefix(id) {
  const m = typeof id === "string" ? ID_RE.exec(id) : null;
  return m && PREFIXES.includes(m[1]) ? m[1] : null;
}

export const isId = (id, prefix) => idPrefix(id) === prefix;
export const idNumber = (id) => Number(ID_RE.exec(id)[2]);
export const formatId = (prefix, n) => `${prefix}-${String(n).padStart(4, "0")}`;

/** キーを辞書順に並べた JSON。undefined の項目は落とす。ハッシュの入力に使う。 */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** 現在時刻。HITP_NOW で固定できる（テストと再実行のため）。 */
export const now = () => process.env.HITP_NOW ?? new Date().toISOString();

export const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/** 実在する日付か（2026-02-30 のような繰り上がる日付は受け付けない）。 */
export function isDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function isDateTime(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && isDate(v.slice(0, 10)) && !Number.isNaN(Date.parse(v));
}
