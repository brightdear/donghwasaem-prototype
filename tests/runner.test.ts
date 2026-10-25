import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/mini.json";
import { MemStorage, makeMeta } from "./helpers-log";
import { createRunner, ttsEventToAction, type Runner } from "../src/ui/runner";
import { createStore } from "../src/log/store";
import { currentView } from "../src/story/engine";
import type { Conditions, EngineSettings, SpeakKind, Story, View } from "../src/story/types";
import type { Tts, TtsEvent } from "../src/tts";

const story = fixture as unknown as Story;
const COND: Conditions = { branching: true, mismatch: "rewind", askWhy: true };

function fakeTts() {
  const calls: { id: string; kind: SpeakKind; text: string }[] = [];
  let onEvent: (e: TtsEvent) => void = () => {};
  const tts: Tts = {
    speak: (id, kind, text) => void calls.push({ id, kind, text }),
    cancel: vi.fn(),
    unlock: vi.fn(),
    findKoVoice: async () => null,
    listKoVoices: () => [],
  };
  return { tts, calls, emit: (e: TtsEvent) => onEvent(e), bind: (f: (e: TtsEvent) => void) => (onEvent = f) };
}

function setup(opts: { tts: Tts | null; settings?: EngineSettings }) {
  const meta = { ...makeMeta("P01", 5000), story_id: "mini", conditions: COND };
  const store = createStore(new MemStorage());
  store.createSession(meta);
  let t = 1000;
  const views: View[] = [];
  const onFinished = vi.fn();
  const runner: Runner = createRunner({
    story,
    conditions: COND,
    engineSettings: opts.settings ?? { manualReading: false, confirmMode: "double", askLayer: false, voiceAsk: false },
    meta,
    store,
    tts: opts.tts,
    clock: () => t,
    nowIso: () => "2026-10-20T00:00:00.000Z",
    render: (v) => views.push(v),
    onFinished,
  });
  const events = () => store.getSession(meta.session_id)!.events;
  return { meta, store, runner, views, onFinished, events, tick: (ms: number) => (t += ms) };
}

describe("runner", () => {
  it("start: session_start(seq 1, t_ms 0) 뒤 엔진 효과 실행, speak → tts.speak", () => {
    const f = fakeTts();
    const { runner, events, views, meta } = setup({ tts: f.tts });
    runner.start();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.kind).toBe("passage");
    expect(f.calls[0]!.text).toContain("다람쥐 토리");
    const ev = events();
    expect(ev[0]).toMatchObject({
      event_type: "session_start",
      seq: 1,
      t_ms: 0,
      session_id: meta.session_id,
      participant_code: "P01",
      story_id: "mini",
      cond_branching: "on",
      cond_mismatch: "rewind",
      cond_ask_why: "on",
      confirm_mode: "double",
      ts_iso: "2026-10-20T00:00:00.000Z",
    });
    expect(ev[0]!.detail).toMatchObject({ askLayer: false, voiceAsk: false, asr: "unsupported" });
    expect(ev.map((e) => e.event_type)).toEqual(["session_start", "screen_enter", "tts_start"]);
    expect(ev.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(views.at(-1)).toMatchObject({ screen: "passage", nextVisible: false });
  });

  it("session_start detail에 pictures 기록(CSV 열 추가 없음)", () => {
    const f = fakeTts();
    const { runner, events, meta } = setup({ tts: f.tts });
    meta.pictures = true;
    runner.start();
    expect(events()[0]!.detail).toMatchObject({ pictures: true, manualReading: false });
  });

  it("tts done → ttsDone 디스패치, at은 clock", () => {
    const f = fakeTts();
    const { runner, events, views, tick } = setup({ tts: f.tts });
    f.bind((e) => {
      const a = ttsEventToAction(e);
      if (a) runner.dispatch(a);
    });
    runner.start();
    tick(1234);
    f.emit({ type: "start", utteranceId: f.calls[0]!.id });
    expect(events().some((e) => e.event_type === "tts_end")).toBe(false);
    f.emit({ type: "done", utteranceId: f.calls[0]!.id, outcome: "ended" });
    const end = events().find((e) => e.event_type === "tts_end")!;
    expect(end.t_ms).toBe(1234);
    expect(end.detail).toMatchObject({ outcome: "ended", utterance_id: f.calls[0]!.id });
    expect(views.at(-1)).toMatchObject({ screen: "passage", nextVisible: true });
  });

  it("cancelSpeech → tts.cancel", () => {
    const f = fakeTts();
    const { runner } = setup({ tts: f.tts });
    runner.start();
    runner.dispatch({ type: "replay" }); // 낭독 중 다시 듣기 → 취소 후 재낭독
    expect(f.tts.cancel).toHaveBeenCalled();
    expect(f.calls).toHaveLength(2);
  });

  it("tts null이면 speak → 즉시 ttsDone(error)", () => {
    const { runner, events, views } = setup({ tts: null });
    runner.start();
    const err = events().find((e) => e.event_type === "tts_error");
    expect(err?.detail).toMatchObject({ outcome: "error" });
    expect(views.at(-1)).toMatchObject({ screen: "passage", nextVisible: true });
  });

  it("끝까지 진행하면 onFinished 1회, 그 뒤 dispatch는 무시", () => {
    const { runner, onFinished } = setup({ tts: null, settings: { manualReading: true, confirmMode: "double", askLayer: false, voiceAsk: false } });
    runner.start();
    for (let g = 0; g < 500 && onFinished.mock.calls.length === 0; g++) {
      const v = currentView(runner.getState());
      if (v.screen === "choice") runner.dispatch({ type: "confirm", optionId: v.options[0]!.id });
      else if (v.screen === "why") runner.dispatch({ type: "answerWhy", optionId: v.options[0]!.id });
      else if (v.screen === "comprehension") {
        if (v.feedback === null) runner.dispatch({ type: "answerQuestion", optionId: v.options[0]!.id });
        else runner.dispatch({ type: "next" });
      } else runner.dispatch({ type: "next" });
    }
    expect(onFinished).toHaveBeenCalledTimes(1);
    runner.dispatch({ type: "next" });
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("logExtra는 같은 seq 흐름으로 기록, 저장 실패 시 경고 1회 후 진행", () => {
    const { runner, events, store } = setup({ tts: null });
    runner.start();
    runner.logExtra({ event_type: "page_hidden", detail: { reason: "test" } });
    const ev = events();
    expect(ev.at(-1)).toMatchObject({ event_type: "page_hidden", seq: ev.length });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.clearSessions(); // 이후 appendEvent는 missing
    runner.dispatch({ type: "next" }); // p1 1페이지 → 2페이지
    runner.dispatch({ type: "next" }); // p1 마지막 페이지 → 다음 화면
    runner.dispatch({ type: "replay" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(currentView(runner.getState()).screen).not.toBe("passage");
    warn.mockRestore();
  });
});
