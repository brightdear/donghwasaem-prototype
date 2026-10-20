/**
 * 엔진 effect 실행기 (DOM 없음). 계획 4 단계 2·3, 인계 문서 Wave 2 인터페이스.
 * 모든 action에 clock() 기반 at을 찍고, effect를 순서대로 실행한다.
 * tts 콜백이 speak 도중 동기로 들어와도 재진입하지 않도록 action을 큐에 쌓아 차례로 처리한다.
 */
import { init, isFinished, step, type EngineState } from "../story/engine";
import type { Action, Conditions, Effect, EngineSettings, Story, View } from "../story/types";
import { commonColumns, createEventFactory } from "../log/events";
import type { Store } from "../log/store";
import type { EngineLogEvent, LogEvent, SessionMeta } from "../log/types";
import type { Tts, TtsEvent } from "../tts";

/** 유니언 각 멤버에서 K를 뺀다 (Omit<Union,K>는 유니언을 뭉갠다) */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RunnerAction = DistributiveOmit<Action, "at">;

export interface RunnerDeps {
  story: Story;
  conditions: Conditions;
  engineSettings: EngineSettings;
  meta: SessionMeta;
  store: Store;
  tts: Tts | null;
  clock: () => number;
  nowIso: () => string;
  render: (view: View) => void;
  onFinished: () => void;
}

export interface Runner {
  start(): void;
  dispatch(a: RunnerAction): void;
  getState(): EngineState;
  /** 엔진 밖 이벤트(page_hidden 등)를 같은 seq·t_ms 기준으로 기록 */
  logExtra(ev: Omit<EngineLogEvent, "at">): void;
  /** session_start 기준 경과 ms (session_end·늦은 이벤트의 t_ms용). 시작 전이면 null */
  elapsedMs(): number | null;
}

/** tts onEvent → runner action. done만 ttsDone으로 바꾼다. */
export function ttsEventToAction(e: TtsEvent): RunnerAction | null {
  if (e.type !== "done") return null;
  return { type: "ttsDone", utteranceId: e.utteranceId, outcome: e.outcome ?? "ended" };
}

/** store.appendLateEvent용 행. seq는 store가 다시 매긴다. */
export function lateEvent(meta: SessionMeta, ev: Omit<EngineLogEvent, "at">, nowIso: string, tMs: number | null): LogEvent {
  return { ...commonColumns(meta), ...ev, seq: 0, ts_iso: nowIso, t_ms: tMs };
}

export function createRunner(deps: RunnerDeps): Runner {
  const factory = createEventFactory(deps.meta);
  let state: EngineState | null = null;
  let startAt: number | null = null;
  let finishedNotified = false;
  let warned = false;
  let busy = false;
  const queue: (() => void)[] = [];

  function persist(ev: EngineLogEvent): void {
    const r = deps.store.appendEvent(deps.meta.session_id, factory(ev, deps.nowIso()));
    if (!r.ok && !warned) {
      warned = true;
      console.warn(`[runner] 로그 저장 실패(${r.reason}). 진행은 계속합니다.`);
    }
  }

  function run(effects: Effect[]): void {
    for (const fx of effects) {
      switch (fx.type) {
        case "speak":
          if (deps.tts) deps.tts.speak(fx.utteranceId, fx.kind, fx.text);
          else dispatch({ type: "ttsDone", utteranceId: fx.utteranceId, outcome: "error" });
          break;
        case "cancelSpeech":
          deps.tts?.cancel();
          break;
        case "log":
          persist(fx.event);
          break;
        case "render":
          deps.render(fx.view);
          break;
      }
    }
    if (state && !finishedNotified && isFinished(state)) {
      finishedNotified = true;
      deps.onFinished();
    }
  }

  /** 큐에 넣고, 바깥 호출이면 비울 때까지 처리 */
  function enqueue(job: () => void): void {
    queue.push(job);
    if (busy) return;
    busy = true;
    try {
      while (queue.length) queue.shift()!();
    } finally {
      busy = false;
    }
  }

  function dispatch(a: RunnerAction): void {
    enqueue(() => {
      if (!state) return;
      const r = step(state, { ...a, at: deps.clock() } as Action);
      state = r.state;
      run(r.effects);
    });
  }

  return {
    start() {
      enqueue(() => {
        if (state) return;
        const at = deps.clock();
        startAt = at;
        persist({
          event_type: "session_start",
          at,
          detail: {
            voice: deps.meta.voice ?? null,
            manualReading: deps.engineSettings.manualReading,
            pictures: deps.meta.pictures ?? false,
          },
        });
        const r = init(deps.story, deps.conditions, deps.engineSettings, at);
        state = r.state;
        run(r.effects);
      });
    },
    dispatch,
    getState() {
      if (!state) throw new Error("runner.start() 전");
      return state;
    },
    logExtra(ev) {
      enqueue(() => {
        if (startAt === null) return;
        persist({ ...ev, at: deps.clock() } as EngineLogEvent);
      });
    },
    elapsedMs() {
      return startAt === null ? null : deps.clock() - startAt;
    },
  };
}
