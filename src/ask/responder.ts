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
}

export interface AskOutput {
  characterId: string;
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
