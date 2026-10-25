/**
 * 음성 묻기 컨트롤러 (DOM 없음) — 인식 결과를 응답기로 맞춰 엔진 액션으로 전달한다.
 * 엔진이 voiceStart를 받아 voice="listening"이 된 뒤에 start()를 부른다.
 */
import type { Asr, AsrFailReason, AsrResult } from "../asr";
import type { AskResponder } from "../ask/responder";
import { currentView, type EngineState } from "../story/engine";
import type { Story } from "../story/types";
import type { RunnerAction } from "./runner";

export interface VoiceController {
  start(): void;
}

export function createVoiceController(deps: {
  story: Story;
  getState: () => EngineState;
  dispatch: (a: RunnerAction) => void;
  makeAsr: (cb: { onResult: (r: AsrResult) => void; onFail: (reason: AsrFailReason) => void }) => Asr | null;
  responder: AskResponder;
}): VoiceController {
  let asr: Asr | null = null;

  function onResult(r: AsrResult): void {
    const v = currentView(deps.getState());
    if (v.screen !== "ask") return; // 그 사이 화면이 바뀌었으면 무시
    const cp = deps.story.choicePoints.find((c) => c.id === v.choicePointId);
    if (!cp?.ask) {
      deps.dispatch({ type: "voiceFail", reason: "other" });
      return;
    }
    deps.responder
      .respond(
        {
          storyId: deps.story.id,
          choicePointId: v.choicePointId,
          characterId: v.selectedCharacterId,
          transcript: r.transcript,
          alternatives: r.alternatives,
        },
        cp.ask,
      )
      .then((matched) =>
        deps.dispatch({ type: "voiceResult", transcript: r.transcript, alternatives: r.alternatives, matched }),
      )
      .catch(() => deps.dispatch({ type: "voiceFail", reason: "other" }));
  }

  function onFail(reason: AsrFailReason): void {
    deps.dispatch({ type: "voiceFail", reason });
  }

  return {
    start() {
      const v = currentView(deps.getState());
      if (v.screen !== "ask" || v.voice !== "listening") return;
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
