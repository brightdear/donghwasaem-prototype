export interface AsrResult {
  transcript: string;
  /** transcript를 제외한 나머지 대안(최대 2개) */
  alternatives: string[];
}

export type AsrFailReason =
  | "no_speech"
  | "not_allowed"
  | "network"
  | "audio_capture"
  | "aborted"
  | "timeout"
  | "other";

export interface Asr {
  start(): void;
  stop(): void;
  isListening(): boolean;
}

/** lib.dom의 SpeechRecognition에 기대지 않는 최소 형태 */
export interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface AsrDeps {
  Recognition?: new () => RecognitionLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

type Ctor = new () => RecognitionLike;

function pickCtor(g: Record<string, unknown>): Ctor | undefined {
  const c = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  return typeof c === "function" ? (c as Ctor) : undefined;
}

const globalRec = (): Record<string, unknown> => globalThis as unknown as Record<string, unknown>;

export function isAsrSupported(g: Record<string, unknown> = globalRec()): boolean {
  return pickCtor(g) !== undefined;
}

const ERROR_MAP: Record<string, AsrFailReason> = {
  "no-speech": "no_speech",
  "not-allowed": "not_allowed",
  "service-not-allowed": "not_allowed",
  network: "network",
  "audio-capture": "audio_capture",
  aborted: "aborted",
};

export function createAsr(
  opts: {
    lang: string;
    timeoutMs: number;
    onResult: (r: AsrResult) => void;
    onFail: (reason: AsrFailReason) => void;
  },
  deps: AsrDeps = {},
): Asr {
  const setT = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as number));

  let gen = 0;
  let listening = false;
  let timer: unknown = null;
  let current: RecognitionLike | null = null;

  /** 한 번의 start당 한 번만 마무리한다. 늦은 이벤트는 세대 번호로 무시 */
  function settle(myGen: number, run: () => void): void {
    if (myGen !== gen || !listening) return;
    listening = false;
    clearT(timer);
    timer = null;
    run();
  }

  function start(): void {
    if (listening) return;
    const Ctor = deps.Recognition ?? pickCtor(globalRec());
    if (!Ctor) {
      opts.onFail("other");
      return;
    }
    const myGen = ++gen;
    const rec = new Ctor();
    rec.lang = opts.lang;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.continuous = false;
    current = rec;
    listening = true;

    rec.onresult = (ev) => {
      settle(myGen, () => {
        const first = ev.results[0];
        const list: string[] = [];
        for (let i = 0; first && i < first.length; i++) {
          const t = first[i]?.transcript;
          if (typeof t === "string") list.push(t);
        }
        if (list.length === 0) {
          opts.onFail("no_speech");
          return;
        }
        opts.onResult({ transcript: list[0] as string, alternatives: list.slice(1, 3) });
      });
    };
    rec.onerror = (ev) => {
      settle(myGen, () => opts.onFail(ERROR_MAP[ev?.error] ?? "other"));
    };
    rec.onend = () => {
      settle(myGen, () => opts.onFail("no_speech"));
    };

    timer = setT(() => {
      settle(myGen, () => {
        try {
          rec.abort();
        } catch {
          /* 무시 */
        }
        opts.onFail("timeout");
      });
    }, opts.timeoutMs);

    try {
      rec.start();
    } catch {
      settle(myGen, () => opts.onFail("other"));
    }
  }

  function stop(): void {
    if (!listening) return;
    const rec = current;
    settle(gen, () => {
      try {
        rec?.abort();
      } catch {
        /* 무시 */
      }
      opts.onFail("aborted");
    });
  }

  return { start, stop, isListening: () => listening };
}
