/**
 * 묻기 응답기 경계 — 계획 6.3. 지금은 키워드 매처만 쓰고, 나중에 다른 응답기(LLM 등)로 바꿀 수 있게 인터페이스로 분리한다.
 */
import type { AskBlock } from "../story/types";
import { matchQuestion } from "./matcher";

export interface AskInput {
  storyId: string;
  choicePointId: string;
  characterId: string | null;
  transcript: string;
  alternatives: string[];
  /** 묻기 직전 passage의 문단 전체(LLM 응답기의 장면 맥락). 키워드 매처는 쓰지 않는다 */
  scene: string[];
  /** 이야기 제목(LLM 응답기용, 없어도 됨) */
  storyTitle?: string;
}

export interface AskOutput {
  characterId: string;
  /** 준비된 질문 id, 또는 준비 밖 질문에 LLM이 대답했으면 "free" */
  questionId: string;
  answerText: string[];
}

export interface AskResponder {
  respond(input: AskInput, ask: AskBlock): Promise<AskOutput | null>;
}

/** 키워드 매처 결과를 질문의 answer로 채워 돌려준다. 못 맞추면 null. */
export const keywordResponder: AskResponder = {
  async respond(input, ask) {
    const hit = matchQuestion(input.transcript, input.alternatives, ask.characters, input.characterId);
    if (hit === null) return null;
    const question = ask.characters
      .find((c) => c.id === hit.characterId)
      ?.questions.find((q) => q.id === hit.questionId);
    if (question === undefined) return null;
    return { characterId: hit.characterId, questionId: hit.questionId, answerText: [...question.answer] };
  },
};
