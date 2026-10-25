/**
 * 통합: 엔진 + runner + 스텁 TTS(비동기 done ended) + 메모리 store + 가짜 clock.
 * 아이 역할 대본이 render로 받은 view만 보고 끝까지 진행한 뒤 로그를 검사한다.
 */
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/mini.json";
import { MemStorage } from "./helpers-log";
import { createRunner, ttsEventToAction, type Runner } from "../src/ui/runner";
import { createStore } from "../src/log/store";
import { auditSession } from "../src/log/audit";
import { CSV_COLUMNS, type LogEvent, type SessionMeta } from "../src/log/types";
import { VALID_CONDITIONS, conditionsSlug, type Conditions, type Story, type View } from "../src/story/types";
import type { Tts, TtsEvent } from "../src/tts";

const story = fixture as unknown as Story;
const original = (cpId: string) => story.choicePoints.find((c) => c.id === cpId)!.options.find((o) => o.matchesOriginal)!.id;
const different = (cpId: string) => story.choicePoints.find((c) => c.id === cpId)!.options.find((o) => !o.matchesOriginal)!.id;

/** 선택 지점별, 시도 순서대로 고를 보기. 모자라면 원작 */
type Script = Record<string, ("orig" | "diff")[]>;
const SCRIPTS: Record<string, Script> = {
  original: {},
  mixed: { c1: ["diff"], c3: ["diff"] },
  rewindTwice: { c1: ["diff", "diff"] },
};

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

interface Result {
  events: LogEvent[];
  finishedCalls: number;
  meta: SessionMeta;
  status: string;
}

async function runSession(conditions: Conditions, script: Script, epoch: number): Promise<Result> {
  let t = 0;
  const clock = () => t;
  let onEvent: (e: TtsEvent) => void = () => {};
  const tts: Tts = {
    speak: (utteranceId) => {
      setTimeout(() => {
        t += 10;
        onEvent({ type: "done", utteranceId, outcome: "ended" });
      }, 0);
    },
    cancel: () => {},
    unlock: () => {},
    findKoVoice: async () => null,
    listKoVoices: () => [],
  };
  const store = createStore(new MemStorage());
  const meta: SessionMeta = {
    session_id: `P01.${epoch}`,
    participant_code: "P01",
    story_id: story.id,
    conditions,
    confirm_mode: "double",
    manualReading: false,
    started_at_iso: new Date(epoch).toISOString(),
    started_epoch_ms: epoch,
    status: "open",
    voice: "stub",
  };
  store.createSession(meta);

  let view: View | null = null;
  let finishedCalls = 0;
  const runner: Runner = createRunner({
    story,
    conditions,
    engineSettings: { manualReading: false, confirmMode: "double", askLayer: false, voiceAsk: false },
    meta,
    store,
    tts,
    clock,
    nowIso: () => new Date(epoch + t).toISOString(),
    render: (v) => (view = v),
    onFinished: () => {
      finishedCalls += 1;
      store.setStatus(meta.session_id, "completed", undefined, new Date(epoch + t).toISOString(), runner.elapsedMs());
    },
  });
  onEvent = (e) => {
    const a = ttsEventToAction(e);
    if (a) runner.dispatch(a);
  };

  const attempts: Record<string, number> = {};
  runner.start();
  for (let g = 0; g < 2000 && finishedCalls === 0; g++) {
    await flush();
    const v = view as View | null;
    if (!v) continue;
    t += 100;
    switch (v.screen) {
      case "choice": {
        const n = (attempts[v.choicePointId] = (attempts[v.choicePointId] ?? 0) + 1);
        const pick = script[v.choicePointId]?.[n - 1] === "diff" ? different(v.choicePointId) : original(v.choicePointId);
        if (v.selectedOptionId !== pick) {
          runner.dispatch({ type: "listen", optionId: pick });
          await flush();
          t += 100;
        }
        runner.dispatch({ type: "confirm", optionId: pick });
        break;
      }
      case "why":
        runner.dispatch({ type: "answerWhy", optionId: v.options[0]!.id });
        break;
      case "comprehension":
        if (v.feedback === null) {
          const q = story.comprehension.find((x) => x.id === v.questionId)!;
          runner.dispatch({ type: "answerQuestion", optionId: q.answer });
        } else if (v.nextVisible) runner.dispatch({ type: "next" });
        break;
      case "parent_handoff":
        break;
      case "ask":
        runner.dispatch({ type: "askSkip" });
        break;
      default:
        if (v.nextVisible) runner.dispatch({ type: "next" });
    }
  }
  const rec = store.getSession(meta.session_id)!;
  return { events: rec.events, finishedCalls, meta: rec.meta, status: rec.meta.status };
}

const COMMON = CSV_COLUMNS.slice(0, 11);
const cpIds = story.choicePoints.map((c) => c.id);

let epoch = 1_700_000_000_000;
for (const c of VALID_CONDITIONS) {
  const scripts = !c.branching ? ["original"] : c.mismatch === "rewind" ? ["original", "mixed", "rewindTwice"] : ["original", "mixed"];
  describe(`세션 통합 — ${conditionsSlug(c)}`, () => {
    for (const name of scripts) {
      it(name, async () => {
        const r = await runSession(c, SCRIPTS[name]!, (epoch += 1000));
        expect(r.finishedCalls).toBe(1);
        expect(r.status).toBe("completed");

        const audit = auditSession({ meta: r.meta, events: r.events }, { choicePointIds: cpIds, questionCount: story.comprehension.length });
        expect(audit.violations).toEqual([]);
        expect(audit.status).toBe("ok");

        const types = new Set(r.events.map((e) => e.event_type));
        for (const t of ["session_start", "screen_enter", "tts_start", "tts_end", "next_click", "comprehension_answer", "session_end"] as const)
          expect(types, t).toContain(t);
        expect(r.events.filter((e) => e.event_type === "session_end")).toHaveLength(1);
        expect(r.events.map((e) => e.seq)).toEqual(r.events.map((_, i) => i + 1));

        for (const e of r.events)
          for (const col of COMMON) {
            const val = (e as unknown as Record<string, unknown>)[col];
            expect(val, `seq ${e.seq} ${e.event_type} ${col}`).not.toBeUndefined();
            expect(val, `seq ${e.seq} ${e.event_type} ${col}`).not.toBeNull();
            expect(val, `seq ${e.seq} ${e.event_type} ${col}`).not.toBe("");
          }

        const confirms = r.events.filter((e) => e.event_type === "choice_confirm");
        if (c.branching) {
          expect(types).toContain("choice_confirm");
          for (const e of confirms) {
            expect(e.rt_ms, `seq ${e.seq}`).toBeTypeOf("number");
            expect(e.rt_basis).toBeTruthy();
            expect(e.option_id).toBeTruthy();
            expect(e.matches_original).toBeTypeOf("boolean");
            expect(e.attempt).toBeGreaterThanOrEqual(1);
          }
          if (c.askWhy === true) expect(types).toContain("why_answer");
          else expect(types).not.toContain("why_answer");
        } else {
          expect(confirms).toHaveLength(0);
          const nc = r.events.filter((e) => e.event_type === "next_click" && e.choice_point_id);
          expect(new Set(nc.map((e) => e.choice_point_id))).toEqual(new Set(cpIds));
        }

        const forced = r.events.filter((e) => e.event_type === "forced_original");
        if (name === "rewindTwice") {
          expect(forced).toHaveLength(1);
          expect(forced[0]).toMatchObject({ attempt: 3, choice_point_id: "c1" });
        } else expect(forced).toHaveLength(0);
      });
    }
  });
}
