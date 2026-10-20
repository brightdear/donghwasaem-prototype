import type { SpeakKind, TtsOutcome } from "./story/types";

export interface TtsEvent {
  utteranceId: string;
  type: "start" | "done";
  outcome?: TtsOutcome;
  detail?: string;
}

export interface TtsOptions {
  rate: number;
  voiceURI: string | null;
  onEvent: (e: TtsEvent) => void;
}

export interface TtsDeps {
  synth?: SpeechSynthesis;
  makeUtterance?: (text: string) => SpeechSynthesisUtterance;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  now?: () => number;
}

export interface Tts {
  speak(utteranceId: string, kind: SpeakKind, text: string): void;
  cancel(): void;
  unlock(): void;
  findKoVoice(): Promise<SpeechSynthesisVoice | null>;
  listKoVoices(): SpeechSynthesisVoice[];
}

const CHUNK_RE = /[^。.!?…\n]+(?:[。.!?…]+["'”’)\]]*)?/g;

/** 문장 단위(。.!?… 및 줄바꿈)로 쪼갠다. 빈 조각은 버린다. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CHUNK_RE)) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out;
}

interface Active {
  gen: number;
  utteranceId: string;
  finished: boolean;
  timer: unknown;
  // Chrome GC로 onend가 누락되는 것을 막기 위해 재생 중 utterance를 붙잡아 둔다
  held: SpeechSynthesisUtterance[];
}

export function createTts(opts: TtsOptions, deps: TtsDeps = {}): Tts {
  const getSynth = (): SpeechSynthesis => deps.synth ?? globalThis.speechSynthesis;
  const makeUtterance =
    deps.makeUtterance ?? ((text: string) => new SpeechSynthesisUtterance(text));
  const setT = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as number));

  let gen = 0;
  let active: Active | null = null;
  let voice: SpeechSynthesisVoice | null = null;

  function finish(a: Active, outcome: TtsOutcome, detail?: string): void {
    if (a.finished) return;
    a.finished = true;
    clearT(a.timer);
    a.held.length = 0;
    if (active === a) active = null;
    opts.onEvent({ utteranceId: a.utteranceId, type: "done", outcome, ...(detail ? { detail } : {}) });
  }

  function cancel(): void {
    const a = active;
    if (a) finish(a, "cancelled");
    try {
      getSynth().cancel();
    } catch {
      /* 취소 실패는 무시 */
    }
  }

  function speak(utteranceId: string, _kind: SpeakKind, text: string): void {
    if (active) finish(active, "cancelled");
    const myGen = ++gen;
    const a: Active = { gen: myGen, utteranceId, finished: false, timer: null, held: [] };
    active = a;
    const chunks = splitSentences(text);
    const chars = chunks.reduce((n, c) => n + c.length, 0);
    const rate = opts.rate > 0 ? opts.rate : 1;
    const synth = getSynth();

    if (chunks.length === 0) {
      // 읽을 글자가 없으면 바로 끝난 것으로 본다(비동기로 알려 호출 순서를 일정하게 유지)
      a.timer = setT(() => finish(a, "ended"), 0);
      return;
    }

    a.timer = setT(() => {
      if (a.gen !== myGen) return;
      finish(a, "watchdog");
      try {
        synth.cancel();
      } catch {
        /* 무시 */
      }
    }, Math.max(3000, (chars * 120) / rate));

    try {
      synth.cancel(); // 이전 잔여 대기열 제거. 이미 닫힌 이전 발화의 늦은 onend는 세대 번호로 무시
    } catch {
      /* 무시 */
    }

    const play = (i: number): void => {
      if (a.gen !== myGen || a.finished) return;
      const u = makeUtterance(chunks[i] as string);
      u.rate = rate;
      u.lang = "ko-KR";
      if (voice) u.voice = voice;
      a.held.push(u);
      if (i === 0) {
        u.onstart = () => {
          if (a.gen !== myGen || a.finished) return;
          opts.onEvent({ utteranceId, type: "start" });
        };
      }
      u.onend = () => {
        if (a.gen !== myGen || a.finished) return;
        if (i + 1 < chunks.length) play(i + 1);
        else finish(a, "ended");
      };
      u.onerror = (ev: SpeechSynthesisErrorEvent) => {
        if (a.gen !== myGen || a.finished) return;
        const err = ev?.error;
        // Chrome은 cancel 시 interrupted/canceled error를 보낸다 -> 취소로 정규화
        if (err === "interrupted" || err === "canceled") finish(a, "cancelled");
        else finish(a, "error", err ? String(err) : undefined);
      };
      try {
        synth.speak(u);
      } catch (e) {
        finish(a, "error", e instanceof Error ? e.message : String(e));
      }
    };
    play(0);
  }

  function unlock(): void {
    try {
      const synth = getSynth();
      const u = makeUtterance("");
      u.volume = 0;
      synth.speak(u);
      synth.cancel();
    } catch {
      /* 잠금 해제 실패는 '들려줘' 버튼 경로가 대신한다 */
    }
  }

  function listKoVoices(): SpeechSynthesisVoice[] {
    try {
      return getSynth()
        .getVoices()
        .filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("ko"));
    } catch {
      return [];
    }
  }

  function pick(): SpeechSynthesisVoice | null {
    const list = listKoVoices();
    if (list.length === 0) return null;
    if (opts.voiceURI) {
      const hit = list.find((v) => v.voiceURI === opts.voiceURI);
      if (hit) return hit;
    }
    return list[0] ?? null;
  }

  function findKoVoice(): Promise<SpeechSynthesisVoice | null> {
    return new Promise((resolve) => {
      const synth = getSynth();
      let settled = false;
      let pollTimer: unknown = null;
      let totalTimer: unknown = null;
      const check = (): void => {
        const v = pick();
        if (v) done(v);
      };
      const done = (v: SpeechSynthesisVoice | null): void => {
        if (settled) return;
        settled = true;
        clearT(pollTimer);
        clearT(totalTimer);
        try {
          synth.removeEventListener("voiceschanged", check);
        } catch {
          /* 무시 */
        }
        voice = v;
        resolve(v);
      };
      try {
        synth.addEventListener("voiceschanged", check);
      } catch {
        /* 무시 */
      }
      check();
      if (settled) return;
      const poll = (): void => {
        check();
        if (!settled) pollTimer = setT(poll, 200); // Safari는 voiceschanged가 안 올 수 있어 폴링
      };
      pollTimer = setT(poll, 200);
      totalTimer = setT(() => done(null), 2000);
    });
  }

  return { speak, cancel, unlock, findKoVoice, listKoVoices };
}
