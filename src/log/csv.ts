import { CSV_COLUMNS, type LogEvent, type SessionRecord } from "./types";

const NUMERIC_COLUMNS = new Set(["seq", "t_ms", "attempt", "rt_ms", "replay_count"]);

/** 스프레드시트 수식 주입 방지: =,+,-,@,탭,CR로 시작하면 앞에 '. 숫자 열은 예외. */
function cell(v: unknown, col: string): string {
  if (v === undefined || v === null) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !(NUMERIC_COLUMNS.has(col) && typeof v === "number")) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(e: LogEvent): string {
  const r = e as unknown as Record<string, unknown>;
  return CSV_COLUMNS.map((c) => cell(r[c], c)).join(",");
}

/** UTF-8 BOM + 헤더 + 모든 세션의 이벤트 행 (RFC 4180, 줄바꿈 CRLF) */
export function toCsv(records: SessionRecord[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const rec of records) for (const e of rec.events) lines.push(row(e));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** 세션 로그만. 설정(apiKey 포함)은 절대 넣지 않는다. */
export function toJson(records: SessionRecord[]): string {
  return JSON.stringify(
    records.map((r) => ({ meta: r.meta, events: r.events })),
    null,
    2,
  );
}
