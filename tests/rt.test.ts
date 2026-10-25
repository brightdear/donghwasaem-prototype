import { describe, expect, it } from "vitest";
import fixture from "./fixtures/mini.json";
import { currentView, init, step, type EngineState } from "../src/story/engine";
import type { Conditions, Effect, StepResult, Story, TtsOutcome } from "../src/story/types";
import type { EngineLogEvent } from "../src/log/types";
import { computeRt, updateBasis } from "../src/log/rt";

const story = fixture as unknown as Story;
const COND: Conditions = { branching: true, mismatch: "converge", askWhy: true };
const AUTO = { manualReading: false, confirmMode: "double" as const, askLayer: false, voiceAsk: false };

type R = StepResult<EngineState>;
const speaks = (r: R) => r.effects.filter((e): e is Extract<Effect, { type: "speak" }> => e.type === "speak");
const logOf = (r: R, type: string): EngineLogEvent | undefined =>
  (r.effects.find((e) => e.type === "log" && e.event.event_type === type) as Extract<Effect, { type: "log" }> | undefined)?.event;
const done = (r: R, id: string, outcome: TtsOutcome, at: number) => step(r.state, { type: "ttsDone", utteranceId: id, outcome, at });

const isBody = (r: R) => "pageCount" in currentView(r.state);
/** 본문 페이지마다 낭독 끝 → next를 같은 시각(at)으로 찍어 본문 화면을 벗어난다 */
function passBody(r: R, at: number): R {
  for (let g = 0; isBody(r) && g < 50; g++) {
    for (const s of speaks(r)) r = done(r, s.utteranceId, "ended", at);
    r = step(r.state, { type: "next", at });
  }
  return r;
}

/** p1 낭독 끝 → next(at=1000)로 페이지를 넘겨 c1 선택 화면 진입. promptId 반환 */
function choiceScreen(): { r: R; promptId: string; p1Id: string } {
  let r = init(story, COND, AUTO, 0);
  const p1Id = speaks(r)[0]!.utteranceId;
  r = done(r, p1Id, "ended", 500);
  r = step(r.state, { type: "next", at: 1000 });
  r = passBody(r, 1000);
  return { r, promptId: speaks(r)[0]!.utteranceId, p1Id };
}
const confirm = (r: R, at: number) => logOf(step(r.state, { type: "confirm", optionId: "c1a", at }), "choice_confirm")!;

describe("rt 헬퍼(순수)", () => {
  it("prompt ended만 기준점, option은 무시, 이미 있으면 유지", () => {
    expect(updateBasis(null, { kind: "prompt", isReplay: false }, "ended", 10)).toEqual({ at: 10, basis: "tts_end", fromReplay: false });
    expect(updateBasis(null, { kind: "option", isReplay: false }, "ended", 10)).toBeNull();
    expect(updateBasis(null, { kind: "prompt", isReplay: false }, "cancelled", 10)).toBeNull();
    expect(updateBasis(null, { kind: "prompt", isReplay: false }, "error", 10)).toBeNull();
    expect(updateBasis(null, { kind: "prompt", isReplay: true }, "watchdog", 10)).toEqual({ at: 10, basis: "watchdog", fromReplay: true });
    const b = { at: 5, basis: "tts_end" as const, fromReplay: false };
    expect(updateBasis(b, { kind: "prompt", isReplay: true }, "ended", 99)).toBe(b);
  });
  it("computeRt", () => {
    expect(computeRt(null, 100, 350)).toEqual({ rt_ms: 250, rt_basis: "shown" });
    expect(computeRt({ at: 200, basis: "tts_end", fromReplay: false }, 100, 350)).toEqual({ rt_ms: 150, rt_basis: "tts_end" });
    expect(computeRt({ at: 200, basis: "tts_end", fromReplay: true }, 100, 350)).toEqual({
      rt_ms: 150,
      rt_basis: "tts_end",
      detail: { basis_from: "replay" },
    });
  });
});

describe("반응시간 — 리듀서 경유(choice)", () => {
  it("프롬프트 전체 ended 후 확정 → tts_end", () => {
    const { r, promptId } = choiceScreen();
    const e = confirm(done(r, promptId, "ended", 3000), 4200);
    expect(e).toMatchObject({ rt_ms: 1200, rt_basis: "tts_end" });
    expect(e.detail).toBeUndefined();
  });

  it("낭독 중 확정 → shown(화면 진입 기준)", () => {
    const { r } = choiceScreen();
    expect(confirm(r, 1800)).toMatchObject({ rt_ms: 800, rt_basis: "shown" });
  });

  it.each(["cancelled", "error"] as const)("프롬프트 %s → shown", (outcome) => {
    const { r, promptId } = choiceScreen();
    expect(confirm(done(r, promptId, outcome, 2000), 2500)).toMatchObject({ rt_ms: 1500, rt_basis: "shown" });
  });

  it("watchdog → 워치독 시각 기준, rt_basis=watchdog", () => {
    const { r, promptId } = choiceScreen();
    expect(confirm(done(r, promptId, "watchdog", 9000), 9400)).toMatchObject({ rt_ms: 400, rt_basis: "watchdog" });
  });

  it("다시 듣기가 기준점을 덮어쓰지 않음", () => {
    const { r, promptId } = choiceScreen();
    let x = done(r, promptId, "ended", 3000);
    x = step(x.state, { type: "replay", at: 3500 });
    const rid = speaks(x)[0]!.utteranceId;
    x = done(x, rid, "ended", 5000);
    const e = confirm(x, 6000);
    expect(e).toMatchObject({ rt_ms: 3000, rt_basis: "tts_end", replay_count: 1 });
    expect(e.detail).toBeUndefined();
  });

  it("기준점 없을 때 프롬프트 다시 듣기 ended → 기준점·basis_from=replay", () => {
    const { r, promptId } = choiceScreen();
    let x = step(r.state, { type: "replay", at: 1500 });
    expect(x.effects.some((e) => e.type === "cancelSpeech")).toBe(true);
    expect(speaks(x)[0]).toMatchObject({ kind: "prompt" });
    const rid = speaks(x)[0]!.utteranceId;
    x = done(x, promptId, "cancelled", 1501);
    x = done(x, rid, "ended", 4000);
    expect(confirm(x, 4700)).toMatchObject({ rt_ms: 700, rt_basis: "tts_end", detail: { basis_from: "replay" } });
  });

  it("보기 낭독(kind=option) ended는 기준점을 세우지 않음", () => {
    const { r, promptId } = choiceScreen();
    let x = step(r.state, { type: "listen", optionId: "c1b", at: 1200 });
    const oid = speaks(x)[0]!.utteranceId;
    x = done(x, promptId, "cancelled", 1201);
    x = done(x, oid, "ended", 2000);
    expect(confirm(x, 2600)).toMatchObject({ rt_ms: 1600, rt_basis: "shown" });
  });

  it("다른 화면의 utteranceId는 무시", () => {
    let r = init(story, COND, AUTO, 0);
    // p1 마지막 페이지까지 넘긴다
    for (let v = currentView(r.state); "pageCount" in v && v.page < v.pageCount; v = currentView(r.state)) {
      r = done(r, speaks(r)[0]!.utteranceId, "ended", 200);
      r = step(r.state, { type: "next", at: 200 });
    }
    const p1Id = speaks(r)[0]!.utteranceId;
    r = done(r, p1Id, "ended", 300);
    r = step(r.state, { type: "replay", at: 400 }); // p1 다시 듣기(아직 안 끝남)
    const p1Replay = speaks(r)[0]!.utteranceId;
    r = step(r.state, { type: "next", at: 1000 });
    expect(currentView(r.state).screen).toBe("choice");
    r = done(r, p1Replay, "ended", 2000); // 이전 화면 utterance
    r = done(r, "c9:prompt:999", "ended", 2100); // 알 수 없는 utterance
    expect(confirm(r, 2500)).toMatchObject({ rt_ms: 1500, rt_basis: "shown" });
  });
});

describe("반응시간 — why·이해 질문에도 같은 규칙", () => {
  function whyScreen(): { r: R; promptId: string } {
    const { r: c } = choiceScreen();
    let r = step(c.state, { type: "confirm", optionId: "c1a", at: 2000 });
    r = done(r, speaks(r)[0]!.utteranceId, "ended", 2500);
    r = step(r.state, { type: "next", at: 3000 });
    expect(currentView(r.state).screen).toBe("why");
    return { r, promptId: speaks(r)[0]!.utteranceId };
  }
  const answerWhy = (r: R, at: number) => logOf(step(r.state, { type: "answerWhy", optionId: "c1a-w2", at }), "why_answer")!;

  it("why: ended 후 → tts_end, 낭독 중 → shown, watchdog → watchdog", () => {
    const a = whyScreen();
    expect(answerWhy(done(a.r, a.promptId, "ended", 4000), 4300)).toMatchObject({ rt_ms: 300, rt_basis: "tts_end", reason_type: "outcome" });
    const b = whyScreen();
    expect(answerWhy(b.r, 3400)).toMatchObject({ rt_ms: 400, rt_basis: "shown" });
    const c = whyScreen();
    expect(answerWhy(done(c.r, c.promptId, "watchdog", 5000), 5100)).toMatchObject({ rt_ms: 100, rt_basis: "watchdog" });
  });

  function compScreen(): { r: R; promptId: string; enteredAt: number } {
    let r = init(story, { branching: false, mismatch: "na", askWhy: "na" }, AUTO, 0);
    let t = 0;
    while (currentView(r.state).screen !== "comprehension") {
      for (const s of speaks(r)) r = done(r, s.utteranceId, "ended", (t += 1));
      r = step(r.state, { type: "next", at: (t += 1) });
    }
    return { r, promptId: speaks(r)[0]!.utteranceId, enteredAt: t };
  }
  const answerQ = (r: R, at: number) => logOf(step(r.state, { type: "answerQuestion", optionId: "q1a", at }), "comprehension_answer")!;

  it("이해 질문: ended 후 → tts_end, 취소 → shown, 다시 듣기 기준점 → basis_from=replay", () => {
    const a = compScreen();
    expect(answerQ(done(a.r, a.promptId, "ended", a.enteredAt + 1000), a.enteredAt + 1250)).toMatchObject({ rt_ms: 250, rt_basis: "tts_end" });
    const b = compScreen();
    expect(answerQ(done(b.r, b.promptId, "cancelled", b.enteredAt + 10), b.enteredAt + 900)).toMatchObject({ rt_ms: 900, rt_basis: "shown" });
    const c = compScreen();
    let x = step(c.r.state, { type: "replay", at: c.enteredAt + 100 });
    x = done(x, speaks(x)[0]!.utteranceId, "ended", c.enteredAt + 2000);
    expect(answerQ(x, c.enteredAt + 2600)).toMatchObject({ rt_ms: 600, rt_basis: "tts_end", detail: { basis_from: "replay" }, replay_count: 1 });
  });
});
