/**
 * 묻기 음성 키워드 매처 — 계획 6.3. 순수 함수, DOM 없음.
 * 인식된 글(transcript)과 대안 후보(alternatives)에서 가장 잘 맞는 인물·질문을 고른다.
 */
import type { AskCharacter } from "../story/types";

/** 비교용 정규화: NFC, 소문자, 문자·숫자만 남김(공백·문장부호 제거). */
export function normalize(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export interface MatchResult {
  characterId: string;
  questionId: string;
  score: number;
}

/**
 * 후보 글 중 가장 잘 맞는 (인물, 질문)을 고른다. 없으면 null.
 * 점수: 정규화된 키워드가 후보 안에 포함된 개수. 점수가 1 이상이고 후보에 인물 이름이 있으면 +2.
 * 동점은 (후보 순서, 인물 순서, 질문 순서)상 앞선 것. 인물을 골랐으면 그 인물만 본다.
 */
export function matchQuestion(
  transcript: string,
  alternatives: string[],
  characters: AskCharacter[],
  selectedCharacterId: string | null,
): MatchResult | null {
  const candidates = [transcript, ...alternatives].map(normalize).filter((c) => c.length > 0);
  const pool = selectedCharacterId === null
    ? characters
    : characters.filter((c) => c.id === selectedCharacterId);

  let best: MatchResult | null = null;
  for (const candidate of candidates) {
    for (const character of pool) {
      const name = normalize(character.name);
      for (const question of character.questions) {
        let score = 0;
        for (const keyword of question.keywords) {
          const k = normalize(keyword);
          if (k.length > 0 && candidate.includes(k)) score++;
        }
        if (score >= 1 && name.length > 0 && candidate.includes(name)) score += 2;
        if (score >= 1 && (best === null || score > best.score)) {
          best = { characterId: character.id, questionId: question.id, score };
        }
      }
    }
  }
  return best;
}
