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

export interface VoiceController {
  start(): void;
}

export function createVoiceController(deps: {
  story: Story;
  getState: () => EngineState;
  dispatch: (a: RunnerAction) => void;
  makeAsr: (cb: { onResult: (r: AsrResult) => void; onFail: (reason: AsrFailReason) => void }) => Asr | null;
  responder: AskResponder;
  /** voice_result 로그에 남길 응답기 종류. 기본 "keyword" */
  responderKind?: "llm" | "keyword";
}): VoiceController {
  let asr: Asr | null = null;
  // 세대 토큰: start()마다 올린다. 응답 대기 중 새로 듣기 시작했으면 옛 결과는 버린다
  let gen = 0;
  const responderKind = deps.responderKind ?? "keyword";

  function onResult(r: AsrResult): void {
    const v = currentView(deps.getState());
    if (v.screen !== "ask") return; // 그 사이 화면이 바뀌었으면 무시
    const cp = deps.story.choicePoints.find((c) => c.id === v.choicePointId);
    if (!cp?.ask) {
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
        deps.dispatch({
          type: "voiceResult",
          transcript: r.transcript,
          alternatives: r.alternatives,
          matched,
          responder: responderKind,
        });
      })
      .catch(() => {
        if (myGen === gen) deps.dispatch({ type: "voiceFail", reason: "other" });
      });
  }

  function onFail(reason: AsrFailReason): void {
    deps.dispatch({ type: "voiceFail", reason });
  }

  return {
    start() {
      const v = currentView(deps.getState());
      if (v.screen !== "ask" || v.voice !== "listening") return;
      gen += 1;
      // Asr은 처음 한 번만 만들어 재사용
      asr ??= deps.makeAsr({ onResult, onFail });
      if (asr === null) {
        deps.dispatch({ type: "voiceFail", reason: "other" });
        return;
      }
      asr.start();
    },
  };
}
