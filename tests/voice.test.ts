import { describe, expect, it } from "vitest";
import { createVoiceController } from "../src/ui/voice";
import { keywordResponder } from "../src/ask/responder";
import type { Asr, AsrFailReason, AsrResult } from "../src/asr";
import { act, storyAsk, toC1 } from "./helpers-ask";

type Cb = { onResult: (r: AsrResult) => void; onFail: (reason: AsrFailReason) => void };

function setup(opts: { nullAsr?: boolean } = {}) {
  const sim = toC1();
  const rec = { makeCalls: 0, starts: 0, cb: null as Cb | null };
  const asr: Asr = { start: () => { rec.starts++; }, stop: () => {}, isListening: () => false };
  const voice = createVoiceController({
    story: storyAsk,
    getState: () => sim.state,
    dispatch: (a) => { act(sim, a); },
    makeAsr: (cb) => { rec.makeCalls++; rec.cb = cb; return opts.nullAsr ? null : asr; },
    responder: keywordResponder,
  });
  return { sim, rec, voice };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("voice controller", () => {
  it("listening이 아닐 때 start()는 asr.start를 부르지 않는다", () => {
    const { rec, voice } = setup();
    voice.start();
    expect(rec.starts).toBe(0);
    expect(rec.makeCalls).toBe(0);
  });

  it("voiceStart 뒤 start() → asr.start 1회, 결과가 맞으면 대답 화면", async () => {
    const { sim, rec, voice } = setup();
    act(sim, { type: "voiceStart" });
    voice.start();
    expect(rec.starts).toBe(1);
    rec.cb!.onResult({ transcript: "토리야 몇 개야", alternatives: [] });
    await flush();
    expect(sim.logs.some((e) => e.event_type === "screen_enter" && e.node_id === "c1.ask.tori.q1")).toBe(true);
  });

  it("onFail('not_allowed') → voice_fail 로그 detail.reason", () => {
    const { sim, rec, voice } = setup();
    act(sim, { type: "voiceStart" });
    voice.start();
    rec.cb!.onFail("not_allowed");
    const ev = sim.logs.filter((e) => e.event_type === "voice_fail");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.detail).toMatchObject({ reason: "not_allowed" });
  });

  it("두 번째 start()도 같은 Asr(makeAsr 1회)", () => {
    const { sim, rec, voice } = setup();
    act(sim, { type: "voiceStart" });
    voice.start();
    rec.cb!.onFail("no_speech");
    act(sim, { type: "voiceStart" });
    voice.start();
    expect(rec.makeCalls).toBe(1);
    expect(rec.starts).toBe(2);
  });

  it("makeAsr가 null → voiceFail other 로그", () => {
    const { sim, voice } = setup({ nullAsr: true });
    act(sim, { type: "voiceStart" });
    voice.start();
    const ev = sim.logs.filter((e) => e.event_type === "voice_fail");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.detail).toMatchObject({ reason: "other" });
  });
});
