import { describe, expect, it } from "vitest";
import { createAsr, isAsrSupported } from "../src/asr";
import type { AsrFailReason, AsrResult, RecognitionLike } from "../src/asr";

class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = "";
  interimResults = true;
  maxAlternatives = 1;
  continuous = true;
  onresult: RecognitionLike["onresult"] = null;
  onerror: RecognitionLike["onerror"] = null;
  onend: RecognitionLike["onend"] = null;
  startCalls = 0;
  abortCalls = 0;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start(): void {
    this.startCalls++;
  }
  stop(): void {}
  abort(): void {
    this.abortCalls++;
  }
}

function setup() {
  FakeRecognition.instances = [];
  const results: AsrResult[] = [];
  const fails: AsrFailReason[] = [];
  let timerCb: (() => void) | null = null;
  const asr = createAsr(
    { lang: "ko-KR", timeoutMs: 6000, onResult: (r) => results.push(r), onFail: (f) => fails.push(f) },
    {
      Recognition: FakeRecognition,
      setTimeout: (fn) => {
        timerCb = fn;
        return 1;
      },
      clearTimeout: () => {
        timerCb = null;
      },
    },
  );
  return {
    asr,
    results,
    fails,
    fire: () => timerCb?.(),
    inst: (i = 0) => FakeRecognition.instances[i] as FakeRecognition,
  };
}

const ALTS = [[{ transcript: "왜 못 날아" }, { transcript: "왜 못 나라" }, { transcript: "왜 몬 날아" }]];

describe("createAsr", () => {
  it("start는 lang ko-KR·interimResults false·maxAlternatives 3·continuous false로 인스턴스를 만들고 start()를 부른다", () => {
    const t = setup();
    t.asr.start();
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(t.inst().lang).toBe("ko-KR");
    expect(t.inst().interimResults).toBe(false);
    expect(t.inst().maxAlternatives).toBe(3);
    expect(t.inst().continuous).toBe(false);
    expect(t.inst().startCalls).toBe(1);
    expect(t.asr.isListening()).toBe(true);
  });

  it("onresult → onResult({transcript: 첫 대안, alternatives: 나머지})", () => {
    const t = setup();
    t.asr.start();
    t.inst().onresult?.({ results: ALTS });
    expect(t.results).toEqual([{ transcript: "왜 못 날아", alternatives: ["왜 못 나라", "왜 몬 날아"] }]);
    expect(t.fails).toEqual([]);
    expect(t.asr.isListening()).toBe(false);
  });

  it("onerror 매핑 7종", () => {
    const cases: [string, AsrFailReason][] = [
      ["no-speech", "no_speech"],
      ["not-allowed", "not_allowed"],
      ["service-not-allowed", "not_allowed"],
      ["network", "network"],
      ["audio-capture", "audio_capture"],
      ["aborted", "aborted"],
      ["weird", "other"],
    ];
    for (const [err, reason] of cases) {
      const t = setup();
      t.asr.start();
      t.inst().onerror?.({ error: err });
      expect(t.fails).toEqual([reason]);
      expect(t.results).toEqual([]);
    }
  });

  it("결과 없이 onend → no_speech", () => {
    const t = setup();
    t.asr.start();
    t.inst().onend?.();
    expect(t.fails).toEqual(["no_speech"]);
    expect(t.asr.isListening()).toBe(false);
  });

  it("결과 뒤 onend·onerror는 무시(onResult 1회, onFail 0회)", () => {
    const t = setup();
    t.asr.start();
    t.inst().onresult?.({ results: ALTS });
    t.inst().onend?.();
    t.inst().onerror?.({ error: "network" });
    expect(t.results).toHaveLength(1);
    expect(t.fails).toHaveLength(0);
  });

  it("타임아웃 → abort() 1회 + onFail(timeout); 그 뒤 onend 무시", () => {
    const t = setup();
    t.asr.start();
    t.fire();
    expect(t.inst().abortCalls).toBe(1);
    expect(t.fails).toEqual(["timeout"]);
    t.inst().onend?.();
    t.inst().onerror?.({ error: "aborted" });
    expect(t.fails).toEqual(["timeout"]);
    expect(t.results).toEqual([]);
  });

  it("듣는 중 start()는 새 인스턴스를 만들지 않는다; 끝난 뒤 start()는 새 인스턴스", () => {
    const t = setup();
    t.asr.start();
    t.asr.start();
    expect(FakeRecognition.instances).toHaveLength(1);
    t.inst().onresult?.({ results: ALTS });
    t.asr.start();
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(t.inst(1).startCalls).toBe(1);
  });

  it("stop() → abort + aborted", () => {
    const t = setup();
    t.asr.start();
    t.asr.stop();
    expect(t.inst().abortCalls).toBe(1);
    expect(t.fails).toEqual(["aborted"]);
    t.inst().onerror?.({ error: "aborted" });
    t.inst().onend?.();
    expect(t.fails).toEqual(["aborted"]);
    expect(t.asr.isListening()).toBe(false);
  });

  it("isAsrSupported: {} false, {webkitSpeechRecognition: fn} true, {SpeechRecognition: fn} true", () => {
    const fn = (): void => {};
    expect(isAsrSupported({})).toBe(false);
    expect(isAsrSupported({ webkitSpeechRecognition: fn })).toBe(true);
    expect(isAsrSupported({ SpeechRecognition: fn })).toBe(true);
  });
});
