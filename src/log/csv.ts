import { CSV_COLUMNS, type LogEvent, type SessionRecord } from "./types";

function cell(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(e: LogEvent): string {
  const r = e as unknown as Record<string, unknown>;
  return CSV_COLUMNS.map((c) => cell(r[c])).join(",");
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
