import { describe, expect, it } from "vitest";
import { toCsv, toJson } from "../src/log/csv";
import { createStore } from "../src/log/store";
import { CSV_COLUMNS } from "../src/log/types";
import { MemStorage, makeMeta, rec } from "./helpers-log";

describe("csv", () => {
  it("BOM + 헤더 27열 순서", () => {
    const out = toCsv([]);
    expect(out.startsWith("﻿")).toBe(true);
    const header = out.slice(1).split("\r\n")[0]!.split(",");
    expect(header).toHaveLength(27);
    expect(header).toEqual([...CSV_COLUMNS]);
  });

  it("쉼표, 따옴표, 줄바꿈 이스케이프와 불리언, 빈칸, detail JSON", () => {
    const r = rec(makeMeta(), [
      { event_type: "session_start", at: 0, detail: { note: 'a,"b"' }, matches_original: true, correct: false },
    ]);
    const body = toCsv([r]).slice(1).split("\r\n")[1]!;
    expect(body).toContain('"{""note"":""a,\\""b\\""""}"');
    expect(body.startsWith("P01.1000,P01,heungbu,on,rewind,on,double,1,")).toBe(true);
    expect(body).toContain(",true,,false,");
    const r2 = rec(makeMeta(), [{ event_type: "tts_error", at: 0, node_id: "x\ny" }]);
    expect(toCsv([r2])).toContain('"x\ny"');
    const r3 = rec(makeMeta(), [{ event_type: "tts_error", at: 0, node_id: "x,y" }]);
    expect(toCsv([r3])).toContain('"x,y"');
  });

  it("여러 세션 병합", () => {
    const a = rec(makeMeta("P01", 1), [
      { event_type: "session_start", at: 0 },
      { event_type: "next_click", at: 4 },
    ]);
    const b = rec(makeMeta("P02", 2), [{ event_type: "session_start", at: 0 }]);
    const lines = toCsv([a, b]).trim().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[3]!.startsWith("P02.2,P02,")).toBe(true);
  });

  it("dropout 행 t_ms 빈칸", () => {
    const r = rec(makeMeta(), [
      { event_type: "session_start", at: 0 },
      { event_type: "dropout", at: 9 },
    ]);
    const cols = toCsv([r]).trim().split("\r\n")[2]!.split(",");
    expect(cols[CSV_COLUMNS.indexOf("t_ms")]).toBe("");
  });

  it("CSV와 JSON 모두 apiKey 없음", () => {
    const mem = new MemStorage();
    mem.setItem("dh.settings", JSON.stringify({ apiKey: "sk-ant-FAKE-123", ttsRate: 0.9 }));
    const store = createStore(mem);
    const m = makeMeta();
    store.createSession(m);
    const sessions = store.listSessions();
    const csv = toCsv(sessions);
    const json = toJson(sessions);
    for (const s of [csv, json]) {
      expect(s).not.toContain("sk-ant");
      expect(s).not.toContain("apiKey");
    }
    expect(JSON.parse(json)[0]!.meta.session_id).toBe(m.session_id);
  });
});
