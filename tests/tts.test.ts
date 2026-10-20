import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTts, splitSentences, type TtsEvent } from "../src/tts";

class FakeUtterance {
  text: string;
  rate = 1;
  lang = "";
  volume = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

class FakeSynth {
  spoken: FakeUtterance[] = [];
  cancelCount = 0;
  voices: { lang: string; voiceURI: string; name: string }[] = [];
  listeners: Array<() => void> = [];
  speak(u: FakeUtterance) {
    this.spoken.push(u);
  }
  cancel() {
    this.cancelCount++;
  }
  getVoices() {
    return this.voices;
  }
  addEventListener(_: string, fn: () => void) {
    this.listeners.push(fn);
  }
  removeEventListener(_: string, fn: () => void) {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }
  last() {
    return this.spoken[this.spoken.length - 1] as FakeUtterance;
  }
}

function setup(rate = 1) {
  const synth = new FakeSynth();
  const events: TtsEvent[] = [];
  const tts = createTts(
    { rate, voiceURI: null, onEvent: (e) => events.push(e) },
    {
      synth: synth as unknown as SpeechSynthesis,
      makeUtterance: (t) => new FakeUtterance(t) as unknown as SpeechSynthesisUtterance,
    },
  );
  const done = () => events.filter((e) => e.type === "done");
  return { synth, events, tts, done };
}

function voiceTts(synth: FakeSynth, voiceURI: string | null = null) {
  return createTts({ rate: 1, voiceURI, onEvent: () => {} }, { synth: synth as unknown as SpeechSynthesis });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("splitSentences", () => {
  it("문장부호와 줄바꿈으로 쪼갠다", () => {
    expect(splitSentences("안녕했니? 응.\n좋아요! 그래…")).toEqual(["안녕했니?", "응.", "좋아요!", "그래…"]);
  });
});

describe("speak", () => {
  it("모든 청크가 끝나야 ended 1회, 첫 청크만으로는 done 없음", () => {
    const { synth, events, tts, done } = setup();
    tts.speak("u1", "passage", "하나. 둘. 셋.");
    expect(synth.spoken).toHaveLength(1);
    synth.last().onstart?.();
    expect(events[0]).toMatchObject({ utteranceId: "u1", type: "start" });
    synth.last().onend?.();
    expect(done()).toHaveLength(0);
    expect(synth.spoken).toHaveLength(2);
    synth.last().onend?.();
    expect(done()).toHaveLength(0);
    synth.last().onend?.();
    expect(done()).toEqual([{ utteranceId: "u1", type: "done", outcome: "ended" }]);
  });

  it("중간 cancel이면 cancelled 1회, 이후 onend는 무시", () => {
    const { synth, tts, done } = setup();
    tts.speak("u1", "passage", "하나. 둘.");
    const first = synth.last();
    tts.cancel();
    expect(done()).toEqual([{ utteranceId: "u1", type: "done", outcome: "cancelled" }]);
    first.onend?.();
    expect(done()).toHaveLength(1);
    expect(synth.spoken).toHaveLength(1);
  });

  it("onerror면 error", () => {
    const { synth, tts, done } = setup();
    tts.speak("u1", "prompt", "하나. 둘.");
    synth.last().onerror?.({ error: "synthesis-failed" });
    expect(done()).toEqual([{ utteranceId: "u1", type: "done", outcome: "error", detail: "synthesis-failed" }]);
  });

  it("워치독이 먼저 지나면 watchdog 1회, 늦은 onend는 무시", () => {
    const { synth, tts, done } = setup();
    tts.speak("u1", "passage", "하나.");
    const u = synth.last();
    vi.advanceTimersByTime(2999);
    expect(done()).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(done()).toEqual([{ utteranceId: "u1", type: "done", outcome: "watchdog" }]);
    u.onend?.();
    expect(done()).toHaveLength(1);
  });

  it("새 speak는 이전 발화를 cancelled로 닫고, 이전 onend는 새 발화에 영향 없음", () => {
    const { synth, tts, done } = setup();
    tts.speak("u1", "passage", "하나.");
    const old = synth.last();
    tts.speak("u2", "option", "둘.");
    expect(done()).toEqual([{ utteranceId: "u1", type: "done", outcome: "cancelled" }]);
    old.onend?.();
    expect(done()).toHaveLength(1);
    synth.last().onend?.();
    expect(done()).toHaveLength(2);
    expect(done()[1]).toMatchObject({ utteranceId: "u2", outcome: "ended" });
  });

  it("정상 종료 뒤 워치독은 울리지 않는다", () => {
    const { synth, tts, done } = setup();
    tts.speak("u1", "passage", "하나.");
    synth.last().onend?.();
    vi.advanceTimersByTime(60000);
    expect(done()).toHaveLength(1);
  });
});

describe("unlock", () => {
  it("빈 utterance를 speak하고 cancel한다", () => {
    const { synth, tts } = setup();
    tts.unlock();
    expect(synth.spoken).toHaveLength(1);
    expect(synth.last().text).toBe("");
    expect(synth.cancelCount).toBe(1);
  });
});

describe("findKoVoice", () => {
  it("이미 있는 ko 음성을 고른다(voiceURI 우선)", async () => {
    const synth = new FakeSynth();
    synth.voices = [
      { lang: "en-US", voiceURI: "en", name: "En" },
      { lang: "ko-KR", voiceURI: "ko1", name: "K1" },
      { lang: "ko_KR", voiceURI: "ko2", name: "K2" },
    ];
    const tts = voiceTts(synth, "ko2");
    const v = await tts.findKoVoice();
    expect(v?.voiceURI).toBe("ko2");
    expect(tts.listKoVoices()).toHaveLength(2);
  });

  it("voiceschanged를 기다렸다가 고른다", async () => {
    const synth = new FakeSynth();
    const p = voiceTts(synth).findKoVoice();
    synth.voices = [{ lang: "ko-KR", voiceURI: "ko1", name: "K1" }];
    synth.listeners.forEach((l) => l());
    expect((await p)?.voiceURI).toBe("ko1");
  });

  it("폴링으로도 찾는다", async () => {
    const synth = new FakeSynth();
    const p = voiceTts(synth).findKoVoice();
    vi.advanceTimersByTime(300);
    synth.voices = [{ lang: "ko-KR", voiceURI: "ko1", name: "K1" }];
    vi.advanceTimersByTime(300);
    expect((await p)?.voiceURI).toBe("ko1");
  });

  it("없으면 2초 뒤 null", async () => {
    const synth = new FakeSynth();
    synth.voices = [{ lang: "en-US", voiceURI: "en", name: "En" }];
    const p = voiceTts(synth).findKoVoice();
    vi.advanceTimersByTime(2001);
    expect(await p).toBeNull();
  });
});
