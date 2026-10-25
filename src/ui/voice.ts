/**
 * 음성 묻기 컨트롤러 (DOM 없음) — 인식 결과를 응답기로 맞춰 엔진 액션으로 전달한다.
 * 엔진이 voiceStart를 받아 voice="listening"이 된 뒤에 start()를 부른다.
 */
import type { Asr, AsrFailReason, AsrResult } from "../asr";
import type { AskResponder } from "../ask/responder";
import { currentView, type EngineState } from "../story/engine";
import type { Story } from "../story/types";
import type { RunnerAction } from "./runner";

/** spine에서 choice 노드 바로 앞의 passage 문단(묻기 직전 장면). 없으면 [] */
export function sceneBefore(story: Story, choicePointId: string): string[] {
  const i = story.spine.findIndex((n) => n.type === "choice" && n.id === choicePointId);
  for (let j = i - 1; j >= 0; j--) {
    const n = story.spine[j]!;
    if (n.type === "passage") return [...n.paragraphs];
  }
  return [];
}

/** 묻기 화면의 마이크 상태. 묻기 화면이 아니면 null */
export function askVoiceOf(s: EngineState): "hidden" | "idle" | "listening" | null {
  const v = currentView(s);
  return v.screen === "ask" ? v.voice : null;
}

export interface VoiceController {
  start(): void;
}

export function createVoiceController(deps: {
  story: Story;
  getState: () => EngineState;
  dispatch: (a: RunnerAction) => void;
  makeAsr: (cb: { onResult: (r: AsrResult) => void; onFail: (reason: AsrFailReason) => void }) => Asr | null;
  responder: AskResponder;
  /** 설정된 응답기 종류. 못 맞춰 대답한 응답기가 없을 때 voice_result에 남긴다. 기본 "keyword" */
  responderKind?: "llm" | "keyword";
}): VoiceController {
  let asr: Asr | null = null;
  // 세대 토큰: start()마다 올린다. 응답 대기 중 새로 듣기 시작했으면 옛 결과는 버린다
  let gen = 0;
  // 한 번의 듣기(인식 시작 ~ 대답 도착/실패) 동안 켜 둔다. 대답을 기다리는 동안 마이크를 다시 눌러도
  // 인식을 새로 시작하거나 기다리던 대답을 버리지 않게 한다
  let busy = false;
  // busy를 켠 듣기의 표식(화면 번호·실패 횟수). 화면이 바뀌었거나 실패로 끝난 뒤 새로 듣는 것이면 옛 busy는 무효
  let busyKey = "";
  const episodeKey = (s: EngineState, cpId: string) => `${s.screenSeq}:${s.voiceFails[cpId] ?? 0}`;
  const responderKind = deps.responderKind ?? "keyword";

  function onResult(r: AsrResult): void {
    const v = currentView(deps.getState());
    if (v.screen !== "ask") return; // 그 사이 화면이 바뀌었으면 무시
    const cp = deps.story.choicePoints.find((c) => c.id === v.choicePointId);
    if (!cp?.ask) {
      busy = false;
      deps.dispatch({ type: "voiceFail", reason: "other" });
      return;
    }
    const myGen = gen;
    deps.responder
      .respond(
        {
          storyId: deps.story.id,
          storyTitle: deps.story.title,
          choicePointId: v.choicePointId,
          characterId: v.selectedCharacterId,
          transcript: r.transcript,
          alternatives: r.alternatives,
          scene: sceneBefore(deps.story, v.choicePointId),
        },
        cp.ask,
      )
      .then((matched) => {
        if (myGen !== gen) return;
        busy = false;
        // 로그에는 실제로 대답한 응답기와 실패 이유·지연을 남긴다(못 맞췄으면 설정된 응답기)
        deps.dispatch({
          type: "voiceResult",
          transcript: r.transcript,
          alternatives: r.alternatives,
          matched,
          responder: matched?.source ?? responderKind,
          ...(matched?.fallbackReason !== undefined ? { fallbackReason: matched.fallbackReason } : {}),
          ...(matched?.latencyMs !== undefined ? { latencyMs: matched.latencyMs } : {}),
        });
      })
      .catch(() => {
        if (myGen !== gen) return;
        busy = false;
        deps.dispatch({ type: "voiceFail", reason: "other" });
      });
  }

  function onFail(reason: AsrFailReason): void {
    busy = false;
    deps.dispatch({ type: "voiceFail", reason });
  }

  return {
    start() {
      const v = currentView(deps.getState());
      if (v.screen !== "ask" || v.voice !== "listening") return;
      // 같은 듣기가 아직 진행 중(인식 중이거나 대답 대기 중)이면 다시 시작하지 않는다
      const key = episodeKey(deps.getState(), v.choicePointId);
      if ((busy && busyKey === key) || asr?.isListening()) return;
      gen += 1;
      // Asr은 처음 한 번만 만들어 재사용
      asr ??= deps.makeAsr({ onResult, onFail });
      if (asr === null) {
        deps.dispatch({ type: "voiceFail", reason: "other" });
        return;
      }
      busy = true;
      busyKey = key;
      asr.start();
    },
  };
}
