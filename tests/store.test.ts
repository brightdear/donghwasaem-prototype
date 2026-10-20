import { describe, expect, it } from "vitest";
import { createEventFactory } from "../src/log/events";
import { createStore } from "../src/log/store";
import { MemStorage, makeMeta } from "./helpers-log";

const T = "2026-01-01T00:00:00Z";

function setup(code = "P01", epoch = 1000) {
  const mem = new MemStorage();
  const store = createStore(mem);
  const meta = makeMeta(code, epoch);
  store.createSession(meta);
  const f = createEventFactory(meta);
  const add = (e: Parameters<typeof f>[0]) => store.appendEvent(meta.session_id, f(e, T));
  return { mem, store, meta, add, f };
}

describe("store", () => {
  it("두 참가자 세션 키 분리", () => {
    const mem = new MemStorage();
    const s = createStore(mem);
    s.createSession(makeMeta("P01", 1));
    s.createSession(makeMeta("P02", 2));
    expect([...mem.data.keys()].sort()).toEqual(["dh.index", "dh.session.P01.1", "dh.session.P02.2"]);
    expect(s.listSessions().map((r) => r.meta.session_id)).toEqual(["P01.1", "P02.2"]);
  });

  it("새 store 인스턴스로 읽어도 이벤트 유지", () => {
    const { mem, add, meta } = setup();
    add({ event_type: "session_start", at: 0 });
    add({ event_type: "screen_enter", at: 5, screen: "passage" });
    const again = createStore(mem).getSession(meta.session_id)!;
    expect(again.events.map((e) => e.event_type)).toEqual(["session_start", "screen_enter"]);
    expect(again.events[1]!.t_ms).toBe(5);
    expect(again.events[1]!.seq).toBe(2);
  });

  it("completed 세션에 late event 덧붙이기, seq 이어짐", () => {
    const { store, add, meta, f } = setup();
    add({ event_type: "session_start", at: 0 });
    store.markCompleted(meta.session_id);
    const g = createEventFactory(meta);
    store.appendLateEvent(meta.session_id, g({ event_type: "report_view", at: 9 }, T));
    store.appendLateEvent(meta.session_id, g({ event_type: "asked_check", at: 10 }, T));
    const r = store.getSession(meta.session_id)!;
    expect(r.meta.status).toBe("completed");
    expect(r.events.map((e) => [e.event_type, e.seq])).toEqual([
      ["session_start", 1],
      ["session_end", 2],
      ["report_view", 3],
      ["asked_check", 4],
    ]);
    expect(store.appendLateEvent(meta.session_id, f({ event_type: "next_click", at: 1 }, T)).ok).toBe(false);
  });

  it("새 세션 시작 시 이전 open 세션 abandoned", () => {
    const { store, add, meta } = setup("P01", 1000);
    add({ event_type: "screen_enter", at: 0, screen: "choice" });
    const m2 = makeMeta("P01", 5000);
    store.createSession(m2);
    store.abandonOpenSessions(m2.session_id, 4000, "choice");
    expect(store.getSession(meta.session_id)!.meta.status).toBe("abandoned");
    const end = store.getSession(meta.session_id)!.events.at(-1)!;
    expect(end.event_type).toBe("session_end");
    expect(end.detail).toMatchObject({ status: "abandoned", last_screen: "choice" });
    expect(end.t_ms).toBe(3000);
    expect(store.getSession(m2.session_id)!.meta.status).toBe("open");
  });

  it("abandoned detail.last_screen이 마지막 screen_enter 값", () => {
    const { store, add, meta } = setup("P01", 1000);
    add({ event_type: "screen_enter", at: 0, screen: "passage" });
    add({ event_type: "screen_enter", at: 10, screen: "choice" });
    store.abandonOpenSessions("", 4000);
    const end = store.getSession(meta.session_id)!.events.at(-1)!;
    expect(end.detail).toMatchObject({ status: "abandoned", last_screen: "choice", last_seq: 2 });
  });

  it("dropout은 session_end 없는 open 세션에 1회, t_ms null, last_seq", () => {
    const { store, add, meta } = setup();
    add({ event_type: "session_start", at: 0 });
    add({ event_type: "screen_enter", at: 3, screen: "passage" });
    store.markDropouts("2026-02-01T00:00:00Z");
    store.markDropouts("2026-02-02T00:00:00Z");
    const r = store.getSession(meta.session_id)!;
    const d = r.events.filter((e) => e.event_type === "dropout");
    expect(d).toHaveLength(1);
    expect(d[0]!.t_ms).toBeNull();
    expect(d[0]!.detail).toEqual({ last_seq: 2, last_screen: "passage" });
    expect(r.meta.status).toBe("dropout");
  });

  it("completed·abandoned에는 dropout 없음", () => {
    const a = setup("P01", 1);
    a.add({ event_type: "session_start", at: 0 });
    a.store.markCompleted(a.meta.session_id);
    a.store.markDropouts(T);
    expect(a.store.getSession(a.meta.session_id)!.events.some((e) => e.event_type === "dropout")).toBe(false);

    const b = setup("P02", 2);
    b.store.setStatus(b.meta.session_id, "abandoned");
    b.store.markDropouts(T);
    expect(b.store.getSession(b.meta.session_id)!.events.some((e) => e.event_type === "dropout")).toBe(false);
  });

  it("QuotaExceeded는 예외 대신 quota 결과", () => {
    const { mem, store, meta, f } = setup();
    mem.limit = 50;
    const r = store.appendEvent(meta.session_id, f({ event_type: "session_start", at: 0 }, T));
    expect(r).toEqual({ ok: false, reason: "quota" });
  });

  it("미내보내기 수, export 표시, hasSessionFor, 용량", () => {
    const { store, meta } = setup();
    store.createSession(makeMeta("P02", 2));
    expect(store.countUnexported()).toBe(2);
    store.markExported([meta.session_id]);
    expect(store.countUnexported()).toBe(1);
    expect(store.hasSessionFor("P01", "heungbu")).toBe(true);
    expect(store.hasSessionFor("P01", "ant")).toBe(false);
    expect(store.estimateBytes()).toBeGreaterThan(0);
  });

  it("clearSessions는 설정을 유지", () => {
    const { mem, store } = setup();
    mem.setItem("dh.settings", '{"apiKey":"x"}');
    store.clearSessions();
    expect(store.listSessions()).toEqual([]);
    expect([...mem.data.keys()]).toEqual(["dh.settings"]);
  });
});
