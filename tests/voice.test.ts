import { describe, expect, it } from "vitest";
import { createVoiceController } from "../src/ui/voice";
import { keywordResponder, type AskInput, type AskOutput, type AskResponder } from "../src/ask/responder";
import type { Asr, AsrFailReason, AsrResult } from "../src/asr";
import { act, storyAsk, toC1, view } from "./helpers-ask";

type Cb = { onResult: (r: AsrResult) => void; onFail: (reason: AsrFailReason) => void };

function setup(opts: { nullAsr?: boolean; responder?: AskResponder; responderKind?: "llm" | "keyword" } = {}) {
  const sim = toC1();
  const rec = { makeCalls: 0, starts: 0, cb: null as Cb | null };
  const asr: Asr = { start: () => { rec.starts++; }, stop: () => {}, isListening: () => false };
  const voice = createVoiceController({
    story: storyAsk,
    getState: () => sim.state,
    dispatch: (a) => { act(sim, a); },
    makeAsr: (cb) => { rec.makeCalls++; rec.cb = cb; return opts.nullAsr ? null : asr; },
    responder: opts.responder ?? keywordResponder,
    ...(opts.responderKind ? { responderKind: opts.responderKind } : {}),
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

  it("응답기에 scene(c1 직전 passage 문단)·제목을 넘기고, voice_result에 responder 종류를 남긴다", async () => {
    const seen: AskInput[] = [];
    const responder: AskResponder = { respond: async (i) => { seen.push(i); return null; } };
    const { sim, rec, voice } = setup({ responder, responderKind: "llm" });
    act(sim, { type: "voiceStart" });
    voice.start();
    rec.cb!.onResult({ transcript: "안녕", alternatives: [] });
    await flush();
    const p1 = storyAsk.spine.find((n) => n.id === "p1");
    expect(seen[0]!.scene).toEqual(p1 && p1.type === "passage" ? p1.paragraphs : null);
    expect(seen[0]!.storyTitle).toBe(storyAsk.title);
    expect(sim.logs.find((e) => e.event_type === "voice_result")).toMatchObject({ detail: { responder: "llm" } });
  });

  it("응답 대기 중 start()가 다시 오면 옛 결과는 버린다", async () => {
    const pending: ((o: AskOutput | null) => void)[] = [];
    const responder: AskResponder = { respond: () => new Promise((res) => { pending.push(res); }) };
    const { sim, rec, voice } = setup({ responder });
    act(sim, { type: "voiceStart" });
    voice.start();
    rec.cb!.onResult({ transcript: "토리야 몇 개야", alternatives: [] });
    // 응답이 늦는 사이 실패로 듣기가 끝나고, 아이가 다시 마이크를 누른다
    act(sim, { type: "voiceFail", reason: "other" });
    act(sim, { type: "voiceStart" });
    voice.start();
    pending[0]!({ characterId: "tori", questionId: "q1", answerText: ["세 개야."], source: "keyword" });
    await flush();
    expect(sim.logs.filter((e) => e.event_type === "voice_result")).toHaveLength(0);
    expect(view(sim)).toMatchObject({ screen: "ask", voice: "listening" });
    // 새 세션의 결과는 정상 처리
    rec.cb!.onResult({ transcript: "배고파?", alternatives: [] });
    pending[1]!({ characterId: "tori", questionId: "q2", answerText: ["조금 고파."], source: "llm", latencyMs: 800 });
    await flush();
    expect(sim.logs.filter((e) => e.event_type === "voice_result")).toHaveLength(1);
    expect(view(sim)).toMatchObject({ screen: "askAnswer", nodeId: "c1.ask.tori.q2" });
  });

  it("대답 대기 중 마이크를 다시 눌러도 인식을 다시 시작하지 않고 기다리던 대답을 전한다", async () => {
    let resolve: (o: AskOutput | null) => void = () => {};
    const responder: AskResponder = { respond: () => new Promise((res) => { resolve = res; }) };
    const { sim, rec, voice } = setup({ responder });
    act(sim, { type: "voiceStart" });
    voice.start();
    rec.cb!.onResult({ transcript: "토리야 몇 개야", alternatives: [] });
    // 엔진은 아직 listening(대답 대기). 두 번째 탭: 엔진은 무시하고 컨트롤러도 시작하지 않는다
    expect(act(sim, { type: "voiceStart" })).toEqual([]);
    voice.start();
    expect(rec.starts).toBe(1);
    resolve({ characterId: "tori", questionId: "q1", answerText: ["세 개야."], source: "keyword" });
    await flush();
    expect(view(sim)).toMatchObject({ screen: "askAnswer", nodeId: "c1.ask.tori.q1" });
  });

  it("인식 중(결과 전)에 start()가 다시 와도 asr.start는 1회", () => {
    const { sim, rec, voice } = setup();
    act(sim, { type: "voiceStart" });
    voice.start();
    voice.start();
    expect(rec.starts).toBe(1);
  });

  it("LLM으로 설정돼도 실제로 대답한 응답기(키워드 대체)와 실패 이유·지연을 남긴다", async () => {
    const responder: AskResponder = {
      respond: async () => ({ characterId: "tori", questionId: "q1", answerText: ["세 개야."], source: "keyword", fallbackReason: "timeout", latencyMs: 6000 }),
    };
    const { sim, rec, voice } = setup({ responder, responderKind: "llm" });
    act(sim, { type: "voiceStart" });
    voice.start();
    rec.cb!.onResult({ transcript: "토리야 몇 개야", alternatives: [] });
    await flush();
    expect(sim.logs.find((e) => e.event_type === "voice_result")).toMatchObject({ detail: { responder: "keyword", fallbackReason: "timeout", latencyMs: 6000 } });
  });

  it("LLM이 대답하면 responder llm·latencyMs, fallbackReason 없음", async () => {
    const responder: AskResponder = {
      respond: async () => ({ characterId: "tori", questionId: "free", answerText: ["다섯 개쯤 있어."], source: "llm", latencyMs: 900 }),
    };
    const { sim, rec, voice } = setup({ responder, responderKind: "llm" });
    act(sim, { type: "voiceStart" });
    voice.start();
    rec.cb!.onResult({ transcript: "집에 도토리 많아", alternatives: [] });
    await flush();
    const d = sim.logs.find((e) => e.event_type === "voice_result")!.detail!;
    expect(d).toMatchObject({ responder: "llm", latencyMs: 900, matched: "c1.ask.tori.free" });
    expect("fallbackReason" in d).toBe(false);
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
